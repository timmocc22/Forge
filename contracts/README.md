# 接口契约

| 边界 | 生产者及权威文件 | 消费者快照 |
| --- | --- | --- |
| 浏览器 → API | `forge-api/src/main/resources/contracts/openapi.json`、`schemas.json` | `forge-web/contracts/forge-api.v1.openapi.json` |
| API → Python | `forge-knowledge/contracts/openapi.v1.json`，由 FastAPI 导出 | `forge-api/contracts/forge-knowledge.v1.openapi.json` |

公开 API 的 JSON Schema 和 OpenAPI 由 API 工程维护；API 的测试验证两者一致。前端从本地快照生成 TypeScript，构建不会回写 Kotlin 资源。Python 从 Pydantic/FastAPI 导出内部接口，Kotlin 校验自己的本地快照，无需 Python 源码或运行进程。

变更内部接口时：

```sh
(cd forge-knowledge && uv run python -m forge_knowledge.export_contract)
python3 scripts/sync-contracts.py
(cd forge-web && pnpm api:generate)
python3 scripts/sync-contracts.py --check
```

`make contracts` 执行同样的显式更新流程。提交时包含生产者与消费者快照；单独发布消费者时使用已提交快照。不兼容变更应新增版本路径并保留旧版过渡期。运行时不拉取最新 schema。
