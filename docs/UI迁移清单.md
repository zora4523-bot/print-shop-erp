---
status: backlog
created: 2026-09-08
spec: ui-规范.md
inventory: UI现状盘点.md
---

> 历史记录（按文内日期理解）。2026-09-24 起角色、结算与工种口径以 SPEC §L 与 DECISIONS 为准。

# UI 迁移清单

只列清单，不动手。每项：条款、文件清单、验收标准。完成一项须同时：删除 `scripts/ui-tokens/baseline.json` 对应条目（否则 lint 报 stale）、从 `docs/ui-规范.md` 附录 A 划掉、在本文打勾。

分级：**P0** 违反四原则或用户可感知混乱；**P1** 令牌归并；**P2** 组件合并。每级内按代价从小到大排。

共同验收：`pnpm lint`、`pnpm typecheck`、`pnpm test run` 全绿；涉及页面跑 `pnpm test:admin-ui` / `pnpm test:worker-ui`；不更新打印基线。

---

## P0

### P0-3 抽屉内确认与离开确认改走共享确认层（§5.3、§5.8） — ✅ 2026-09-08 完成

- 文件：`components/business/order/AdminOrderEditor.tsx`（`:1029-1131` Sheet「确认保存修改」→ `ConfirmActionController level="L2"`，内容按 §7 第 3 律：动作标题、旧值→新值、后果；`:1184` Dialog「放弃未保存的修改？」→ 复用 `PendingButton` / `PriceWorkspaceNavigationGuard` 的离开保护形态）。
- 验收：Sheet 内不再有保存按钮；`ConfirmActionController` 站点数 +2；`components/business/order/__tests__/` 相关断言更新而非删除；393×852 与 1280×800 键盘流程（Tab 到确认、Esc 取消、焦点返回）通过。
- 代价：1 文件。
- 完成记录：Sheet 删除，核价阻断与待补运费改为页内「核价结果」区，保存确认为 `ConfirmActionDialog action="保存工单修改"`（变更列表 + 金额旧→新 + 版本后果），离开确认为 `action="放弃未保存修改并离开"`（danger）；`components/business/order/__tests__/AdminOrderEditor.browser.spec.tsx` 43/43 通过；`components/business/order/AdminOrderEditor.module.css` 删除 `reviewSheet` / `reviewBody`。

### P0-2 日期 input 改用上海时区 formatter（§4.2） — ✅ 2026-09-08 完成

- 文件（14 处 / 9 文件）：`components/business/order/order-detail-timeline.ts:175`、`components/business/dashboard/OwnerWatchlists.tsx:72`、`components/business/account/AccountForm.tsx:330,331,342`、`app/(admin)/foreman/attendance/page.tsx:86`、`app/(admin)/orders/[id]/page.tsx:706,1262,1756`、`app/(admin)/orders/[id]/edit/page.tsx:189,364,404`、`app/(admin)/owner/salary/piecework/[id]/page.tsx:55`、`app/(admin)/owner/salary/daily/[id]/page.tsx:53`。
- 做法：`toISOString().slice(0, 10)` → `formatDateInputShanghai(date)`；月份键用 `currentShanghaiMonth` 系列。
- 验收：`grep -rn "toISOString().slice(0, 10)" app components lib` 为 0；补一条边界测试（UTC 16:00 后的日期在上海为次日）。
- 代价：9 文件。
- 完成记录：`app/` 与 `components/` 14 处清零；输入/键值用 `formatDateInputShanghai`，三处展示（工单详情页尾注、时间线、关注列表）改 `formatDateShanghai`（`YYYY/MM/DD`）。真正的跨日缺陷只有 `AccountForm` 的默认入职日 `new Date()`；其余为 `@db.Date` / UTC 零点值，两种写法同值，已由 `lib/format/__tests__/dates.test.ts` 新增断言锁定。`lib/` 层 12 处 `toISOString().slice(0, 10)`（`lib/order/promised-date.ts`、`lib/salary/piecework-settlement.ts` 等）是 UTC 零点日历日契约的一部分，不属于本项，未改。`components/business/dashboard/__tests__/owner-watchlists.test.tsx` 展示日期断言随 §4.2 更新。

### P0-1 金额 formatter 唯一化（§4.1） — ✅ 2026-09-09 完成（3 项遗留待拍板）

- 唯一口径：`lib/dashboard/format.ts` `formatMoney`（`¥ 1,234.56`）/ `formatMoneyPlain`；4 位单价 `formatUnitPrice`。
- 步骤：
  1. `lib/order/sales-list-presentation.ts:98 formatMoney` 改名 `formatSalesAmountPlain` 并委托 `formatMoneyPlain`；调用点（`components/business/order/SalesOrdersList.tsx`、`components/business/order/SalesOrderDetailView.tsx`）改为 `formatMoney`。
  2. 删除 14 个私有函数：`components/business/order/AdminOrderDecisionPanel.tsx:946`、`components/business/order/AdminOrderWorkspace.tsx:489`、`components/business/order/AdminOrderWorkspaceList.tsx:428`、`components/business/order/SubmitOrderButton.tsx:8`、`components/business/order/AdminOrderEditor.tsx:132`、`components/business/order/OrderSavedConfiguration.tsx:21`、`OrderChangeReviewForm.tsx:107,111`、`components/business/order/OrderForm.tsx:627`、`components/business/order/ExternalSalesOrderFormRail.tsx:61`、`CsPayrollPaymentForm.tsx:44`、`components/business/price/ExternalSalesPriceTierGroupEditor.tsx:354`、`app/(admin)/foreman/materials/page.tsx:36`；图表轴 `SalesRankingChart.tsx:141,151` 保留但改为包 `formatMoneyPlain`。
  3. 88 处内联 `toFixed` / `Intl.NumberFormat` / 带小数位 `toLocaleString` 逐处替换（清单 = `scripts/ui-tokens/baseline.json` 中 `rule: "money"` 的 51 文件；最重：`owner/salary/cs/[id]/page.tsx` 13、`components/business/order/AdminOrderWorkspace.tsx` 10、`components/business/order/OrderForm.tsx` 8、`foreman/outsource/[id]/page.tsx` 7、`components/business/order/OrderChangeReviewForm.tsx` 7）。
  4. 差额显示（`deltaMoney`、带符号金额）统一进 `lib/dashboard/format.ts` 新增 `formatMoneyDelta`。
