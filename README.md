# Forge

同一仓库中的三个独立工程，保留 Vue 工作台，Kotlin 负责业务，Python 负责知识库。工作区脚本只用于本地联调，各工程构建不读取其他工程源码。

| 工程 | 技术栈 | 责任 | 本地端口 |
| --- | --- | --- | --- |
| [forge-web](forge-web/README.md) | Vue 3、TypeScript、Vite、Pinia、Tauri | 工作台、预览、桌面壳 | 5179 |
| [forge-api](forge-api/README.md) | Kotlin、Spring Boot、JDBC | 项目、会话、生成任务、权限边界、公开 API | 3009 |
| [forge-knowledge](forge-knowledge/README.md) | Python、FastAPI、LlamaIndex、SQLAlchemy | 解析、切块、入库作业、向量检索、重排 | 3017（内部） |

## 本地启动

要求 Node 22.13+/24、pnpm 9、JDK 25、Python 3.12/3.13、uv。现有本地 Node 工具链放在 `forge-web/.toolchains`，工作区脚本会使用它；不会修改系统环境。uv 需在 PATH 中。

```sh
python3 scripts/init-local.py
(cd forge-web && pnpm install --frozen-lockfile && pnpm build)
(cd forge-api && ./gradlew build)
(cd forge-knowledge && uv sync --frozen)
./scripts/start.sh --knowledge
```

打开 http://127.0.0.1:5179 。`./scripts/dev.sh --knowledge` 启动开发模式。去掉 `--knowledge` 可以单独联调前端和 API；知识库相关操作需要 Python 服务在线。每个工程也可按各自 README 单独启动。

初始化脚本仅创建缺失的 `.env`，生成本地共享服务令牌，不覆盖已有配置。模型密钥留空；文档索引前配置 Python 的 embedding 地址、模型、维度和密钥。默认业务模型为 demo，启动不调用付费模型。

## 验证与部署

```sh
./scripts/test.sh                  # 各工程构建与单元测试、契约快照检查
python3 scripts/check-boundaries.py # 检查构建边界、API jar 无前端资源
PLAYWRIGHT_CHANNEL=chrome ./scripts/test.sh e2e
```

[架构和数据归属](docs/ARCHITECTURE.md) · [接口契约流程](contracts/README.md) · [部署](deploy/README.md) · [迁移说明](docs/MIGRATION.md) · [验证记录](docs/VALIDATION.md)

当前交付面向本地单用户。真实模型、PostgreSQL/pgvector、容器运行、安装包和多实例部署的验证范围见验证记录。
