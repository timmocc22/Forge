# Tauri 桌面壳

桌面版复用 `apps/web` 的全部界面，通过 Tauri 2 加载打包后的静态资源。Nest API 独立运行，安装包不包含 Node、模型密钥、`.env` 或作品数据库。

## 开发

需要项目要求的 Node / pnpm 和 Rust 1.88.0（根目录 `rust-toolchain.toml` 已固定）。macOS 安装 Xcode Command Line Tools；Windows 安装 Microsoft C++ Build Tools 的“使用 C++ 的桌面开发”和 WebView2。

已有 `pnpm dev` 在运行时，直接复用两个开发服务：

```bash
pnpm desktop:dev:running
```

从零启动时，分别在两个终端运行：

```bash
# 终端一：构建共享包并启动独立 API
pnpm build:packages
pnpm --filter @studio/api dev

# 终端二：启动前端和原生窗口
pnpm desktop:dev
```

`desktop:dev` 会启动 Vite；关闭桌面开发进程后，API 继续由第一个终端管理。默认前端端口 5177，API 端口 3007。

## API 连接

浏览器和桌面开发窗口默认通过 `/api` 使用 Vite 代理；打包后的桌面窗口默认连接 `http://127.0.0.1:3007/api`。API 未启动时，工作台显示连接失败，可在启动 API 后刷新连接状态。

如需其他地址，在根目录 `.env` 或 CI 环境配置 `VITE_API_BASE_URL=https://your-service.example.com/api`，然后重新构建。该值是公开的构建配置，不可包含模型密钥。非本机地址只接受 HTTPS；现有 API 默认仅监听回环地址，远程服务需自行通过 HTTPS 反向代理部署。

API 的 `DESKTOP_CLIENT_ENABLED` 默认 `true`，只增加 `tauri://localhost`（macOS）和 `http://tauri.localhost`（Windows）两个精确来源，同时用于 CORS 和写入请求的来源检查。修改 API 代码或配置后需重启已有 API；纯 Web 部署可设为 `false`。不放行 `null` 或任意网页来源。

作品仍存储在 API 所在电脑的 `DATA_DIR`；连接远程 API 时，作品保存在该服务端。浏览器与桌面的界面偏好、本地草稿分别存储。

## 原生能力

- 使用系统标题栏，支持移动、缩放、最小化、最大化和关闭；窗口默认 1440 × 920，最小 960 × 640。
- 作品导出使用系统“另存为”对话框，用户选择路径后才写入文件。取消不会写文件，失败交由现有界面显示。普通浏览器继续使用下载链接。
- 只有 `main` 窗口获得保存对话框和写文件权限，无全盘读写范围；保存路径由对话框临时授予。
- HTML 预览保持 `sandbox="allow-scripts"` 和独立 CSP，禁止网络、嵌套页面和表单提交。宿主 CSP 的 `script-src` 保留 `unsafe-inline` 并单独关闭该指令的自动 hash 注入，因为 `srcdoc` 继承宿主策略，自动注入 hash 会使预览所需的内联脚本失效。其他 CSP 指令仍生效，宿主不允许外部脚本。

## 打包

在目标系统执行（构建会先编译共享包与 Vue 前端）：

```bash
pnpm desktop:build -- --locked
```

- macOS：`src-tauri/target/release/bundle/macos/Forge.app` 和 `bundle/dmg/*.dmg`；最低 macOS 14.5，以覆盖现有前端使用的 WebKit API。Apple Silicon 与 Intel 需分别构建，或使用下方 CI 矩阵。
- Windows：`src-tauri/target/release/bundle/nsis/*-setup.exe`，按当前用户安装，无需管理员权限，安装器支持简体中文和英文；需要 Windows 10/11 与 WebView2 120+。
- 仅校验 Rust：先运行 `pnpm desktop:build:web`，再运行 `pnpm desktop:check`。配置和前端产物会在编译时读取。

`.github/workflows/desktop.yml` 可手动触发，或推送 `desktop-v*` 标签触发，分别生成 macOS ARM64、macOS Intel、Windows x64 安装包并上传到 Actions artifacts。`DESKTOP_API_BASE_URL` 仓库变量可覆盖默认 API 地址。此工作流仅构建并存档，不创建 Release、不发布、不签名。

当前没有配置 Apple Developer / Windows 代码签名和 macOS 公证。对外分发前需接入对应证书、签名和公证；实际 Windows 安装与两个架构的 macOS 验收应分别记录。

配置依据：[Tauri Vite 接入](https://v2.tauri.app/start/frontend/vite/)、[构建配置](https://v2.tauri.app/reference/config/)、[开发前置条件](https://v2.tauri.app/start/prerequisites/)、[GitHub 构建](https://v2.tauri.app/distribute/pipelines/github/)。