- 验收：`scripts/ui-tokens/baseline.json` 中 `money` 条目清零；全仓 `¥` 后统一一个空格（`grep -rn "¥{" app components` 为 0）；`lib/dashboard/__tests__` 覆盖 delta、null、负数；`SalesOrdersList` / `OrdersTable` 快照测试更新说明写进 commit。
- 代价：约 52 文件。可按域分批：订单（`components/business/order/**`）→ 薪资 / 账单（`app/(admin)/owner/salary/**`、`sales/bills/**`）→ 其余。
- 完成记录：`lib/dashboard/format.ts` 新增 `formatMoneyDelta`；`lib/order/sales-list-presentation.ts` 同名异义 `formatMoney` 删除；14 个页面级 money 函数删除；88 处内联格式化与约 45 处 `¥ ${服务端字符串}` 直拼全部改走共享 formatter（含 `agent-bills/page.tsx:81`、`bills/archive/[id]/page.tsx:92` 两处原本渲染成 `¥ ¥ 1.00` 的双前缀缺陷）；`OrderCostEntry.unitPrice`（Decimal 12,4）改 `formatUnitPrice`。门禁 `money` 规则收紧为金额形态并新增拦 `¥ ${…}` 直拼；`scripts/ui-tokens/baseline.json` 的 `money` 待迁移条目清零，非金额命中（文件大小、百分比、数量、图表刻度）与下列遗留登记为 `permanent`（带理由）。约 20 个测试文件断言随 `¥ 1,234.56` 口径更新，无删除。
- **遗留处置（2026-09-09 定案）**：
  1. 阶梯价与费率：新增 `lib/format/unit-price.ts formatRate`（2–4 位小数去尾零），`ExternalSalesPriceTierGroupEditor` 标签与差额、`visual-fixture` 两文件、计件 / 时薪 / 规则费率 4 处全部改走；对应 permanent 豁免删除；`components/business/price/__tests__/ExternalSalesPriceTierGroupEditor.test.tsx` 11 处断言更新。
  2. `components/business/order/ShipOrderForm.tsx:23` 用户输入运费回显、`CsPayrollPaymentForm.tsx:71,73` 非数字兜底：保留原样回显，permanent。

## P1

### P1-4 deep import 改 barrel（§3.1） — ✅ 2026-09-09 完成

- 文件：`components/business/order/AdminOrderDecisionPanel.tsx:24-25`、`components/business/rules/pricing/CustomerPricingSectionViews.tsx:16`。
- 验收：`scripts/ui-tokens/baseline.json` 中 `deep` 条目清零。
- 代价：2 文件，各 1 行。
- 完成记录：3 处改从 barrel 引用；`deep` 条目清零。

### P1-3 删除未用 token 别名（§2.1） — ✅ 2026-09-09 完成

- 文件：`app/globals.css`（`--color-chart-1…7` L29-35、`--radius-3xl` L67、`--sidebar-primary-foreground` L24/123/170）。
- 验收：`grep -rn "chart-[1-7]\|radius-3xl\|sidebar-primary-foreground" app components` 只剩 `var(--chart-N)` 直引；`pnpm build` 通过。
- 代价：1 文件。
- 完成记录：删除 7 个 `--color-chart-*` 别名、`--radius-3xl`、`--sidebar-primary-foreground`（@theme + :root + .dark 共 10 行）；仓库无引用残留（仅注释提及）。

### P1-8 师傅端路由错误页用 ErrorState（§5.6） — ✅ 2026-09-09 完成

- 文件：`app/(worker)/worker/error.tsx:13-16`。
- 验收：与 `AdminRouteError` 同构（`ErrorState` + 重试）；`worker-responsive` 门禁通过。
- 代价：1 文件。
- 完成记录：`app/(worker)/worker/error.tsx` 改为 `ErrorState scope="page"` + 重试 + 返回任务链接，与 `AdminRouteError` 同构。

### P1-7 复制反馈补 aria-live（§5.9） — ✅ 2026-09-09 完成

- 文件：`components/business/order/AdminOrderDetailView.tsx:122-131`（`ActionNotice` 本身有 role；确认 `aria-live` 已由组件输出，否则加 sr-only status）、`components/business/notification/SmartBotBindingPanel.tsx:136`（`<p role="status">` 加 `aria-live="polite"`）。
- 验收：axe 通过；每处只有一个 live region。
- 代价：2 文件。
- 完成记录：`SmartBotBindingPanel` 状态段落改为常驻 `role="status" aria-live="polite"`；`AdminOrderDetailView` 走 `ActionNotice`（自带 role / aria-live），不另加。共享 hook 仍在 P2-4。

### P1-10 删除 Intl 日期重写（§4.2） — ✅ 2026-09-09 完成

- 文件：`components/business/rules/salary/EmployeePayRulesPage.tsx:9`、`components/business/price/ExternalSalesPriceBookVersionPanel.tsx:65`、`components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:511`。
- 验收：三处改用 `lib/format/dates.ts`；`grep -rn "new Intl.DateTimeFormat" components app` 只剩 `components/business/order/OrderForm.tsx:880`（时分秒，另议）。
- 代价：3 文件。
- 完成记录：三处改用 `formatDateTimeLocalShanghai` / `formatDateTimeShanghai`；仓库内 `new Intl.DateTimeFormat` 只剩 `components/business/order/OrderForm.tsx:873`（时分秒本地时钟，另议）。

