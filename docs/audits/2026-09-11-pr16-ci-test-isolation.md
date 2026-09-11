# PR #16 CI 可见性与会话隔离修正

## 失败证据

候选 `b4f89774265f942cbf4bd52b7740922be95296b8` 的 GitHub Actions run `34573590723`：打印 job 成功；综合 job 的静态、单测覆盖率和浏览器组件阶段成功，业务回归阶段运行 35.3 分钟后返回 156 通过、3 失败、1 重试通过、5 项视口限定跳过。后续 durable、兼容性和开发夹具阶段因此未执行。

三项失败均来自 1024×768 考勤页的相同隐藏按钮。CI 保存的截图、trace 与本地几何探针确认：已关闭的 `details` 后代仍有非零布局矩形；Linux 字体使“填为请假 1 天”的矩形右端为 1026.7，而本地为 1022.8。两者都不可见，旧 gate 只检查自身 display/visibility 与矩形尺寸，错误地将其视为可见控件。

会话用例首次返回 404、重试通过：旧用例在刚登录且页面仍可能发出会话续期请求的同一个 context 替换 cookie，存在成功响应覆盖测试令牌的竞态。此证据不等同于服务端接纳过期 JWT；新的隔离用例直接验证服务端拒绝路径。

## 修正范围

- 视觉 gate 使用浏览器 `checkVisibility({ visibilityProperty: true })` 判断是否渲染，并保留矩形、溢出、触控和 axe 阈值。
- 增加浏览器回归：展开再关闭后，隐藏按钮不得误报；重新展开时，真实越界必须失败。旧实现稳定失败，修正后通过。
- 过期和损坏 JWT 各使用一个没有成功登录请求的新 context；保留真实登录生成 cookie、真实签发过期 JWT、401、响应体、禁止缓存及页面登录跳转断言。上下文在 finally 中关闭。
- 不修改产品页面、服务端认证、金额规则或打印像素基线。

## 验证

候选为 `b4f8977` 加本任务三个测试文件；在 `/tmp/erp-pr16-merge-20260911/snapshot` 独立副本验证，不包含共享工作区的其他打印改版。所有数据库写入限于已明确确认的独立 E2E 库 `erp_e2e_pr16_20260911`。

- 独立浏览器可见性回归：旧实现 1 失败；新实现 1 通过。
- `pnpm exec playwright test --config=playwright.release.config.ts --grep 'attendance filters and settings|过期和损坏的 JWT|已签发的合法令牌|viewport gate checks expanded'`：production build/start，9 通过、0 失败、0 跳过。覆盖六种视口的考勤/设置明暗主题和原有 overflow、touch、axe 门禁，以及会话与可见性回归。
- 三个测试文件 ESLint、独立副本 `pnpm typecheck`、`git diff --check` 通过。
- 本任务只改变测试；原候选完整业务回归 160 通过、5 项视口限定跳过、打印 21/21、durable 3/3、兼容性 20/20 的本地证据见同目录前两份审计记录。本次不将这些旧结果描述为新提交重新执行的完整远端 CI。

本地日志位于 `/tmp/erp-pr16-merge-20260911/` 下 `current-verify.log`、`gate-before.log`、`gate-after.log`、`ci-followup-targeted.log`、`ci-followup-lint.log` 与 `ci-followup-types.log`。远端新提交的完整检查与合并状态另以 PR 实际结果为准；本记录不代表生产部署或目标环境验收。
