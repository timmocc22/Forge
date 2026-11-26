import math

import httpx

from .models import Settings


class ModelUnavailable(RuntimeError):
    pass


class Embeddings:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def embed(self, texts: list[str]) -> list[list[float]]:
        s = self.settings
        if not s.embedding_base_url or not s.embedding_model:
            raise ModelUnavailable("尚未配置向量模型服务")
        result = []
        async with httpx.AsyncClient(
            timeout=120, follow_redirects=False, trust_env=False, proxy=s.model_proxy_url or None
        ) as client:
            for offset in range(0, len(texts), 32):
                batch = texts[offset : offset + 32]
                response = await client.post(
                    s.embedding_base_url.rstrip("/") + "/embeddings",
                    headers={"Authorization": f"Bearer {s.embedding_api_key}"}
                    if s.embedding_api_key
                    else {},
                    json={"model": s.embedding_model, "input": batch},
                )
                if not response.is_success:
                    raise ModelUnavailable("向量服务请求失败，请检查模型配置与额度")
                items = sorted(response.json()["data"], key=lambda row: row["index"])
                vectors = [i["embedding"] for i in items]
                if len(vectors) != len(batch) or any(
                    len(v) != s.embedding_dimension
                    or not all(isinstance(x, (float, int)) and math.isfinite(x) for x in v)
                    or not any(v)
                    for v in vectors
                ):
                    raise ModelUnavailable("向量服务返回的维度或数值无效")
                result.extend(vectors)
        return result


class Reranker:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def rerank(self, query: str, rows: list[dict], limit: int) -> list[dict]:
        s = self.settings
        if not s.rerank_url:
            return rows[:limit]
        async with httpx.AsyncClient(
            timeout=60, follow_redirects=False, trust_env=False, proxy=s.model_proxy_url or None
        ) as client:
            response = await client.post(
                s.rerank_url,
                headers={"Authorization": f"Bearer {s.rerank_api_key}"} if s.rerank_api_key else {},
                json={
                    "model": s.rerank_model,
                    "query": query,
                    "documents": [r["content"] for r in rows],
                    "top_n": limit,
                },
            )
        if not response.is_success:
            raise ModelUnavailable("重排服务请求失败")
        result = []
        used = set()
        for item in response.json()["results"]:
            index = item["index"]
            score = item["relevance_score"]
            if (
                not isinstance(index, int)
                or index in used
                or not 0 <= index < len(rows)
                or not math.isfinite(score)
            ):
                raise ModelUnavailable("重排结果无效")
            used.add(index)
            result.append({**rows[index], "score": score})
        return result[:limit]