### P1-2 裸表补横滚容器（§5.1、§8） — ✅ 2026-09-09 完成

- 文件：`app/(admin)/foreman/materials/page.tsx:96`、`app/(admin)/owner/pigsty/page.tsx`（6 张表）、`app/(admin)/owner/salary/daily/page.tsx`、`owner/salary/hourly/page.tsx`、`owner/salary/piecework/page.tsx`、`owner/salary/cs/page.tsx`、`app/(admin)/owner/background-jobs/page.tsx`、`app/(admin)/owner/notifications/page.tsx`（4 张表）。
- 验收：`admin-responsive` 在 375×667 与 393×852 无 `root-horizontal-overflow` / `viewport-x`；表格容器可键盘聚焦。
- 代价：8 文件。
- 完成记录：盘点时这 8 页其实已有手写 `role="region" tabIndex={0} overflow-x-auto` 包裹（无横向溢出风险），缺的是共享语义与滚动提示；17 个包裹全部替换为 `TableScrollArea`（自带 scroll cue，`piecework/page.tsx` 两张表补上了原本缺失的焦点圈）。剩余同形手写包裹 15 处登记为 P2-11。

### P1-1 全局令牌对齐原型并删除局部主题覆盖（§2.1） — ✅ 2026-09-09 完成（业主目视确认）

- 文件：`app/globals.css`（`--primary` ← `#a8121a`、`--background` ← `#faf9f7`、`--muted-foreground` ← `#77746e`、`--border` ← `#e4e1dc`、`--muted` ← `#f0eeea`、`--success-foreground` ← `#2f6b46`、`--warning` 色相 ← `#c9a227`，全部写 OKLCH 等值；`.dark` 配对另调）；`components/business/order/AdminOrderWorkspace.module.css:3-27` 整块删除；`AdminOrderDetailView.module.css:137,146-151` 改为显式按钮 `variant`；`components/business/order/AutoPrint.tsx:210` 改引用 token（打印视图若必须固定色，登记 §2.7 例外）。
- 验收：`scripts/ui-tokens/baseline.json` 中 `color` 条目只剩两个 swatch 文件；`/dev/showcase` 明暗对比人工检查（焦点圈 ≥3:1、warning/success 文字 ≥4.5:1）；`admin-responsive` / `worker-responsive` axe 通过；打印 8 张基线不变。
- 代价：4 文件 + 全站视觉复核。**这是全站可见变化，需业主目视确认后再合并。**
- 完成记录：`app/globals.css` 浅色 `--background` ← paper、`--foreground`/`--card-foreground`/`--secondary-foreground`/`--accent-foreground` ← ink、`--muted`/`--secondary`/`--accent` ← rule-2、`--muted-foreground` ← mute 色相（L 压到 0.53：原型 #77746e 经 axe 实测在米白底 4.35–4.42:1、`bg-muted` 上 4.26:1，不满足 AA 4.5:1；调整后米白 5.05 / 白 5.31 / muted 4.58）、`--border`/`--input` ← rule、`--primary` ← seal、`--success-foreground` ← ok、`--warning`/`--warning-foreground` 色相 ← gold（暗色 warning 同步换色相，其余暗色值不动）；`components/business/order/AdminOrderWorkspace.module.css` 的 `.surface` 明暗两套 hex 调色板整块删除；`components/business/order/AutoPrint.tsx` 内联色改 `var(--card)` / `var(--primary)`。`scripts/ui-tokens/baseline.json` 的 `color` 条目清零（仅剩 swatch 永久豁免）。 门禁：`pnpm test:admin-ui` 首轮暴露 `--muted-foreground` 原型值 AA 不达标（见上），压暗后 axe `color-contrast` 归零；剩余失败全部是 `getByRole('heading'|'button', /^GD-/)` 找不到工单号标题/按钮——与工作树里另一任务的「名称标题布局」（d742fd0 起）同源，非本项引入。候选截图（工作台明暗、经营概览、收费工作台、关注事项）已交业主目视。**未做**：`AdminOrderDetailView.module.css:137,146-151` 的 `.decision` 主色反转与按钮选择器覆写——它承载 UI-SYSTEM「确认/下发/发货入口用深色操作」的设计意图，改显式 variant 需给 `AdminOrderDecisionPanel` 增加强调 prop，另立 P2-12。

### P1-5 圆角与间距任意值归并（§2.3、§2.4） — ✅ 2026-09-09 完成

