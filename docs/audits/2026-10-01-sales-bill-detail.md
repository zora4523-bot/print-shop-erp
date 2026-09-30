# 销售工单逐笔明细与货款账单层级

- 日期：2026-10-01；候选：`ebe73633` 加本任务增量；分支：`codex/order-leave-recovery`。最终本地提交由 `git log` 中 `fix(sales): 明确货款账单口径并优化逐笔明细` 定位。
- 用户依据：参考 `/Users/zhixing/历史订单` 的逐笔列表和记录 ID 关联明细；外部销售账单是销售应付给工厂的货款。
- 开始时仅有未跟踪 `.playwright-cli/`，原样保留。本次不写入生产库，不更改 schema、查询授权、结算规则或快照计算。

## 交付

1. 导航、面包屑、页面标题共用“我的货款账单”；副标题明确付款方向。状态统一由 registry 提供“整理中 / 待付款 / 已结清”。
2. 月账单页优先呈现当前筛选汇总、筛选与导出、列表和分页；金额分布默认折叠放在列表后，总览页仍直接展示图表。
3. 账单逐笔表格展示工单号、名称、结算日期、工单金额与状态。点击工单号查看结算时费用、完整时间、纸单版本、抵扣记录及当前工单链接；不重复放置大按钮。管理员抵扣入口及资格判断保留。
4. “工单金额”是结算快照原金额，“应付货款”是账单抵扣后的合计。账单页不拿当前工单纸张、数量或费用冒充冻结资料。
5. 收款记录默认折叠，摘要保留是否收款及已收金额，展开仍可核对完整时间、方式和流水号。搜索与导出共用可换行工具栏，明细更靠前。
6. 销售工单在 768px 起使用紧凑逐笔表格，手机保留卡片。保留工单号/名称预览、工单号复制、详情/补正、月账单及物流入口；款式大图和所有运单复制在预览中可达。
7. 账单明细表保持最低可读宽度，避免窄桌面中名称、状态和金额逐字挤压；横向滚动仅发生在表内。

## 验证环境与范围

- Next.js 16.3.4，生产构建 `.next-release`；自动化地址 `127.0.0.1:3337`，保留预览 `127.0.0.1:3336`。
- PostgreSQL 仅使用 `erp_e2e_dabiaoge_final_0930`，写入用例在独立账号追加测试数据。通知/CDR 为 mock，后台任务 inline；不代表生产通知或 durable worker 验收。
- 浏览器手动操作使用“大表哥（历史回放测试）”账号，核对工单、月账单、13 笔月明细及工单号关联弹层。历史回放不是实际履约证据；本次未重新导入或覆盖原始订单。
- 六视口：375、393、768、1024、1280、1920；明暗主题、overflow、44px 触控、axe、弹窗焦点返回和收款摘要键盘展开。
- 导出覆盖跨页 33 笔、冻结名称、查询筛选、HTTP 失败后重试，以及他人账单拒绝访问和伪造账号参数仍只导出本人数据。

## 检查命令与结果

- `pnpm exec vitest run` 指定 `sales-bill-pages.test.tsx`、`bill-detail-visibility.test.tsx`、`SalesOrdersList.test.tsx`、`admin-menu.test.ts`：4 文件，70 通过，0 跳过。
- `pnpm exec vitest run --config vitest.browser.config.ts components/business/order/__tests__/SalesOrdersList.preview.browser.spec.tsx`：5 通过，0 跳过，覆盖大图、全运单、工单号入口、行高和窄屏目标。
- `pnpm lint`：0 errors；保留 2 条既存 `window.location.assign` warnings（`app/global-error.tsx`、`OrderCreatedSuccessView.tsx`）。最后改动文件额外定向 ESLint 通过；UI 文案与令牌门禁无新增违例。
- `E2E_RELEASE_MODE=1 pnpm typecheck`：串行重跑通过。`E2E_RELEASE_MODE=1 pnpm build`：最终构建通过。
- `pnpm exec playwright test tests/e2e/bill-workspace.spec.ts tests/e2e/sales-overview-export.spec.ts tests/e2e/sales-functional-review.spec.ts --grep '月账单两端|销售总览|销售搜索|销售异常筛选|销售列表、详情|管理员确认月账单' --config=playwright.release.config.ts --project=chromium`：累计 7 个独立相关用例通过。首轮测试定位问题详见下方；最后布局改动后 `bill-workspace.spec.ts` 与 `sales-overview-export.spec.ts` 整文件 3 项再通过（含两端六视口、明暗主题、完整导出与隔离）。其余 4 项销售搜索、异常筛选、六视口列表/详情/编辑、确认账单隔离在前轮已通过，本轮最后仅调整账单表格最低宽度，无工单或编辑业务变化。
- E2E 设置显式 `E2E_DATABASE_URL`、`E2E_DATABASE_CONFIRM_DATABASE`、`E2E_PREBUILT=1`；无 skip、无自动更新视觉基线。
- `git diff --check`：通过；新增文件、全部候选 diff 及功能入口保留由独立审查者复核。

## 审查与验证过程中处理的问题

- 独立只读复审未发现新增权限、金额或功能入口回归；最终额外复核金额命名、收款折叠及工具栏仍无新发现。
- Claude Code 已实际调用 `claude --model opus --effort high --permission-mode plan` 做只读审查，返回 HTTP 429 / weekly limit；本轮没有取得 Claude 的审查结论，不能记为 Claude 通过。
- 首轮 E2E 工单排除断言使用跨单元格 `hasText`，工单号 `…extra-3` 与紧邻日期 `2026…` 的文本拼接误命中 `…extra-32`。已改为确切 `data-order-id`，保留原越界工单不可见的断言，复跑通过。
- Next.js Activity 保留隐藏页面造成 `#sales-bill-results` 暂有多个 DOM 实例。按安装版 `preserving-ui-state.md` 核对后，仅将几何断言限定当前可见页面，不放宽内容、权限或金额断言。
- Typecheck 曾与 E2E 前置 `prisma generate` 并发，读取到生成过程中的不完整类型。最终改为生成结束后串行 typecheck/build，未更改业务类型或放宽 TypeScript。

原始本地日志及截图位于 `/tmp/erp-sales-detail-1001/`，不提交运行时数据。生产未部署。
