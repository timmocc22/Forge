# 独立部署

三个 Dockerfile 的构建上下文分别是各工程目录，不依赖仓库其他工程。

```sh
cp .env.example .env
# 编辑 .env，填写共享 KNOWLEDGE_TOKEN；需要索引时填写 embedding 配置
# 在 deploy 目录执行
docker compose up --build
```

访问 http://127.0.0.1:5179 。Nginx 将 `/api` 转发到 Kotlin；Python 仅容器网络可访问。API 和知识服务分别使用 `api-data`、`knowledge-data` 卷。模型凭据只注入对应服务。Compose 采用 demo 业务模型；接真实业务模型应为 API 单独注入配置。

生产环境需由外部网关提供 HTTPS，并根据实际身份系统补充用户认证与授权。Python 当前采用单实例单 worker；不能直接增加实例数共享同一个数据库。单独部署时，前端容器的 `API_UPSTREAM` 指向 API，API 的 `KNOWLEDGE_URL` 指向知识服务；跨非可信网络使用 HTTPS。

当前机器没有执行容器构建或启动验收。Dockerfile/Compose 为部署入口，原生进程验证结果见 `../docs/VALIDATION.md`。