- 圆角：`rounded-[14px]` → `rounded-xl`（`ExternalSalesOrderFormRail.tsx:168,257,368,369`、`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx:1057`、`components/business/rules/pricing/CustomerPricingSectionViews.tsx` 11 处）；`rounded-[9px]` / `[10px]` → `rounded-lg`（`ExternalSalesOrderFormB.tsx:1000,1019,1028,1039`、`OrderPaperSwatchPicker.tsx:105`）；裸 `rounded` 25 处 → `rounded-md`；CSS Module px 圆角 → `var(--radius-*)`（`components/business/order/AdminOrderDetailView.module.css`、`components/business/order/AdminOrderWorkspace.module.css`、`components/business/order/AdminOrderEditor.module.css:26`）。
- 间距：safe-area 表达式 19 处 → `.admin-safe-*` / `.worker-safe-*`（`SalesOrdersList.tsx:543,568,715`、`OrderListFilters.tsx:517`、`components/business/order/OrderListBatchSelection.tsx:242`、`components/business/order/AdminOrderEditor.tsx:1116` 等）；`[1.125rem]` 8 处 → `4`（`OrderForm.tsx:3498,3604` 等）；`p-[18px]` → `p-4`；`py-[11px]` → `py-3`。
- 验收：`grep -rnE "rounded-\[|rounded\b[^-]|(p|m|gap|space)[xytblr]?-\[" app components` 只剩 `components/ui/`；六视口几何门禁通过。
- 代价：约 14 文件。
- 完成记录：19 文件。`rounded-[14px]` 16 → `xl`；`[9px]`/`[10px]` 5 → `lg`；裸 `rounded` 20 → `md`；`[1.125rem]` 6 → `4`、`gap-[1.375rem]` → `6`、`p-[18px]` 4 → `4`、`py-[11px]` 2 → `3`；safe-area 表达式 17 处 → `.admin-safe-inline` / `.admin-safe-bottom`；CSS Module 圆角 14/12/10/6/4px → `var(--radius-xl|lg|sm)`。保留：`SalesOrdersList.tsx:543,772` Sheet 头部 `pt-[max(1rem,env(top))] pr-[max(4rem,…)]`（为关闭按钮预留，无同义共享类，登记附录 A-7）；CSS Module 里 `99px` 胶囊、`50%` 圆、`3px` 进度条圆角（无对应 token）。两个源码契约测试断言随类名更新（`OrderListFilters.test.tsx:366`、`components/business/price/__tests__/ExternalSalesPriceTierGroupEditor.test.tsx:401`）。

### P1-6 任意字号归并（§2.2） — ✅ 2026-09-09 完成（业主目视确认）

- 映射：9–11.5px → `text-xs`；12.5–13.5px → `text-sm`；15px → `text-base`；21px → `text-xl`；34px → `text-3xl`。
- 文件（149 处 / 19 文件）：`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx`（约 40）、`components/business/order/AdminOrderWorkspace.tsx`、`components/business/order/AdminOrderWorkspaceList.tsx`、`components/business/order/ExternalSalesOrderFormRail.tsx`、`components/business/order/AdminOrderProgress.tsx`、`AdminOrderDecisionPanel.tsx:814,823`、`OrderForm.tsx:3532,3608`、`OrderFoilSwatchPicker.tsx:223,228`、`OrderSubmissionReviewDialog.tsx:89,164,241`、`SalesOrdersList.tsx:260,454`、`app/(admin)/owner/rules/page.tsx:109,113`、`components/business/price/RulePriceWorkbench.tsx:485,589`、`rules/pricing/PriceVersionsPage.tsx:280,424`；CSS Module `font-size` 41 处（`components/business/order/AdminOrderDetailView.module.css`、`components/business/order/AdminOrderWorkspace.module.css:84`、`components/business/order/AdminOrderInlineOperations.module.css:14`）。
- 验收：`grep -rn "text-\[" app components/business components/ui-business` 为 0；工单列表紧凑行高（84–92px）在 1280×800 仍满足 `UI-SYSTEM.md`「管理端工单列表」；`components/business/order/__tests__/AdminOrderListLayout.browser.spec.tsx` 通过。
- 代价：19 文件。与 P1-1 同批做视觉复核。
- 完成记录：24 文件 148 处 `text-[…]` 按映射归并（9–11.5px → `text-xs` 108 处、12.5–13.5px → `text-sm` 34 处、15px → `text-base`、21px → `text-xl` 2 处、34px → `text-3xl` 2 处）；CSS Module 41 处 `font-size: Npx` 改 `var(--text-xs|sm|base|lg|xl)`。仓库 `text-[…]` 仅剩 `components/ui/button.tsx:26`（原子件豁免）。与 P1-1 同批待目视确认。

### P1-9 金额三态数据契约（§4.3） — 🔁 2026-09-09 裁决收编，剩余工作转 P2-13

- 前置（业主）：确认 `confirmedFee` / `quotedFee` DTO、历史数据映射、列表 / 详情 / 打印 / 导出范围。
- 文件（确认后）：`lib/order/*-presentation.ts`、`components/business/order/{AdminOrderWorkspaceList,SalesOrdersList,SalesOrderDetailView,AdminOrderDetailView,ExternalSalesOrderFormRail,OrderSubmissionReviewDialog}.tsx`、`app/(admin)/orders/[id]/page.tsx`。
- 验收：三态在列表、抽屉、详情、侧栏、确认层、预览渲染一致；「估」为文字；待核价用 `text-primary`；无零金额。
- 代价：约 8 文件 + DTO。**未拍板前不开工。**
- 定案：不新增 DTO。三态来源 = `pricingStatus`（待工厂核价）+ 费用行 `estimated`（估）+ `status = DRAFT`（未报价）；销售列表与管理端工作台已按此实现。剩余站点的统一见 P2-13。

## P2

### P2-9 清理 0 引用组件与导出（§3.2） — ✅ 2026-09-09 关闭（无需删除）

- 文件：`components/ui/progress.tsx`（与 `components/business/order/AdminOrderDetailView.tsx:38` 本地 `Progress` 二选一）、`components/ui/tooltip.tsx`（保留，补 showcase 示例）、`components/ui-business/ConfirmActionDialog.tsx` `confirmationCanSubmit`、`components/ui-business/FormMessage.tsx` `formMessageId`、`components/ui-business/LongTaskReceipt.tsx` `remainingHoursLabel`、`components/ui-business/FormErrorSummary.tsx` `focusFormErrorSummary`、`components/ui-business/empty-state-copy.ts`。
- 验收：`pnpm check:dead-code` 无新增；barrel 导出与使用一致。
- 代价：7 文件。
- 完成记录（关闭，未删代码）：复核后 `confirmationCanSubmit` / `formMessageId` / `remainingHoursLabel` / `focusFormErrorSummary` 都被 ui-business 契约测试直接调用，是有意公开的纯函数，不是死导出；`components/ui-business/empty-state-copy.ts` 的工厂由 `EmptyState` 内部消费（盘点误判为 0 引用），已在 P2-8 改文案；`ui/progress.tsx` 被 `components/ui/__tests__/primitives.test.tsx` 覆盖，保留，`AdminOrderDetailView` 本地 `Progress` 与之不冲突（不同模块作用域）；`ui/tooltip.tsx` 保留。规范 §3.2 关于 `Progress` 的说明同步收敛。

