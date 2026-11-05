# 验证记录

当前功能与执行边界以 [HTML_STUDIO.md](HTML_STUDIO.md) 和 [QUALITY.md](QUALITY.md) 为准。旧版界面、插件和生成队列的测试记录已随退役模块移除，不能作为当前产品的验收依据。

HTML 浏览器验收入口为 `tests/e2e/html-projects.spec.ts`，默认启动隔离的演示 API 与 Vite 服务，端口为 3108 / 5188，数据存储在 `.data/e2e-html-projects`。并行会话应使用独立端口、数据目录与测试输出路径。

生成动效的生命周期通过可控 HTTP 状态验证，实际演示生成与持久化由其他 HTML 用例覆盖；两者均不代表真实付费模型验收。
