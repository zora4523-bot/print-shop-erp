# 开发服务器重启与错误边界修复

当前分支 `codex/gongdan`，起点 `3857b68`。重启本仓库 3000 端口的开发进程后，`GET /login` 返回 500：`next/error` 的 `unstable_catchError` 不存在。

核对当前安装的 Next.js 16.3.4 实际导出、`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md` 及 `03-file-conventions/error.md` 后，将组件边界改为 `catchError` / `ErrorInfo.retry`，路由和全局边界改为 `retry` 属性，同步测试与 UI 文档。不修改错误展示文案、权限或业务数据。

验证：

- 四个目标测试文件，9 项通过，包含实际 `next/error` 导出检查与重试回调调用。
- 重启后的登录页 HTTP 200；未登录访问工作台 HTTP 307，重定向到登录入口。
- ESLint 全源码 0 错误、2 条既有 Next.js 跳转警告；UI 文案和 token 检查通过。
- 类型检查仍有既存错误：`lib/pdf/render.ts:52` 的 `networkidle0` 不符合当前依赖类型。该文件未修改，错误与错误边界修复无关，不在重启任务中扩大为 PDF 改造。
- 静态检查排除工作区遗留的 `.next-release`、`.next-durable` 和报告目录，临时 tsconfig 在仓库外；没有修改配置来隐藏源码诊断。

服务器地址 `http://127.0.0.1:3000`。日志位于 `/tmp/erp-dev-restart-20260911/`。保留已有 AGENTS.md 差异和未跟踪构建/测试输出；本次只创建修复的本地提交，不发布或部署。