### P2-5 手写分页换 AdminPagination（§5.1） — ✅ 2026-09-09 完成（2/3，1 处豁免）

- 文件：`app/(billing)/owner/agent-bills/page.tsx:248-268`、`app/(admin)/owner/notifications/page.tsx:226-245`、`components/business/price/RulePriceWorkbench.tsx:905-947`。
- 验收：三处「第 x / y 页」与按钮尺寸一致；`aria-label` 保留。
- 代价：3 文件。
- 完成记录：`AdminPagination` 新增 `pageParam` 属性（同页多表时区分参数名）；`owner/agent-bills` 与 `owner/notifications`（`unknownPage`）两处换用共享分页，删除本地 `pageHref`。**保留** `components/business/price/RulePriceWorkbench.tsx:905`：它的翻页链接是 `PriceWorkspaceLink`（带未保存档位的导航拦截），`AdminPagination` 不支持自定义链接组件，换用会丢离开保护；登记附录 A-8 豁免。

### P2-8 空态措辞与工厂（§5.5） — ✅ 2026-09-09 完成

- 文件：`components/ui-business/empty-state-copy.ts`（删「还没有X」工厂，或改为「暂无X」并接入 `EmptyState` 默认值）、`components/business/admin/AdminDataTable.tsx:77`；内联 `暂无X。`（带句号）10 处（`foreman/outsource/page.tsx:35`、`owner/salary/cs/[id]/page.tsx:126,241`、`orders/[id]/page.tsx:1848`、`components/business/production/TaskDisputePanel.tsx:86`、`components/business/production/TaskDisputeAdminPanel.tsx:48`、`components/business/bill/BillCostEntryList.tsx:38` 等）去句号或换 `EmptyState`；三张图表 `暂无数据` 抽公共。「暂无法预测 / 计算」5 处移交文案任务。
- 验收：`grep -rn "还没有\|暂无.*。" app components` 为 0。
- 代价：约 15 文件。
- 完成记录：`components/ui-business/empty-state-copy.ts` 工厂改为「暂无X」/「没有匹配的X」（`EmptyState` 的 no-data / no-result 默认标题随之统一，5 个测试文件断言更新）；8 处纯空态短句去句号（外协单、包装组、工资发放流水、补录成本、异议记录 ×2、暂无修改、已停用记录）。带后续引导的整句（「暂无后台任务。通知……会落在这里。」等 10 处）是空态说明而非标题，保留。「暂无法预测 / 计算」5 处仍移交文案任务。

### P2-7 私有 Loading 换 ContentSkeleton（§3.3） — ✅ 2026-09-09 完成

- 文件：`app/(admin)/foreman/cdr/page.tsx:269`、`components/business/dashboard/DashboardSectionLoading.tsx`、`components/business/dashboard/OwnerAnalytics.tsx:79`、`components/business/dashboard/OrderAttentionSection.tsx:39`、`app/(worker)/worker/loading.tsx`、`components/business/rules/pricing/CustomerPricingLoading.tsx`、`app/(admin)/owner/warehouses/page.tsx:364,394,416`。
- 验收：`grep -rn "animate-pulse" app components/business` 为 0；`role="status"` + `SlowLoadingHint` 行为不变。
- 代价：7 文件。
- 完成记录：`ContentSkeleton` 是按行数撑高的数据区骨架，与这 5 个「区块级单块/网格」加载态不同形，直接换用会改变占位高度；因此新增 `ui-business/SectionLoading`（role=status + aria-busy + sr-only 标签 + 一块或自定义 `Skeleton` 网格 + 唯一 `SlowLoadingHint`），5 个私有加载态与 `DeferredDashboardCharts` 的图表占位全部改走它或 `Skeleton`；`app/`、`components/business`、`components/ui-business` 里手写 `animate-pulse` 归零。`app/__tests__/slow-loading-fallbacks.test.ts` 的源码契约改为断言委托给 `SectionLoading`（并新增对 `SectionLoading` 自身的契约）。

### P2-4 共享复制 hook（§5.9） — ✅ 2026-09-09 完成

- 新增 `components/ui-business/useCopyToClipboard.ts`（成功「已复制X」、失败给下一步、单一 live region）；替换 `components/business/order/OrderListBatchSelection.tsx:218`、`components/business/order/SalesOrdersList.tsx:154`（同时合并页面根部与 Sheet 内的两个 live region）、`components/business/order/AdminOrderDetailView.tsx:122`、`components/business/notification/SmartBotBindingPanel.tsx:54`。
- 验收：每个交互作用域只有一个 `role="status"`；`CreateBundleForm.browser.spec` 类交互测试覆盖成功 / 失败。
- 代价：5 文件。
- 完成记录：新增 `ui-business/useCopyToClipboard`（`copy(value, label, { count })` + `copyFeedbackMessage`），统一「已复制X 值」「已复制 N 个X」「X复制失败，请手动选择复制或检查浏览器剪贴板权限」，长值截断 24 字。四处调用点全部改走：批量选择（回执按选择集 key 生效，换批自动隐藏）、销售列表（删掉 Sheet 内重复 live region 与 `copyFeedback` prop，只保留列表根部一个）、工单详情（`ActionNotice` 消费 tone/message）、智能机器人绑定面板。`navigator.clipboard` 在业务代码中只剩 hook 一处；新增 `components/ui-business/__tests__/useCopyToClipboard.test.ts` 锁文案。

### P2-6 一线表单字段错误接 FormMessage / FormErrorSummary（§5.4、§5.10）

