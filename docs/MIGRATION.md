# 迁移说明

本次将旧的 `apps/web`、`backend`、`services/knowledge` 整理为 `forge-web`、`forge-api`、`forge-knowledge`，保留一个 Git 仓库。原始 `/Users/yanjiachuan/Desktop/Forge` 与 `/Users/yanjiachuan/Desktop/agent-studio` 不在本次修改范围内。

前端内部包、Tauri 和 Node 工具链归入前端；Gradle wrapper 和 JVM 配置归入 API；uv 锁文件、模型配置和 Python worker 归入知识服务。工作区不再有统一 package.json 或 Gradle 多模块构建。

接口来源改为生产者维护、消费者保存版本化快照。知识库队列从 Kotlin 项目记录中移出，Python 独立接收、持久化和恢复入库作业；旧的 `knowledgeJobs` 字段不再作为活动队列执行。

当前迁移工程已有的 API 数据保留到 `forge-api/.data`。不从原始应用复制 `.data` 或模型凭据。需要导入原始项目时，显式设置 API 的 `IMPORT_LEGACY_DIR`，由导入器只读源目录。旧结构的备份位置记录在 `validation.json`；备份可能包含本地数据和配置，不应上传 Git。

服务由原来的 jar 同时提供页面改为前端 5179、API 3009、知识库内部 3017。浏览器使用 5179；API 根路径不提供页面。

本次不涉及真实付费模型、PostgreSQL/pgvector 运行验收、桌面安装包或多实例架构。具体检查以验证记录为准。
