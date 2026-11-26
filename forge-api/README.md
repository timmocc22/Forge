# forge-api

独立 Kotlin + Spring Boot 业务服务，JDK 25。项目、会话、生成任务和项目访问校验由此服务负责；文档作业和索引属于知识库服务。

```sh
cp .env.example .env
./gradlew formatKotlin
./gradlew build
./scripts/start.sh
# 开发运行
./gradlew bootRun
```

默认监听 127.0.0.1:3009，健康接口 `/api/health`。构建只需要本目录和 Maven 依赖；jar 不包含前端静态资源。`scripts/start.sh` 可探测本机 JDK，手动运行 Gradle 时需配置 JDK 25。

配置由本目录 `.env` 和进程环境提供，进程环境优先。`DATA_DIR=.data` 是 API 专用存储；默认 SQLite，可显式配置 PostgreSQL JDBC。`KNOWLEDGE_URL`、`KNOWLEDGE_TOKEN` 指向单独运行的 Python 服务。默认只允许 HTTPS 或 loopback HTTP；可信容器内网可显式设 `KNOWLEDGE_ALLOW_HTTP=true`。

公开契约在 `src/main/resources/contracts`，Python 接口的消费快照在 `contracts`。提交后由 Python 自主执行作业，API 通过 HTTP 查询和重试。API 停止不会停止 Python 入库任务。

运行 `./gradlew checkKotlinFormat` 检查 Kotlin 风格；`build` 包含格式和测试。容器独立构建：`docker build -t forge-api .`。公开 API 的契约与认证策略仍面向当前本地单用户场景。