- 文件（12 文件 / 50 处）：`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx`（15，含多款定位）、`components/business/notification/ChannelForm.tsx`（9）、`components/business/auth/LoginForm.tsx`（8，零 JS 硬约束，只改错误渲染不改 form 形状）、`components/business/salary/CsPayrollPaymentForm.tsx`（5）、`components/business/notification/RuleForm.tsx`（3）、`components/business/auth/ChangePasswordForm.tsx`（3，同 LoginForm 约束）、`components/business/production/TaskDisputeAdminPanel.tsx`（2）及其余 5 文件。
- 验收：每个错误经 `aria-describedby` 连到控件；`FormErrorSummary` 提交失败后获焦；`tests/e2e/no-js.spec.ts` 仍绿；`components/business/order/__tests__/EditOrderForm.aria.test.tsx` 式 SSR 断言补到 `ExternalSalesOrderFormB`。
- 代价：12 文件。

### P2-1 状态药丸归并（§6） — ✅ 2026-09-09 完成

- 步骤：4 组逐字重复合并到 `components/business/<domain>/`（`BillStatusBadge`：`sales/bills/page.tsx:172` + `[id]/page.tsx:361` → `components/business/bill/`；`ChangeRequestStatusBadge`：`orders/[id]/page.tsx:2070` + `owner/order-changes/page.tsx:225` → `components/business/order/`；`salaryFloorBadge`：`owner/salary/daily/page.tsx:210` + `worker/salary/page.tsx:460` → `components/business/salary/`；`SalesStatusBadge` / `SalesDetailStatusBadge` → 一个）；`lib/order/sales-list-presentation.ts:31` 五档 tone 映射到 Tone 六档并删除 `components/business/order/SalesOrdersList.tsx:503-511` / `components/business/order/SalesOrderDetailView.tsx:533-541` 类名表；`components/business/order/AdminWorkspaceStatusBadge.tsx:16` 本地 `STATUS_LABELS` 并入 registry；`components/business/rules/RuleCenterPageHeader.tsx:5`、`components/business/production/TaskDisputePanel.tsx:121`、`pigsty/page.tsx:59` 本地 label/tone 进 registry；用 `Badge` 表达状态的（`PromisedDateBadge`、`AdminStatusBadge`、`AccountStatusBadge`、`RequestTypeBadge`）改 `StatusBadge`；手写 `rounded-full` pill 15 处逐一判定（状态 → `StatusBadge`，计数 → `Badge`）。
- 验收：`grep -rn "function .*Badge\|const .*Badge =" app` 为 0（页面层无私有 badge）；registry 单测覆盖新增枚举；同页不再并存 h-5 与 h-6 状态徽章。
- 代价：约 18 文件。
- 完成记录（6 组并行迁移 + 每组两个角度对抗校验，实际 40+ 文件）：
  - **新增 6 个共享领域徽章**：`business/bill/BillStatusBadge`、`business/order/ChangeRequestStatusBadge`（含类型徽章）、`business/order/SalesOrderStatusBadge`、`business/salary/SalaryFloorBadge`、`business/master-data/ActiveStatusBadge`、`business/production/TaskDisputeStatusBadge`，另有 `business/ops/` 两个运维徽章。4 组逐字重复对全部消除。
  - **registry 新增 8 类**：`PROMISED_DATE_ALERT`、`ACTIVE_STATUS`、`SALARY_FLOOR_STATUS`、`ORDER_CHANGE_REQUEST_TYPE`、`PRODUCTION_TASK_DISPUTE_STATUS`、`RULE_CENTER_EFFECT`、`OPS_READINESS_STATUS`、`SENSITIVE_COLUMN_MASKING_STATUS`，均配 registry 契约测试。
  - **第二套 tone 消除**：`lib/order/sales-list-presentation.ts` 的五档 `muted/outline/production/shipped/attention` 改为共享六档，销售 label 表保留（销售视角与管理端有意不同，已写进注释），两个组件里逐字重复的类名表删除。
  - **Badge 让位**：`PromisedDateBadge`、`AdminStatusBadge`、`AccountStatusBadge`、`RequestTypeBadge` 等不再用 shadcn `Badge` 承载状态。
  - **对抗校验暴露并修掉的问题**：(a) 销售端「急单」还留在 `Badge variant="destructive"`，与同行 h-6 StatusBadge 不齐且 danger 误用 → 改用共享 `UrgentBadge`（warning）；(b) 销售列表交期「临期」与「逾期」同为 destructive，与 `PROMISED_DATE_ALERT_REGISTRY` 的 danger/warning 两档冲突 → 临期改 warning；(c) **归档账单详情把 `BillStatus` 原始枚举直接渲染给用户**（§7 违规，真实线上缺陷）→ 改用 `BillStatusBadge`；(d) 归档列表另有一份本地 label 表（同一状态在产品内显示「部分收款」与「部分结清」两个词）→ 归并，文案统一为「部分结清」；(e) 物料页与产品分类页残留内联 `isActive` 三元 → 改用 `ActiveStatusBadge`。
  - **共享契约测试**：`app/(admin)/__tests__/status-registry-consumers.test.ts` 的两条断言由「页面直接 import registry」改为「页面引用共享徽章 + 共享徽章引用 registry」，覆盖面不减（agent 无权改该文件，由主控集中处理）。
  - **顺带修好并行任务的一处无障碍回归**：工作台新加了 `PageHeader`（h1），而行标题一直是 `h3`，axe `heading-order` 在 12 个视口全红；行标题改 `h2`（Tailwind preflight 下观感不变），`components/business/order/__tests__/AdminOrderWorkspaceColors.browser.spec.tsx` 从 16 红降到 4 红，余下 4 项是该任务改工单号标题后 `getByRole('button', {name:'GD-…'})` 失效，不属本项。
