# forge-web

独立的 Vue 3 + TypeScript + Vite 工作台，Pinia 状态管理，Tauri 桌面壳。`packages` 是本工程内部包，不依赖 Kotlin 或 Python 源码。

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm dev
# 发布静态资源
pnpm build
# 验证
pnpm test
```

要求 Node 22.13+/24、pnpm 9。复制 `.env.example` 为 `.env`，`STUDIO_API_PROXY` 指向单独运行的 API，默认 `http://127.0.0.1:3009`。浏览器访问 5179，Vite 将 `/api` 代理到 API。生产部署使用 Nginx 同域代理，避免向浏览器暴露内部服务令牌。

`pnpm api:generate` 仅根据本地 `contracts/forge-api.v1.openapi.json` 更新客户端类型。`pnpm test:contracts` 校验运行中 API，地址通过 `API_URL`（包含 `/api`） 配置。浏览器测试要求已运行独立 API（`E2E_API_URL`，默认 3108），由测试自身启动本工程 Vite。

Tauri 的 `pnpm desktop:dev` / `pnpm desktop:build` 只处理桌面壳和前端；API、Python 需要独立部署。Rust 检查为 `pnpm desktop:check`，本次结构调整没有验收安装包。容器可独立构建：`docker build -t forge-web .`，运行时用 `API_UPSTREAM` 配置 API 内网地址。
