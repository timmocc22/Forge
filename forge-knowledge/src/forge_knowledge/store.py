import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Column,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    and_,
    create_engine,
    delete,
    insert,
    select,
    update,
)


class Conflict(RuntimeError):
    pass


class KnowledgeStore:
    def __init__(self, url: str, dimension: int):
        self.dimension = dimension
        self.postgres = url.startswith("postgresql")
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            url,
            connect_args={"check_same_thread": False, "timeout": 15} if not self.postgres else {},
        )
        m = MetaData()
        self.documents = Table(
            "knowledge_documents",
            m,
            Column("project_id", String(36), primary_key=True),
            Column("id", String(36), primary_key=True),
            Column("filename", String(240), nullable=False),
            Column("digest", String(64), nullable=False),
            Column("embedding_model", String(200), nullable=False),
            Column("revision", Integer, nullable=False),
            Column("chunk_count", Integer, nullable=False),
        )
        self.chunks = Table(
            "knowledge_chunks",
            m,
            Column("id", String(100), primary_key=True),
            Column("project_id", String(36), nullable=False, index=True),
            Column("document_id", String(36), nullable=False),
            Column("content", Text, nullable=False),
            Column("source", String(240), nullable=False),
            Column("page", Integer),
            Column("embedding_model", String(200), nullable=False),
            Column("embedding", Vector(dimension) if self.postgres else JSON, nullable=False),
            ForeignKeyConstraint(
                ["project_id", "document_id"],
                ["knowledge_documents.project_id", "knowledge_documents.id"],
                ondelete="CASCADE",
            ),
        )
        self.requests = Table(
            "knowledge_requests",
            m,
            Column("id", String(36), primary_key=True),
            Column("fingerprint", String(64), nullable=False),
            Column("result", JSON, nullable=False),
        )
        self.jobs = Table(
            "knowledge_jobs",
            m,
            Column("id", String(36), primary_key=True),
            Column("project_id", String(36), nullable=False, index=True),
            Column("document_id", String(36), nullable=False),
            Column("filename", String(240), nullable=False),
            Column("fingerprint", String(64), nullable=False),
            Column("payload", JSON, nullable=False),
            Column("status", String(20), nullable=False, index=True),
            Column("created_at", String(40), nullable=False),
            Column("updated_at", String(40), nullable=False),
            Column("error", Text, nullable=False),
            Column("result", JSON),
        )
        with self.engine.begin() as conn:
            if self.postgres:
                from sqlalchemy import text

                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            m.create_all(conn)

    def previous(self, request_id: str, fingerprint: str):
        with self.engine.connect() as conn:
            row = (
                conn.execute(select(self.requests).where(self.requests.c.id == request_id))
                .mappings()
                .first()
            )
            if row and row["fingerprint"] != fingerprint:
                raise Conflict("请求标识已被其他文档使用")
            return row["result"] if row else None

    def document(self, project_id: str, document_id: str):
        with self.engine.connect() as conn:
            row = (
                conn.execute(
                    select(self.documents).where(
                        self.documents.c.project_id == project_id,
                        self.documents.c.id == document_id,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def save(
        self,
        request_id,
        fingerprint,
        project_id,
        document_id,
        filename,
        digest,
        model,
        chunks,
        expected,
    ):
        result = {
            "document_id": document_id,
            "project_id": project_id,
            "chunks": len(chunks),
            "revision": expected + 1,
        }
        with self.engine.begin() as conn:
            predicate = and_(
                self.documents.c.project_id == project_id, self.documents.c.id == document_id
            )
            values = {
                "filename": filename,
                "digest": digest,
                "embedding_model": model,
                "revision": expected + 1,
                "chunk_count": len(chunks),
            }
            if expected:
                changed = conn.execute(
                    update(self.documents)
                    .where(predicate, self.documents.c.revision == expected)
                    .values(**values)
                ).rowcount
                if changed != 1:
                    raise Conflict("文档在处理期间已更新，请重试")
            else:
                conn.execute(
                    insert(self.documents).values(project_id=project_id, id=document_id, **values)
                )
            conn.execute(
                delete(self.chunks).where(
                    self.chunks.c.project_id == project_id, self.chunks.c.document_id == document_id
                )
            )
            conn.execute(insert(self.chunks), chunks)
            conn.execute(
                insert(self.requests).values(id=request_id, fingerprint=fingerprint, result=result)
            )
        return result

    def search(self, project_id, vector, model, limit):
        table = self.chunks
        predicate = and_(table.c.project_id == project_id, table.c.embedding_model == model)
        with self.engine.connect() as conn:
            if self.postgres:
                distance = table.c.embedding.cosine_distance(vector)
                rows = (
                    conn.execute(
                        select(
                            table.c.id,
                            table.c.project_id,
                            table.c.document_id,
                            table.c.source,
                            table.c.content,
                            table.c.page,
                            (1 - distance).label("score"),
                        )
                        .where(predicate)
                        .order_by(distance)
                        .limit(limit)
                    )
                    .mappings()
                    .all()
                )
                return [dict(row) for row in rows]
            rows = conn.execute(select(table).where(predicate)).mappings().all()
        # The SQLite adapter is for a small local library; production search stays in pgvector.
        norm = math.sqrt(sum(x * x for x in vector))
        result = []
        for row in rows:
            value = row["embedding"]
            if len(value) != len(vector):
                continue
            denominator = norm * math.sqrt(sum(x * x for x in value))
            score = sum(a * b for a, b in zip(vector, value)) / denominator if denominator else 0
            result.append(
                {
                    k: row[k]
                    for k in ["id", "project_id", "document_id", "source", "content", "page"]
                }
                | {"score": score}
            )
        return sorted(result, key=lambda row: row["score"], reverse=True)[:limit]

    def list_documents(self, project_id):
        with self.engine.connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    select(self.documents).where(self.documents.c.project_id == project_id)
                ).mappings()
            ]

    def remove(self, project_id, document_id):
        with self.engine.begin() as conn:
            conn.execute(
                delete(self.chunks).where(
                    self.chunks.c.project_id == project_id, self.chunks.c.document_id == document_id
                )
            )
            conn.execute(
                delete(self.documents).where(
                    self.documents.c.project_id == project_id, self.documents.c.id == document_id
                )
            )
        return {"deleted": True}

    @staticmethod
    def _timestamp():
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _job_view(row):
        return {
            key: row[key]
            for key in (
                "id",
                "project_id",
                "document_id",
                "filename",
                "status",
                "created_at",
                "updated_at",
                "error",
                "result",
            )
        }

    def submit_job(self, payload: dict, max_queued: int):
        from sqlalchemy import func
        from sqlalchemy.exc import IntegrityError

        job_id = payload["request_id"]
        project_id = payload["project_id"]
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

        def existing(conn):
            return (
                conn.execute(select(self.jobs).where(self.jobs.c.id == job_id)).mappings().first()
            )

        def verify(row):
            if row["fingerprint"] != fingerprint or row["project_id"] != project_id:
                raise Conflict("作业标识已被其他文档使用")
            return self._job_view(row)

        try:
            with self.engine.begin() as conn:
                previous = existing(conn)
                if previous:
                    return verify(previous)
                queued = conn.scalar(
                    select(func.count())
                    .select_from(self.jobs)
                    .where(
                        self.jobs.c.project_id == project_id,
                        self.jobs.c.status.in_(["queued", "running"]),
                    )
                )
                if queued >= max_queued:
                    raise Conflict("文档处理队列已满")
                timestamp = self._timestamp()
                row = {
                    "id": job_id,
                    "project_id": project_id,
                    "document_id": payload["document_id"],
                    "filename": payload["filename"],
                    "fingerprint": fingerprint,
                    "payload": payload,
                    "status": "queued",
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "error": "",
                    "result": None,
                }
                conn.execute(insert(self.jobs).values(**row))
                return self._job_view(row)
        except IntegrityError:
            with self.engine.connect() as conn:
                previous = existing(conn)
                if previous:
                    return verify(previous)
            raise Conflict("作业正在被并发提交，请重试")

    def list_jobs(self, project_id):
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(self.jobs)
                .where(self.jobs.c.project_id == project_id)
                .order_by(self.jobs.c.created_at.desc())
                .limit(100)
            ).mappings()
            return [self._job_view(row) for row in rows]

    def claim_job(self):
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(self.jobs)
                    .where(self.jobs.c.status == "queued")
                    .order_by(self.jobs.c.created_at)
                    .limit(1)
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            claimed = conn.execute(
                update(self.jobs)
                .where(self.jobs.c.id == row["id"], self.jobs.c.status == "queued")
                .values(status="running", updated_at=self._timestamp())
            ).rowcount
            return dict(row) if claimed == 1 else None

    def finish_job(self, job_id, result=None, error=""):
        with self.engine.begin() as conn:
            conn.execute(
                update(self.jobs)
                .where(self.jobs.c.id == job_id, self.jobs.c.status == "running")
                .values(
                    status="failed" if error else "completed",
                    result=result,
                    error=error,
                    updated_at=self._timestamp(),
                )
            )

    def retry_job(self, project_id, job_id):
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(self.jobs).where(
                        self.jobs.c.project_id == project_id, self.jobs.c.id == job_id
                    )
                )
                .mappings()
                .first()
            )
            if row is None:
                raise KeyError(job_id)
            if row["status"] != "failed":
                raise Conflict("仅失败作业可以重试")
            changed = conn.execute(
                update(self.jobs)
                .where(
                    self.jobs.c.id == job_id,
                    self.jobs.c.project_id == project_id,
                    self.jobs.c.status == "failed",
                )
                .values(status="queued", error="", updated_at=self._timestamp())
            ).rowcount
            if changed != 1:
                raise Conflict("作业已被其他请求更新")

    def recover_jobs(self):
        # A restart never silently repeats an uncertain paid embedding request.
        with self.engine.begin() as conn:
            conn.execute(
                update(self.jobs)
                .where(self.jobs.c.status.in_(["queued", "running"]))
                .values(
                    status="failed",
                    error="服务已重启，请手动重试文档处理",
                    updated_at=self._timestamp(),
                )
            )