- **保留的页面内徽章**：`OperationStatusBadge`、`NotificationStatusBadge`、`BackgroundJobStatusBadge`、`DesignBundleStatusBadge`、`StatusPill`、`PriceBookVersionStatusBadge` 等是 registry 的薄封装（无本地 label/tone 表），符合 §6 的单一真相要求，不迁移。

### P2-3 PendingButton 覆盖（§5.7）

- 文件（33）：`AttendanceRecordDialog`、`AdminOrderDecisionPanel`、`OrderChangeWithdrawButton`、`OrderPricingReviewForm`、`FulfillmentPricingReviewForm`、`ReworkOrderForm`、`OrderChangeRequestForm`、`SubmitOrderButton`、`SfCollectToggleForm`、`AdminOrderDetailDecision`、`EditOrderForm`、`OrderCommercialDetailsManager`、`CraftForm`、`BomForm`、`IssueBillButton`、`GenerateBillsForm`、`OrderCostEntryForm`、`AgentMonthlyBillExportControls`、`AgentMonthlyBillForms`、`LoginForm`、`ChangePasswordForm`、`DeleteChannelButton`、`UnknownNotificationActions`、`SalaryRuleSettingsForm`、`PieceworkSettlementActions`、`StartCsPeriodForm`、`BackgroundJobActionButton`、`ProductCategoryForm`、`ExternalSalesPriceBookDraftForms`、`OutsourceAmountForm`、`TaskDisputePanel`、`OperationReportForm`、`PurchaseOrderForm`、`SettingsForm`（均在 `components/business/`）。`LoginForm` / `ChangePasswordForm` 保持零 JS 形状。
- 验收：`grep -rn "disabled={pending}" components/business` 只剩非按钮控件；提交中 `aria-busy` 与导航拦截行为由 `PendingButton` 测试覆盖。
- 代价：33 文件，按域分批。

### P2-2 共享 NativeSelect（§3.2）

> **状态（2026-09-29）：已完成。** 73 处 `<select`、全部原生 `<textarea` 与 14 处可见原生 `<input` 已迁到 `NativeSelect` / `Textarea` / `Input`（同一规格 `components/ui/field-styles.ts`），eslint 在业务范围禁止三者复发。记录见 [`audits/2026-09-29-ui-remediation-plan.md`](audits/2026-09-29-ui-remediation-plan.md)。以下为当初的任务描述，保留作追溯。

- 新增 `components/ui/native-select.tsx`（原生 `<select>` 包装：`Input` 同款高度 `h-9` / 触控 `min-h-11`、`rounded-md`、`border-input`、`focus-visible:ring-3 ring-ring/50`、`aria-invalid` 样式、`data-slot="native-select"`）；删除 8 份 `selectClass`（`OrderListFilterFields.tsx:13`、`components/business/bom/BomForm.tsx:42`、`components/business/product-category/ProductCategoryForm.tsx:48`、`components/business/purchase/PurchaseReceiptForm.tsx:53`、`components/business/order/OrderForm.tsx:4158`、`components/business/order/SfCollectToggleForm.tsx:264`、`components/business/price/ExternalSalesPriceBookDraftForms.tsx:57`、`components/business/price/RulePriceWorkbench.tsx:123`）；替换 68 处 `<select`（39 文件，页面层：`owner/salary/{hourly,daily,piecework}`、`owner/agent-bills`、`sales/bills`、`owner/parties`、`foreman/attendance`）。同批把 17 处原生 `<textarea` 换 `Textarea`，30 处可见原生 `<input` 换 `Input`。
- 验收：`grep -rn "<select\b\|<textarea\b" app components/business` 为 0；eslint 加 `no-restricted-syntax` 拦原生 select/textarea（与现有 checkbox 规则同形）；六视口触控门禁通过。
- 代价：39 + 15 + 19 文件，分三批。

### P2-11 其余手写横滚包裹换 TableScrollArea（§3.3） — ✅ 2026-09-09 完成

- 文件（15）：`app/(admin)/owner/purchases/[id]/page.tsx`、`owner/salary/{piecework,cs,daily}/[id]/page.tsx`、`sales/bills/[id]/page.tsx`、`owner/boms/[id]/page.tsx`、`foreman/materials/[id]/page.tsx`、`foreman/cdr/page.tsx`、`orders/[id]/page.tsx`；`components/business/bom/OrderMaterialUsageEstimate.tsx`、`price/RulePriceWorkbench.tsx`（2）、`cdr/CreateBundleForm.tsx`、`price/ExternalSalesPriceBookVersionPanel.tsx`、`rules/catalog/MaterialCatalogPages.tsx`、`material/InventoryCountClient.tsx`。
- 做法：与 P1-2 同一变换（保留 label 与卡面 class，去掉 `overflow-x-auto` 与 `focus-visible:*`）。组件类有浏览器 spec（`CreateBundleForm`、`InventoryCountClient`、`RulePriceWorkbench`），逐个单跑。
- 验收：`grep -rn 'overflow-x-auto' app components/business` 只剩非表格滚动容器。
- 代价：15 文件。
- 完成记录：15 处全部换用；`TableScrollArea` 改为透传其余 div 属性（`id` / `aria-busy` / `aria-describedby` 等），盘点列表的错误连线得以保留；客服提成记录的 `<section role="region">` 改为共享包裹（region 语义等价）。`app/` 与 `components/business` 里带 `role="region"` 的手写 `overflow-x-auto` 容器归零；`components/business/price/RulePriceWorkbench.tsx:409` 的筛选 chip 横滚条不是表格，保留。`components/business/cdr/__tests__/CdrPage.failure.test.ts` 的源码切片锚点随 `CdrSectionLoading` 删除而改为文件尾。

### P2-13 金额三态收编到共享 helper（§4.3） — ✅ 2026-09-09 完成

