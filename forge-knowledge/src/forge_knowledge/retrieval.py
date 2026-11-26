from llama_index.core.base.base_retriever import BaseRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from starlette.concurrency import run_in_threadpool


class ProjectRetriever(BaseRetriever):
    """LlamaIndex retriever whose storage query always includes the authorized project."""

    def __init__(self, store, embeddings, project_id: str, model: str, limit: int):
        super().__init__()
        self.store = store
        self.embeddings = embeddings
        self.project_id = project_id
        self.model = model
        self.limit = limit

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        raise RuntimeError("Use aretrieve() for asynchronous model calls")

    async def _aretrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        vectors = await self.embeddings.embed([query_bundle.query_str])
        rows = await run_in_threadpool(
            self.store.search, self.project_id, vectors[0], self.model, self.limit
        )
        return [
            NodeWithScore(
                node=TextNode(
                    id_=row["id"],
                    text=row["content"],
                    metadata={k: row[k] for k in ("project_id", "document_id", "source", "page")},
                ),
                score=row["score"],
            )
            for row in rows
        ]
