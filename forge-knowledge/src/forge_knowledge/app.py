import asyncio
import base64
import binascii
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from .models import Evidence, Ingest, JobView, Retrieve, Settings
from .parsing import parse_document, split_documents
from .providers import Embeddings, ModelUnavailable, Reranker
from .retrieval import ProjectRetriever
from .store import Conflict, KnowledgeStore


def create_app(settings=None, embeddings=None, reranker=None):
    s = settings or Settings()
    if not s.token:
        raise RuntimeError("请配置 KNOWLEDGE_TOKEN，供 Kotlin 后台访问内部接口")
    store = KnowledgeStore(s.database_url, s.embedding_dimension)
    embedder = embeddings or Embeddings(s)
    ranker = reranker or Reranker(s)

    @asynccontextmanager
    async def lifespan(app):
        await run_in_threadpool(store.recover_jobs)
        workers = [asyncio.create_task(worker()) for _ in range(s.ingest_workers)]
        try:
            yield
        finally:
            for task in workers:
                task.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            store.engine.dispose()

    app = FastAPI(title="Forge Knowledge", version="0.1.0", lifespan=lifespan)
    app.state.store = store

    def authorize(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization, f"Bearer {s.token}"):
            raise HTTPException(401, "内部服务凭据无效")

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > 15 * 1024 * 1024):
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "请求过大"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(ModelUnavailable)
    async def model_failure(request, error):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": str(error)}, status_code=503)

    @app.exception_handler(Conflict)
    async def conflict(request, error):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "embeddings_configured": bool(s.embedding_model and s.embedding_base_url),
            "rerank_configured": bool(s.rerank_url),
        }

    @app.post("/internal/v1/documents", dependencies=[Depends(authorize)])
    async def ingest(input: Ingest):
        try:
            data = base64.b64decode(input.content_base64, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "文档编码无效")
        if len(data) > s.max_file_bytes:
            raise HTTPException(413, "文档超过大小限制")
        project_id, document_id = str(input.project_id), str(input.document_id)
        digest = hashlib.sha256(data).hexdigest()
        model = f"{s.embedding_model}:{s.embedding_dimension}"
        fingerprint = hashlib.sha256(
            f"{project_id}:{document_id}:{input.filename}:{input.media_type}:{digest}:{model}:{s.chunk_size}:{s.chunk_overlap}".encode()
        ).hexdigest()
        previous = store.previous(str(input.request_id), fingerprint)
        if previous:
            return previous
        before = store.document(project_id, document_id)
        try:
            documents = await run_in_threadpool(
                parse_document, data, input.media_type, input.filename
            )
            nodes = await run_in_threadpool(split_documents, documents, s)
        except (ValueError, UnicodeError):
            raise HTTPException(422, "文档无法解析，或超过解析限制")
        vectors = await embedder.embed([n.text for n in nodes])
        chunks = [
            {
                "id": hashlib.sha256(
                    f"{project_id}:{document_id}:{fingerprint}:{i}".encode()
                ).hexdigest(),
                "project_id": project_id,
                "document_id": document_id,
                "source": input.filename,
                "content": node.text,
                "page": node.metadata.get("page"),
                "embedding": vector,
                "embedding_model": model,
            }
            for i, (node, vector) in enumerate(zip(nodes, vectors))
        ]
        if len(chunks) != len(nodes):
            raise ModelUnavailable("向量服务返回的分块数量不一致")
        try:
            return await run_in_threadpool(
                store.save,
                str(input.request_id),
                fingerprint,
                project_id,
                document_id,
                input.filename,
                digest,
                model,
                chunks,
                before["revision"] if before else 0,
            )
        except IntegrityError:
            previous = store.previous(str(input.request_id), fingerprint)
            if previous:
                return previous
            raise Conflict("文档或请求被并发更新，请重试")

    async def worker():
        while True:
            job = await run_in_threadpool(store.claim_job)
            if job is None:
                await asyncio.sleep(0.1)
                continue
            try:
                result = await ingest(Ingest.model_validate(job["payload"]))
                await run_in_threadpool(store.finish_job, job["id"], result)
            except asyncio.CancelledError:
                await run_in_threadpool(store.finish_job, job["id"], None, "服务已停止，请手动重试")
                raise
            except (HTTPException, ModelUnavailable, Conflict) as error:
                message = str(error.detail) if isinstance(error, HTTPException) else str(error)
                await run_in_threadpool(store.finish_job, job["id"], None, message)
            except Exception:
                logging.getLogger(__name__).exception("Document indexing job failed")
                await run_in_threadpool(store.finish_job, job["id"], None, "文档处理失败，请重试")

    @app.post(
        "/internal/v1/jobs",
        response_model=JobView,
        status_code=202,
        dependencies=[Depends(authorize)],
    )
    async def submit_job(input: Ingest):
        return await run_in_threadpool(
            store.submit_job, input.model_dump(mode="json"), s.max_queued_jobs
        )

    @app.get(
        "/internal/v1/projects/{project_id}/jobs",
        response_model=list[JobView],
        dependencies=[Depends(authorize)],
    )
    def list_jobs(project_id: UUID):
        return store.list_jobs(str(project_id))

    @app.post(
        "/internal/v1/projects/{project_id}/jobs/{job_id}/retry",
        response_model=list[JobView],
        dependencies=[Depends(authorize)],
    )
    async def retry_job(project_id: UUID, job_id: UUID):
        try:
            await run_in_threadpool(store.retry_job, str(project_id), str(job_id))
        except KeyError:
            raise HTTPException(404, "文档作业不存在")
        return await run_in_threadpool(store.list_jobs, str(project_id))

    @app.post(
        "/internal/v1/retrieve", response_model=list[Evidence], dependencies=[Depends(authorize)]
    )
    async def retrieve(input: Retrieve):
        if not await run_in_threadpool(store.list_documents, str(input.project_id)):
            return []
        retriever = ProjectRetriever(
            store,
            embedder,
            str(input.project_id),
            f"{s.embedding_model}:{s.embedding_dimension}",
            min(input.limit * 4, 80),
        )
        nodes = await retriever.aretrieve(input.query)
        rows = [
            {
                "id": result.node.node_id,
                "content": result.node.text,
                **result.node.metadata,
                "score": result.score,
            }
            for result in nodes
        ]
        if input.rerank:
            rows = await ranker.rerank(input.query, rows, input.limit)
        return rows[: input.limit]

    @app.get("/internal/v1/projects/{project_id}/documents", dependencies=[Depends(authorize)])
    def list_documents(project_id: UUID):
        return store.list_documents(str(project_id))

    @app.delete(
        "/internal/v1/projects/{project_id}/documents/{document_id}",
        dependencies=[Depends(authorize)],
    )
    def remove(project_id: UUID, document_id: UUID):
        return store.remove(str(project_id), str(document_id))

    return app