- 做法：在 `lib/order/` 新增 `orderAmountPresentation({ status, pricingStatus, totalAmount, feeLines })`（以现有 `salesOrderAmountPresentation` 为基底），返回 `{ label, estimated, pending }`；`lib/order/admin-workspace.ts` 的 `fee` 投影、`components/business/order/AdminOrderWorkspaceList.tsx:245`、`AdminOrderDetailView` / `components/business/order/admin-order-detail-model.ts`、`ExternalSalesOrderFormRail`、`OrderSubmissionReviewDialog`、`AdminOrderEditor` 确认层都改为消费它；「估」为文字、待工厂核价用 `text-primary`。
- 验收：`grep -rn "待核价\|待工厂核价\|估" components/business/order app/(admin)/orders` 只剩 helper 输出；`lib/order/__tests__/sales-list-presentation.test.ts` 与 `lib/order/__tests__/admin-list-presentation.test.ts` 合并断言。
- 代价：约 8 文件。
- 完成记录：新增 `lib/order/amount-presentation.ts` 的 `orderAmountPresentation({ status, amount, pricingStatus, estimated, incomplete })` → `{ label, estimated, pending }`，四态优先级为 未报价（草稿无金额）→ 金额不完整 → 待工厂核价 → 金额（+估）。`salesOrderAmountPresentation` 改为委托；管理端工作台行、销售列表卡、销售详情费用区都改为消费它。
- **顺带统一两处违反 §4.3 的视觉**：待核价此前在销售端是 `text-destructive`（含容器 `border-destructive/40 bg-destructive/5` 与 `Badge variant="destructive"`）、在管理端是 `text-warning-foreground`，现在一律 `text-primary` / `StatusBadge tone="primary"`——待核价不是技术失败。
- **文案统一**：销售端金额格「待管理员确认价格」改为「待工厂核价」，与管理端和规范 §4.3 一致；`OrderPricingStatus` 的状态标签（`lib/order/pricing-status.ts`、`lib/order/log-format.ts`）仍是状态词表，不动。

### P2-12 决策列深色按钮改显式 variant（§2.1） — ✅ 2026-09-09 完成

- 文件：`components/business/order/AdminOrderDetailView.module.css:137,146-151`（`.decision { --primary: var(--foreground) }` 与按 `class~='bg-primary'` / `text-destructive` 的选择器覆写）、`components/business/order/AdminOrderDecisionPanel.tsx`、`components/ui/button.tsx`。
- 做法：`Button` 新增 `inverse` 变体（`bg-foreground text-background`）；`AdminOrderDecisionPanel` 增加 `emphasis?: 'default' | 'inverse'` 由详情页传入，拒绝类保持 `destructive`；删除 CSS Module 里的 token 反转与选择器覆写。
- 验收：`grep -n -- "--primary" components/business/order/*.module.css` 为 0；`components/business/order/__tests__/AdminOrderDetailView.browser.spec.tsx` 通过；决策列观感不变。
- 代价：3 文件。
- 完成记录：改用作用域数据属性而不是新增 prop —— `Button` 的 `default` / `destructive` 变体各加一组 `in-data-[emphasis=inverse]:not-disabled:*` 类，工单详情「当前待办」区标 `data-emphasis="inverse"`；`components/business/order/AdminOrderDetailView.module.css` 的 `--primary` 反转与两条 `button[class~=…]` 选择器删除。这样强调层由 `Button` 自己声明，不必给 `AdminOrderDecisionPanel` 与内嵌 `OrderChangeReviewForm` 逐层传 prop。
- **顺带修好一个潜在缺陷**：旧 CSS 把整个子树的 `--primary` 反转成 `--foreground`，而「拒绝」按钮的规则又用 `var(--primary)` 上色，于是批准与拒绝**都是深色**，`components/business/order/__tests__/AdminOrderDecisionLayout.browser.spec.tsx` 里「rejection stays red」的断言因为拿同一个反转后的变量比较而恒真。现在拒绝是真·品牌红，并新增两者背景必须不同的断言。

### P2-14 启停徽章与运维 tone 的残余站点（§6）

- 文件：`components/business/product/ProductsTable.tsx` 与另一处仍用 shadcn `Badge` 表达启停（P2-1 校验登记在 notDone）；`app/(admin)/owner/pigsty/page.tsx` 5 处 StatCard 仍由 readiness 布尔本地推导 tone 与文案（与新建的 `OpsReadinessBadge` 并存）。
- 做法：前者改 `ActiveStatusBadge`；后者把 StatCard 的 tone/文案接 `opsReadinessDefinition`。
- 代价：3 文件。

### P2-15 账单状态文案的第二个权威来源（§4/§6）

- 文件：`lib/auth/role-labels.ts:59` 的 `BILL_STATUS_LABELS`，消费方 `lib/order/export.ts`（XLSX/CSV 导出）。它与 `BILL_STATUS_REGISTRY` 目前逐字相同，一旦改 registry 文案，导出会静默沿用旧词。
- 做法：导出层改为消费 registry，或在两处加交叉引用测试锁住一致性。属数据导出契约，需确认导出列文案是否可变。
- 代价：2 文件 + 一条契约测试。

### P2-10 无原因 disabled 审计（§5.7）

- 范围：273 行 `disabled={…}`，先按钮（55 处），判定三类原因并接 `DisabledReason`；无业务原因的改为不渲染。
- 验收：每个 disabled 按钮有 `aria-describedby` 指向原因或已移除。
- 代价：待审计后填。

---

## 依赖关系

- P1-1 与 P1-6 同批做视觉复核（都是全站可见变化）。
- P0-1 先于 P2-1（销售列表 badge 与金额在同文件）。
- P2-2 先于 P2-6（`ExternalSalesOrderFormB` 同时涉及 select 与字段错误）。
- P1-9 未拍板前不开工，不阻塞其他项。
