# forge-knowledge

独立 Python 知识库服务：FastAPI 提供内部接口，LlamaIndex 负责切块和检索编排，pypdf/python-docx 解析文档，SQLAlchemy 存储作业、文档和切块。默认 SQLite，PostgreSQL 可使用 pgvector。向量模型和重排通过可配置 HTTP 接口接入。

```sh
uv sync --frozen
cp .env.example .env
# 设置 KNOWLEDGE_TOKEN；索引需要配置 embedding 地址、模型、密钥与维度
uv run uvicorn forge_knowledge.app:create_app --factory --host 127.0.0.1 --port 3017
```

运行和构建均不需要 Kotlin、Node 或前端源码。健康接口 `/health`，接口文档 `/docs`。`/internal/v1/*` 要求 `Authorization: Bearer <KNOWLEDGE_TOKEN>`；只有 API 使用令牌，浏览器不直接连接本服务。

Python 独占数据库和文档入库作业。POST `/internal/v1/jobs` 返回已持久化作业，服务内 worker 解析、切块、向量化。作业状态为 queued/running/completed/failed；API 仅提交和查询。相同请求与内容幂等，不同内容复用请求号会冲突。失败作业支持项目范围内显式重试；服务重启将未完成作业标记为失败，避免静默重复模型调用。`KNOWLEDGE_INGEST_WORKERS` 控制服务内并发。

当前 worker 与 API 在同一 Python 进程内，部署采用一个 Python 实例、一个 Uvicorn worker，不能让多个实例同时恢复同一数据库中的作业。将来需要横向扩容时，应增加租约和独立队列 worker。

```sh
uv run pytest tests -q
uv run ruff check .
uv run ruff format --check .
uv run python -m forge_knowledge.export_contract
```

配置只放本工程 `.env`，存储只放本工程 `.data`。不要挂载 Kotlin `.data`。容器独立构建：`docker build -t forge-knowledge .`。
