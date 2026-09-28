# 返回入口与排单结果修复记录

范围：2026-09-29 用户对排单页“返回工单列表”的反馈及同类入口核查。基线为 `8c396b89146c7a32378c010494ad3126c2cbc0fc`，候选为基线加本记录所在提交的变更；分支 `codex/design-removal`。既有 `.playwright-cli/` 和两份 2026-09-21 首次使用审查文档不属于本任务。

## 落点核对

原审查扫描 430 个 TSX 文件，静态识别 42 个含“返回/取消”的 `Link`、`a`、`PendingLink`；28 处已使用共享按钮样式，14 处使用局部样式。此数字是该静态筛选的范围，不代表全项目所有导航控件。

| 原入口 | 数量 | 本次处理 |
|---|---:|---|
| [排单表单](../../components/business/production/ProductionDispatchForm.tsx)返回工单列表 | 1 | 次级按钮；提交中禁止离开，成功后提供结果导航 |
| [排单页面](../../app/(admin)/orders/production/page.tsx)无权限、选择数量无效时返回 | 2 | 次级按钮；非管理员使用相同恢复入口，权限仍在取数前拒绝 |
| [新建外协表单](../../components/business/outsource/CreateOutsourceForm.tsx)返回工单详情 | 1 | `PendingLink` 与次级样式，操作行、长款式名称允许换行 |
| [师傅登记完成](../../components/business/production/WorkerCompletionDetail.tsx)返回生产工单 | 1 | 次级按钮 |
| [报工详情](../../app/(worker)/worker/reports/[id]/page.tsx)返回我的报工 | 1 | 次级按钮 |
| [工序计件结算/时薪详情](../../app/(worker)/worker/salary/[id]/page.tsx)返回我的工资 | 2 | 次级按钮，两个分支一起处理 |
| [工序/共享进度详情](../../app/(worker)/worker/tasks/[id]/page.tsx)返回工单选择工序 | 2 | 次级按钮，两个分支一起处理 |
| [规格目录](../../app/(admin)/owner/rules/specifications/page.tsx)返回纸张 | 1 | 页头次级按钮 |
| [修改密码](../../app/account/password/page.tsx)返回首页 | 1 | 次级按钮，保留链接导航 |
| [新建账号](../../app/(admin)/owner/accounts/new/page.tsx)说明里的返回列表 | 1 | 保留文字链接；`AccountForm` 操作区已有共享返回按钮，避免重复强化 |
| [CDR 汇总](../../app/(admin)/foreman/cdr/page.tsx)说明里的返回管理后台 | 1 | 保留正文辅助链接 |

共统一 12 处独立入口，保留 2 处正文辅助链接；未新增按钮原子件。导航仍为锚点，不改为嵌套按钮或 `onClick` 跳转。

最终对 `app/`、`components/` 非测试 TSX 再次核对该类入口：43 项匹配中 41 项使用共享样式，仅剩上述两项已明确保留的正文链接；排单成功区新增一个返回入口，使匹配数增加 1。结果保存在 `navigation-links-final.json`。

截图复核另外发现：`buttonVariants` 原样返回基础 `border-transparent` 与 outline 的 `border-border`，直接使用该 helper 的锚点实际边框仍可能透明。`Button` 本身经 `cn` 合并所以没有同样的问题。现将相同合并放到共享 helper 内，保留参数类型与导出契约，让已有调用方也得到所选 variant；浏览器按真实计算样式检查六视口明暗下的边框，而非只搜索类名。修复前 375px 明亮模式断言实际得到透明边框（`outline-before.log`）。

## 行为修复与边界

- 排单成功后不再显示仍可点击的“返回修改”或草稿操作，也不再显示被浏览器重置为空的禁用下拉框。成功结果使用服务端回执张数，逐单定位到现有生产记录区。
- 排单与创建外协的返回入口在 pending 期间阻止点击和 Next 客户端导航，并移出键盘顺序。失败恢复可操作状态。
- React action 即使返回业务失败也会触发表单重置；排单表单阻止原生 reset，保持师傅选择和原重试标识。恢复草稿仍不能覆盖已锁定归属。
- 保存提交时的草稿键，避免页面重新取数、版本前移后清理错草稿。
- `/orders/production` 使用精确面包屑标签，不再落到工单详情标签；普通工单详情和编辑路由保持原标签。
- 服务端 action、领域状态机、金额、薪资、资源所有权、数据库 schema、迁移和外部销售状态契约均无变更。原确认层和发布排单动作保留。

## 验证记录

