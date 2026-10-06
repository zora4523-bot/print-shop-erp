# 规则执行与导航验证

> 历史候选记录：以下结果仅适用于 2026-10-03 的分支。OSS 异常语义、独立导航配置及以禁止 mock 为由跳过全量测试的结论已由 [2026-10-06 修复记录](./2026-10-06-pr52-review-fixes.md) 取代；本页保留当时证据，不作为现行开发规范。

日期：2026-10-03。分支：`codex/dev-main-2026-10-03`。开始提交：`36dabe1c6c10d276e6e5bf21d560cbcc5175d358`，开始工作区干净。

## 当前实现

- 规范文档及本次涉及的注释使用当前有效设计说明，保留权限、金额、历史数据、原生表单与九视口要求。
- CDR 模式判断和设计文件地址校验直接报告 OSS 配置错误。配置有效时，已有模式选择和文件地址规则保持原有行为。
- 文案检查的中间文件写入项目内的 `test-results/ui-copy/`；Markdown 映射内容通过明确的数据和文本断言验证。
- 导航使用真实 Next.js 页面、PostgreSQL 和登录会话。原有 62 项检查覆盖保留，账号操作扩展为管理员、销售各自的手机与桌面检查，共 65 项。
- 账号菜单按 Escape 关闭后恢复按钮焦点；退出项使用共享菜单组件，支持方向键、Enter 与鼠标操作，通过原生表单提交 `signOutAction`。
- CI 的独立 `navigation` 任务在 PR 和 main 执行，使用隔离数据库及生产构建。

## 验证环境

Node 24.15.0，pnpm 10.33.1，Next.js 16.3.6，Playwright 1.59.1，Chromium 147.0.7727.15。

浏览器验证使用 `next build` / `next start`，构建 ID 为 `WkjxrO-7zXqzxxbZNxepW`。数据库为本机独立的 `erp_e2e_navigation_20261003`，端口为 3114。测试写入前校验数据库隔离状态与实际库名；测试服务已关闭。

`TMPDIR` 设置为项目内已忽略的 `.review/runtime-tmp`。截图、视频及 trace 均关闭。

## 工程验证

- `pnpm exec vitest run lib/cdr/__tests__/zip-config.test.ts lib/oss/__tests__/config.test.ts scripts/ui-copy/__tests__/check.test.ts`：3 个文件、74 项通过。
- `pnpm lint`：通过，UI 文案和 UI token 检查均为零新增问题。`app/global-error.tsx:43` 与 `components/business/order/OrderCreatedSuccessView.tsx:21` 各保留一条既有导航 warning。
- `pnpm typecheck`：通过。
- 生产构建：通过，包含 TypeScript 检查及 69 个静态页面生成。
- `pnpm exec playwright test --config=playwright.navigation.config.ts --grep '账号操作' --max-failures=1`：最终构建中的四项账号专项检查通过。
- 配置上述隔离库、测试账号和 `E2E_BASE_URL=http://127.0.0.1:3114`，设置 `E2E_PREBUILT=1` 后执行 `pnpm exec playwright test --config=playwright.navigation.config.ts --max-failures=1`：65 项通过，0 失败、0 跳过、0 flaky，报告 `errors=[]`，耗时 215 秒。
- CI YAML 语法、本地文档链接、测试覆盖对应关系及 `git diff --check`：通过。

本地原始证据位于忽略目录：`.review/navigation-final.json`、`.review/navigation-final.log`、`.review/navigation-account-final.log`、`.review/navigation-account-validation.log`。这些文件保留至本地清理；本记录保存本次执行范围和结果。

## Design QA

本次 UI 范围为管理员与销售共用的账号菜单及导航验证。按用户要求，使用代码、DOM、计算样式、真实交互与 axe；图像检查未执行。

1. 视觉层级：账号名称、角色、修改密码与退出登录保持既定信息顺序，DOM 可见性检查通过；未执行三秒图像检查。
2. 排版与留白：导航边界、长标题、菜单文字位置检查通过；退出项使用共享菜单间距。
3. 色彩与对比度：浅色、暗色导航及展开后的账号菜单 axe 检查通过，测量前等待实际动效完成。
4. 组件一致性：账号菜单使用现有 `DropdownMenu`、`DropdownMenuItem` 和主题令牌，共享原子件保持现有实现。
5. 交互反馈：菜单打开、Escape 关闭、焦点恢复、方向键选择、Enter 提交、鼠标提交及退出结果检查通过。
6. 动效：正常动效与 Reduced Motion 检查通过。管理员 1280px 账号组合使用 Reduced Motion。
7. 响应式：管理员、销售均通过浅色与暗色的九视口检查：320×568、375×667、390×844、393×852、430×932、768×1024、1024×768、1280×800、1920×1080。账号专项在 393px 与 1280px 执行。
8. 功能质量：真实登录、退出、父级链接、菜单状态记忆和受保护页面访问检查通过；浏览器 Console Error 与 pageerror 断言通过。服务端日志事项见下节。
9. 可访问性：axe、触控区域、键盘焦点、方向键、Escape、Enter 和 Reduced Motion 检查通过。
10. 原创性：使用项目现有组件与设计规则，本次没有新增视觉资产。

## 验证范围与日志事项

- 本记录覆盖本次代码、文档及导航检查。全站图像验收和远端 CI 未执行。
- 全量 Vitest 未执行：其他既有测试仍使用 mock；本次执行的目标测试和导航检查使用真实依赖及行为。
- 构建报告两条动态目录追踪 warning，位置为 `lib/agent-monthly-billing/export-artifact.ts:68:21` 与 `lib/order/export-artifact.ts:70:21`，均涉及 `readdir(directory)`；相关文件本次没有修改。
- 完整运行的服务端日志第 93、99 行记录 `The destination stream closed early.`。安装版 React 的目标流 `close` 处理器产生此信息，具体关闭请求未记录；对应页面检查及浏览器错误检查均通过。此结果不代表服务端日志没有异常记录。

本次没有推送或部署。
