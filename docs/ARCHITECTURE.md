# HTML 创作工作台架构

产品仅包含 HTML 项目创作。Vue 前端负责对话、作品列表、分镜编辑、隔离预览与导出；Nest API 负责版本化项目存储、分镜规划、逐页生成、续改、取消与撤销。

## 工作区

| 工作区                | 职责                                      | 内部依赖                  |
| --------------------- | ----------------------------------------- | ------------------------- |
| `apps/web`            | Vue、Pinia、HTML 工作台、浏览器与桌面导出 | contracts、plugin-sdk、ui |
| `apps/api`            | Nest HTTP、项目存储、文本模型适配         | contracts                 |
| `packages/contracts`  | 项目、页面、HTML 生成输入和模型目录协议   | 无                        |
| `packages/plugin-sdk` | HTML 预览 CSP、草稿与导出端口             | 无                        |
| `packages/ui`         | 选择器、弹出层                            | 无                        |

`plugin-sdk` 沿用原包名，当前只包含 HTML 工作台使用的环境无关接口与预览函数，不再提供插件注册或执行机制。构建由 pnpm、Lerna 和 Nx 调度，依赖方向由 `scripts/check-boundaries.mjs` 校验。

## 项目与对话模块

`HtmlProjectController` 保持现有 HTTP 路由，分别调用项目服务与对话服务。`AppModule` 只组合配置、模型生成和项目模块。`ProjectsModule` 创建并注入同一份 `ProjectRepository` 和 `ProjectTasks`，两个业务服务不相互调用。`GenerationModule` 管理模型路由器及其关闭清理，只导出 `GENERATION_PROVIDER` 注入令牌；项目服务依赖 `GenerationGateway` 接口，不引用具体路由器或服务商实现。

服务端按功能模块组织，再按实际职责分目录；测试与服务商适配就近放置，跨流程的项目集成测试放在 `projects/tests`。

```text
apps/api/src/
├── app.module.ts               # 根模块组合
├── config.module.ts            # 配置注入
├── generation/
│   ├── generation.module.ts    # 模型模块装配
│   ├── ports.ts                # 模型调用接口、注入令牌和错误
│   ├── http/                   # 健康检查和公开模型目录
│   ├── routing/                # 模型选择、调用路由和并发限制
│   └── providers/              # 服务商协议适配，含各自测试
│       ├── openai/
│       ├── deepseek/
│       └── zhipu/
└── projects/
    ├── projects.module.ts      # 项目模块装配
    ├── http/                   # HTTP 参数校验和服务转发
    ├── authoring/              # 创建、编辑、撤销、生成与演示内容
    ├── conversation/           # 连续问答和上下文组装
    ├── persistence/            # JSON 仓库与原子写入
    ├── runtime/                # 共享任务容量、取消与关闭
    ├── shared/                 # 编排与问答共用的版本检查、模型选择
    └── tests/                  # 项目工作流集成测试
```

`generation` 不依赖 `projects`；`projects` 仅通过 `generation/ports.ts` 使用模型能力，模块装配时导入 `GenerationModule`。这些跨模块约束由 `scripts/check-boundaries.mjs` 检查。`authoring`、`conversation` 是服务职责分组，当前仍直接使用 Nest 异常和 JSON 仓库，未声明为独立领域层。

| 模块                                     | 职责                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `HtmlProjectService`                     | 项目创建、编辑、撤销、规划、生成、取消，以及重启后的运行恢复                         |
| `ConversationService`                    | 当前页询问、同项目询问互斥、答案校验、完整问答落盘与关闭时清理                       |
| `conversation-context.ts`                | 纯函数组装问题、当前页面、项目背景与最近问答；保留最多 10 轮、64000 字符的历史上下文 |
| `ProjectRepository`                      | JSON 读取与校验、项目摘要查询、隔离的记录快照、串行写入队列与原子文件替换            |
| `ProjectTasks`                           | 生成和询问共享任务容量、AbortController 与关闭信号，维持合计最多两个任务的限制       |
| `project-policy.ts` / `project-model.ts` | 共享版本检查与模型选择规则                                                           |

业务服务通过仓库的 `transaction` 写入作用域读取最新快照并保存；每次 `save` 原子替换一个项目文件，整个作用域不提供跨文件回滚。模型调用在写入作用域之外执行，避免长时间占用写入队列。对话完成后重新读取最新项目记录，只追加消息，保留模型等待期间保存的页面修改。仓库仅在磁盘写入成功后替换内存记录；生成状态无法落盘时保留原有的内存失败提示。

存储目录、JSON 字段、HTTP 路由与响应协议保持兼容。问答追加不更新项目 revision、updatedAt 或撤销历史；无对话字段的旧记录在首次成功询问时建立消息记录。

## 请求与数据

`/api/html-projects` 提供创建、读取、保存、撤销和生成控制。每个项目独立保存到 `DATA_DIR/html-projects/<uuid>.json`；写入串行化并以临时文件加原子替换提交。客户端提供 expectedRevision 和操作标识，旧版本返回 409。当前内容、撤销历史和生成状态由同一份持久化记录承载。

规划通过结构化文本模型返回分镜，生成逐页调用文本模型返回完整 HTML。续改发送目标页当前 HTML 及相关上下文，只提交目标页结果。演示模式由项目服务提供规则分镜与样例，保留手动编辑并明确标注来源。模型路由在任务开始前固定选择，统一限制并发；各服务商拥有独立密钥、端点和代理。

前端轮询实际生成状态；生成动画只在任务运行时显示，进度使用实际完成页数。浏览器 IndexedDB 草稿按窗口隔离，刷新恢复，冲突不静默覆盖服务端。

## 运行边界

生成 HTML 在不授予同源权限的 iframe 中运行，CSP 禁止网络、外部脚本、嵌套页面和表单。导出保留离线约束；浏览器使用下载链接，Tauri 使用用户选择的保存路径。模型密钥只在 API 进程使用，公共模型目录不返回密钥、端点或代理。

API 默认监听回环地址并限制写请求来源。服务重启会将未完成任务标记为中断，不自动重放模型请求。项目仓库当前适用于单进程、单用户运行，尚不支持多实例共享写入。桌面壳与发布约束见 [desktop.md](desktop.md)。