证据目录：`/var/folders/1m/qlr1bwhj2h7ck5qbntt0xdcm0000gn/T/erp-return-button-fix-t3ztxdrk`。原静态审查与复现位于 `output/playwright/button-audit-20260929/`（均为本机忽略的输出，不进入提交）。

修复前：pending 返回保护断言失败；失败重试用例停在错误反馈语义断言，未执行到选择保留断言（另 14 项按名称过滤未执行）。原审查两项复现证明成功后仍可返回修改、重建草稿，提交中返回链接仍活跃。

已执行：

- `pnpm test:browser components/business/production/__tests__/ProductionDispatchForm.browser.spec.tsx components/business/outsource/__tests__/CreateOutsourceForm.browser.spec.tsx`：17 项通过，0 失败/跳过。覆盖 pending、失败重试、成功后导航、草稿版本隔离、锁定师傅、外协成功目的地及批量长名称六视口明暗/44px/axe/真实边框样式；最终日志 `browser-components-outline-final.log`。
- 在隔离库环境下 `pnpm test --run` 指定 `AdminBreadcrumb.test.tsx`、`PendingLink.test.tsx`、`create-entry.test.tsx`、`worker-task-report-batch.test.tsx`、`worker-task-legacy-dispute.test.tsx`、`task-dispute-entry.test.ts`、`production-dispatch.test.ts`、`primitives.test.tsx`、`interaction-css-contract.test.ts`：9 文件 100 项通过，0 失败/跳过，最终日志 `unit-all-final.log`。
- `pnpm typecheck` 通过；`pnpm lint` 无错误，保留 `app/global-error.tsx` 与 `OrderForm.tsx` 两条既有 Next 导航警告；UI 文案与令牌门禁无新增违例。
- `scripts/e2e-release-build.ts` 发布构建通过，使用 `.next-release`，不覆盖 3000 端口开发服务器的构建目录。

最终发布构建浏览器矩阵 **25 项通过，0 失败、0 跳过、0 flaky**，耗时 5.1 分钟，报告无全局错误。覆盖六视口（375×667、393×852、768×1024、1024×768、1280×800、1920×1080）、明暗主题、overflow、44px touch、axe，以及真实排单提交/结果跳转、师傅登记数量、管理员核定与提成、外部销售状态、外协创建/回货/付款。浏览器保留原权限、金额与审计断言。最终日志 `release-browser-outline-final.log`，结构化报告 `release-browser-final.json`。

运行方式：隔离环境包装器 `browser-run.cjs` 准备 `E2E_BASE_URL=http://127.0.0.1:3120`、`E2E_PREBUILT=1` 与专用测试账号后，运行：

```sh
pnpm exec playwright test --config=playwright.release.config.ts \
  tests/visual/production-dispatch.spec.ts tests/visual/admin-responsive.spec.ts \
  tests/visual/worker-responsive.spec.ts tests/e2e/outsource-flow.spec.ts \
  --grep 'single owner dispatch|standalone return controls|worker routes pass|逐款外协' \
  --workers=1 --max-failures=1
```

所有写入使用独立库 `erp_e2e_remediation_browser_1790611706621`；通知为 mock，任务为 inline，不作为真实通知或后台 worker 验收。此为本次 UI 变更的相关检查，未运行全量发布候选门禁。

过程中发现并处理的失败：

1. 首轮发布构建测试 13 项通过、1 项失败、11 项未执行。新增外协页面门禁暴露了原有长款式名称在 375px 下撑到 424px 的问题；调整该表单及标签的收缩/换行，未删长文本 fixture，也未放宽 overflow 门禁。
2. 第二轮 2 项通过、1 项失败、10 项未执行。新增成功结果跳转后，测试已停在详情 hash；随后再导航同一 hash 不重新取数，仍显示师傅提交前内容。改为在另一个会话提交后刷新当前详情，保留真实数量审批和工资断言；第三轮管理员入口与完整流程 12 项通过。此项为新增测试导航前提问题，不修改应用的缓存或审批逻辑。
3. 人工截图发现锚点边框透明，补充实际计算样式断言，修复共享 helper 后 17 项组件测试及 100 项目标单测通过；随后重新构建并复跑完整相关浏览器矩阵。

内嵌浏览器在正常开发环境上核对了面包屑与返回入口，返回链接保留 `/orders?queue=production`、44px 高度和正常 Tab 顺序；未提交真实工单。页面截图仅用于视觉检查，自动化中的业务写入均在上述隔离库完成。

复核：Codex 已检查本次代码差异、移动端明亮与桌面深色结果截图、测试日志和文档链接。截图保存在 `test-results/production-dispatch-ui-baseline-candidates/` 与 `test-results/admin-ui-baseline-candidates/`，未更新任何像素基线；本记录与修复一并本地提交。
