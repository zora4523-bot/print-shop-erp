# 呈现修复报告

本报告随批次更新；未完成的验收不记为通过。

## 边界与基线

- 基线：`d742fd0` 加任务开始时已存在的工作区改动。已有改动清单保存在仓库外，提交不包含其他任务改动。
- [第 0 批] `docs/ui-规范.md` 新增《文案与确认》：原样写入文案十律、映射表和实际反例。`AGENTS.md` 引用该章作为后续 UI 任务约束。提交：`3acbf7b`。
- 基线全量单元测试：553 个文件，547 通过、3 失败、3 跳过；5814 个测试，5755 通过、4 失败、55 跳过。
- 既存失败：共享 Button 使用约束（1）、详情页 WORKER/SALES 可见性文案契约（2）、原生 disclosure 使用约束（1）。失败不自动归类为本次回归，也不删除原断言。

## 第一批：确认结构

呈现接口仅保留 action、changes、consequences、confirmText、danger。开关、触发器、表单和理由等交互控制由 Controller 提供；Controller 运行时只接受一个 ConfirmActionDialog，不接受任意段落。

以下行号为迁移前位置，便于定位原文。此表记录接口迁移；具体业务文案、数值结构整理在后续批次列明。

- [第一批] `components/business/salary/MarkHourlyPaidForm.tsx:73` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/purchase/PurchaseReceiptForm.tsx:227` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/material/StockTransactionForm.tsx:312` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/notification/UnknownNotificationActions.tsx:70` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/notification/UnknownNotificationActions.tsx:90` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/notification/UnknownNotificationActions.tsx:120` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/notification/DeleteChannelButton.tsx:49` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/material/InventoryCountClient.tsx:543` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/PieceworkSettlementActions.tsx:54` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/PieceworkSettlementActions.tsx:100` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/PieceworkSettlementActions.tsx:149` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/CsPayrollPaymentForm.tsx:323` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/RecomputeHourlyForm.tsx:100` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/SettleCsPeriodButton.tsx:53` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/salary/SettleReadyCsButton.tsx:78` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/purchase/CancelPurchaseReceiptButton.tsx:69` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/purchase/CancelPurchaseOrderButton.tsx:68` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `app/dev/showcase/page.tsx:447` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `app/dev/showcase/page.tsx:458` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/bill/RecordPaymentForm.tsx:225` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/bill/IssueBillButton.tsx:42` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/product/ToggleActiveButton.tsx:40` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/outsource/OutsourceActions.tsx:101` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/outsource/OutsourceActions.tsx:145` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/AdminOrderBatchActions.tsx:173` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:907` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:969` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:1049` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/OrderChangeReviewForm.tsx:706` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/OrderChangeReviewForm.tsx:720` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/outsource/OutsourcePaymentForm.tsx:251` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/price/PriceWorkspaceNavigationGuard.tsx:166` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/price/PriceWorkspaceNavigationGuard.tsx:278` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/FinishOrderButton.tsx:49` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/ShipOrderForm.tsx:202` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/master-data/ActiveStateConfirmButton.tsx:44` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/OrderCommercialDetailsManager.tsx:277` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/OrderCommercialDetailsManager.tsx:499` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/AdminOrderDecisionPanel.tsx:65` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/CancelOrderForm.tsx:73` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/OrderPricingReviewForm.tsx:946` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/business/order/FulfillmentPricingReviewForm.tsx:230` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/ui-business/PendingButton.tsx:137` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。
- [第一批] `components/ui-business/__tests__/ConfirmActionDialog.test.tsx:24` — title / description / impactItems / confirmLabel → action / changes / consequences / confirmText；删除自由说明入口，保留原操作回调及禁用、理由、表单控制。

### 测试迁移边界

旧组件测试仅改调用参数，原断言保留。新增类型拒绝 description/notice/children、运行时拒绝任意 Controller 内容的测试；浏览器覆盖实际金额变化、后果去重、理由必填、取消、键盘提交、焦点恢复、禁用与外部表单理由传递。六视口×明暗主题的几何与 axe 检查单独记录，不能代替所有业务页面的视觉验收。

### 第一批验证停点

- 独立候选目录仅包含 `3acbf7b` 加第一批补丁，不含其他任务工作区改动。
- 全量测试：553 文件，547 通过、3 失败、3 跳过；5815 测试，5756 通过、4 失败、55 跳过。失败集合与基线一致，本批新增 1 个单元断言用例通过。
- 六视口（360×800、390×844、768×1024、1024×768、1440×900、1920×1080）×明暗主题：15 个浏览器用例通过，包括 axe、溢出、键盘、理由传值和焦点恢复。axe 在实际过渡动画完成后检查，未降低阈值。
- 独立候选 `pnpm typecheck` 通过（按安装版 Next.js 文档先运行 `next typegen`）。
- 首轮并发验证期间机器负载显著升高，出现时间阈值失败；隔离候选完整复跑回到基线失败集合，未修改原测试超时配置或锁断言。
- `OrderPricingReviewForm` 的旧操作 mock 改接 Controller，`OutsourceActions` 的 L2 结构定位改接 Controller。金额、包装、版本、提交、禁用等原断言均保留。

## 第二批：工单与计价

已完成。审批复核展示款式数量、规格、烫金颜色、加工费与工单金额的旧值 → 新值；缺失版费时不拿部分费用与整单金额比较。权限、版本、报价凭据和提交校验保持原逻辑。

- [第二批] `components/business/order/OrderChangeReviewForm.tsx:157` — 冗长审批说明 → 实际变更行、金额差额、待开工任务调整；拒绝仍保留理由必填及状态保护。
- [第二批] `components/business/order/FulfillmentPricingReviewForm.tsx:218` — 移除第二层确认：逐票金额、总额与差额已在完整复核区呈现；按钮直接调用原确认函数，旧预览失效、版本凭据、重复点击和失败重试保护不变。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:946` — 移除“保存本次核价”泛化弹窗：页面已逐项核价；原 submit、必填检查、金额与版本校验不变。
- [第二批] `components/business/order/OrderChangeFieldDiff.tsx:267` — 删除“计价影响 / 生产影响”通用预测列，保留字段旧值、新值与数量。后果在批准复核层显示一次。
- [第二批] `components/business/order/AdminOrderDecisionPanel.tsx:51` — 下发、结算改为工单名称、数量 / 金额、状态变更；不再把内部工单号和版本作为确认主文案。

- [第二批] `components/business/order/AdminOrderDecisionPanel.tsx:829` — 管理员确认的是是否接受变更；款式与费用由服务端按最新规则自动合并和重算。 → 核对本次变更。
- [第二批] `components/business/order/AdminOrderDetailView.tsx:178` — 费用快照 → 费用记录。
- [第二批] `components/business/order/AdminOrderEditor.tsx:1073` — ，保留修改记录与原报价快照。 → 。。
- [第二批] `components/business/order/ExternalSalesOrderFormRail.tsx:226` — 提交时服务端会重新核价 → 预估费用。
- [第二批] `components/business/order/OrderChangeReviewForm.tsx:1013` — 该组逐票运费已通过服务端重新预览，批准时将提交同一组数据。 → 运费已核对。。
- [第二批] `components/business/order/OrderChangeReviewForm.tsx:306` — 修改审批计价预览（只读） → 变更费用。
- [第二批] `components/business/order/OrderChangeReviewForm.tsx:255` — 取消申请已批准，工单已按服务端结算结果取消。 → 取消申请已批准，工单已取消。。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:965` —  票快递/耗材费仅确认已有快照或补录待核价金额。 →  票物流费用。。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:963` — 已有快照价  → 已报价 。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:956` — 正在确认报价快照… → 正在保存核价…。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:749` — 报价快照（只读） → 已报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:723` — 全部已有报价快照 → 已报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:603` — 报价快照（只读） → 已报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:585` — 全部已有报价快照 → 已报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:569` — 物流报价快照 → 物流报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:562` — 加工费报价快照 → 加工费报价。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:549` — 当前报价快照没有需要补录的人工金额。 → 无待补录金额。。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:491` — 正在读取工单报价快照… → 正在加载费用…。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:485` — 仅核对工单已保存的报价快照；自动报价只读，仅补录待人工核价项。 → 请补录待核价项。。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:182` — 打包耗材费（快照参考 → 打包耗材费（已报。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:159` — 快递费（快照建议 → 快递费（已报。
- [第二批] `components/business/order/OrderPricingReviewForm.tsx:76` — 历史金额（无版本快照） → 历史金额。

验证：隔离候选 553 文件，547 通过、3 失败、3 跳过；5815 测试，5756 通过、4 失败、55 跳过，失败集合与基线一致。类型检查通过。工单审批 6 视口浏览器测试、物流确认 9 个用例、核价提交 1 个用例通过。测试中的过时呈现断言更新为新的显示契约，金额 / 版本 / 重试断言保留。


## 第三批：账单、工资、通知与其他模块

已完成。仅调整展示内容与复核结构，账单冻结、收款金额、通知绑定条件和工资结算操作保护不变。

- [第三批] `app/(admin)/owner/agent-bills/[id]/page.tsx:107` — 客户快照 → 客户。
- [第三批] `app/(admin)/owner/agent-bills/[id]/page.tsx:99` — 仅展示入账时快照；确认后不重算、不覆写。 → 删除与“账单明细”重复的副标题。
- [第三批] `app/(admin)/owner/agent-bills/[id]/page.tsx:97` — 结算成员快照 → 账单明细。
- [第三批] `app/(admin)/owner/agent-bills/[id]/page.tsx:58` — 当前为可重新同步的 DRAFT → 草稿。
- [第三批] `app/(admin)/owner/agent-bills/[id]/page.tsx:38` — 账号快照 → 账单账号。
- [第三批] `app/(admin)/owner/agent-bills/page.tsx:194` — 代理商快照 → 外部销售。
- [第三批] `app/(admin)/owner/agent-bills/page.tsx:183` — 可在上方生成已结束月份的 DRAFT。 → 请选择已结束的月份生成账单。。
- [第三批] `app/(admin)/owner/agent-bills/page.tsx:159` — 查看 legacy 只读归档 → 历史账单。
- [第三批] `app/(admin)/owner/agent-bills/page.tsx:102` — 生成只接受已结束月份；重复执行会幂等同步 DRAFT，不会创建补充账单。 → 仅可选择已结束的月份。。
- [第三批] `app/(admin)/owner/agent-bills/page.tsx:75` — 仅按 settledAt 上海日历月归集已结算的外部销售收费单；确认后永久冻结。 → 按结算月份归集外部销售工单。。
- [第三批] `app/(admin)/owner/bills/archive/[id]/page.tsx:21` — ← Legacy 只读归档 → ← 历史账单。
- [第三批] `app/(admin)/owner/bills/archive/page.tsx:26` — Legacy 账单只读归档 → 历史账单。
- [第三批] `app/(admin)/owner/salary/daily/[id]/page.tsx:59` — 只读核对切换前的任务、计件、保底与调整快照；本页不重算或修改历史财务事实。 → 历史日薪明细。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:197` — 核对快照 → 查看明细。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:138` — 快照机型 → 机型。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:123` —  暂无历史日薪快照 →  暂无历史日薪记录。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:100` — 快照实发合计 → 历史实发合计。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:86` — 导出历史快照 → 导出历史记录。
- [第三批] `app/(admin)/owner/salary/daily/page.tsx:71` — 只读展示切换前 DailyWorkerSalary 与任务快照；不重算、不修改、不与新工序结算叠加。 → 历史日薪记录。
- [第三批] `app/(admin)/owner/salary/hourly/page.tsx:254` — 历史只读 → 已归档。
- [第三批] `app/(admin)/owner/salary/hourly/page.tsx:185` — 清废与厨师可使用上方重算生成月结；历史打包记录只在已有快照时显示。 → 暂无记录。请选择月份生成清废与厨师的月结。。
- [第三批] `app/(admin)/owner/salary/hourly/page.tsx:142` — 新结算仅汇总清废和厨师；切换前打包月结快照只读展示，不再重算或发放。 → 清废与厨师的时薪月结；历史打包工资见归档记录。。
- [第三批] `app/(admin)/owner/salary/page.tsx:171` — 切换前已生成的打包时薪快照仍在历史列表中只读可见；新打包报工只进入工序计件结算。 → 历史打包时薪记录。
- [第三批] `app/(admin)/owner/salary/page.tsx:83` — 快照合计 ¥ → 历史金额合计 ¥。
- [第三批] `app/(admin)/owner/salary/page.tsx:75` — 仅读展示切换前 DailyWorkerSalary 快照；不与新工序账本合并或重算。 → 历史日薪记录。
- [第三批] `app/(admin)/owner/salary/piecework/[id]/page.tsx:62` — 该页只解析已锁定的 ProductionReport 与工价版本快照，不执行重算。 → 已结算报工明细。
- [第三批] `app/(admin)/owner/salary/piecework/page.tsx:75` —  的报工快照已锁定。 →  的报工已结算。。
- [第三批] `app/(worker)/worker/salary/page.tsx:278` — 切换前已生成的 HourlyWorkerPayroll 只读快照，不与上方新账本合并。 → 历史时薪记录。
- [第三批] `app/(worker)/worker/salary/page.tsx:186` — 切换前已生成的 DailyWorkerSalary 只读快照，不与上方新账本合并。 → 历史日薪记录。
- [第三批] `app/(worker)/worker/salary/page.tsx:111` — 新工序报工账本 · 按日锁定，点击日期查看报工和工价快照。 → 按日期查看报工明细。。
- [第三批] `components/business/agent-monthly-billing/AgentMonthlyBillExportControls.tsx:117` — 使用当前账期、状态和代理商筛选快照生成 XLSX；文件 24 小时后过期。 → 导出当前筛选结果。下载文件保留 24 小时。。
- [第三批] `components/business/agent-monthly-billing/AgentMonthlyBillForms.tsx:105` — 本次将按服务端锁定总额收款： → 本次收款金额：。
- [第三批] `components/business/agent-monthly-billing/AgentMonthlyBillForms.tsx:54` — 同步中… → 生成中…。
- [第三批] `components/business/agent-monthly-billing/AgentMonthlyBillForms.tsx:54` — 生成 / 同步 DRAFT → 生成或更新草稿。
- [第三批] `components/business/notification/LegacyNotificationChannels.tsx:31` — ）· 只读 → ）· 已归档。
- [第三批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:1055` — 已建工单的历史快照不会重算。 → 删除无变化说明，保留实际生效范围。
- [第三批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:979` — 已建工单和历史价格快照不变。 → 删除无变化说明，保留实际生效范围。
- [第三批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:1235` — 一条中通地区规则缺少可信的省份或续重单位，已降级为只读。 → 中通计费省份或续重单位缺失，暂不可编辑。请补齐该地区规则。。
- [第三批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:882` — 机烫费的低于跳变点/达到跳变点两条规则不完整，本区已降级为只读。 → 机烫计费档位不完整，暂不可编辑。请补齐两档规则。。
- [第三批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:790` — 红包单重与快递数量上限按物流价目版本管理；当前页先只读展示，避免保存价格时覆盖重量规则。 → 红包单重与快递数量上限。
- [第三批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:788` — 重量策略当前只读 → 物流重量参数。
- [第三批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:346` — 草稿缺少完整的规则时间戳，本次已降级为只读。 → 草稿资料不完整，暂不可编辑。请刷新后重试。。
- [第三批] `components/business/rules/pricing/CustomerPricingSectionViews.tsx:282` — ，只读： → ，当前值：。
- [第三批] `components/business/rules/salary/EmployeePayRulesPage.tsx:25` — 新版本按生效时间用于后续工资快照，不回算已结算记录。 → 员工工价与生效日期。
- [第三批] `components/business/salary/PieceworkSettlementActions.tsx:106` — 金额直接汇总报工时已锁定的工价快照。 → 结算金额以各条报工金额为准。。

- [第三批] `components/business/notification/ChannelForm.tsx:102` — Bot ID / Secret 通道、连接配置导语 → 企业微信群、保存名称后生成绑定码的步骤；隐藏 transport 值及绑定后启用条件不变。
- [第三批] `components/business/notification/SmartBotBindingPanel.tsx:77` — 连接部署说明与重复预告 → 生成码、在目标群发送、绑定状态；旧码失效只写在重新生成动作旁。
- [第三批] `components/business/notification/LegacyNotificationChannels.tsx:35` — Webhook 实现与兼容说明 → 新建目标并调整推送规则的恢复步骤。
- [第三批] `components/business/notification/UnknownNotificationActions.tsx:79` — 状态机制与审计介绍 → 投递状态旧值 / 新值及是否重发；原权限、重发限制、忽略理由保留。
- [第三批] `components/business/salary/PieceworkSettlementActions.tsx:62` — 数据库不可变约束 / 表名 → 报工数量、金额、结算 / 发放状态；不可撤销后果保留。
- [第三批] `components/business/price/ExternalSalesPriceBookDraftForms.tsx:988` — 改期时保持哈希等说明 → 原生效时间与拟定生效时间；必填理由、历史版本不可原地编辑、并发保护不变。
- [第三批] `components/business/material/StockTransactionForm.tsx:43`、`components/business/purchase/PurchaseReceiptForm.tsx:38`、`components/business/purchase/CancelPurchaseReceiptButton.tsx:16` — 写流水 / 再校验机制 → 库存、已收数量的实际增减；原数量校验及事务不变。
- [第三批] `components/business/rules/pricing/CustomerPricingSectionViews.tsx:650` — 手填产生缝隙的讲解 → 上界正整数与相邻范围条件；删除单价单位旁的 PER_UNIT。
- [第三批] 共享确认调用的按钮 / 标题删去多余“确认”“填写原因并”和问号；删除、付款等确认保留，理由字段仍由 Controller 执行原必填校验。

验证：隔离候选全量 553 文件、5815 测试，仍为基线的 4 个失败，未新增失败；类型检查及本批 ESLint 通过。通知绑定在 6 个视口完成布局、axe、键盘焦点和未绑定 / 已绑定两态检查。更新的旧测试仅对应展示契约；禁用、隐藏枚举值、绑定目标遮罩及操作参数断言保留。


## 第四批：价格阶梯业务条件

已完成业务逻辑修复，单独提交。

- 真值：`docs/加工费计费规则.md:92` 明确默认上界可在配置中心修改；固定十档，不固定第九档的默认上界 40,000。
- [第四批] `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:942` — 仅 max=40,000 / next min=40,001 才能编辑 → 五个规格各十档、档位连续、范围一致时可编辑；九档、缺失或错位仍拒绝编辑，不靠删提示绕过。
- [第四批] `lib/price/fixed-custom-tiers.ts:5` — 新增共用校验：从 1 起、整数上界、连续且严格递增、末档不限、各规格一致。按现有档位顺序检查，拒绝通过交换区间重排档位。
- [第四批] `lib/price/customer-price-book-admin.ts:2498` — 保存前按现有档位顺序校验全部提交范围；身份、资源归属、完整行集合、expectedUpdatedAt、事务和金额校验不变。
- [第四批 fixture] `lib/price/__tests__/fixed-custom-tiers.test.ts` — 默认上界与 42,000 / 30,000 合法上界、缺规格、九档、断层、重叠、小数、错误首档、有限末档、跨规格不一致、档位互换。
- [第四批 fixture] `lib/price/__tests__/customer-price-book-admin.test.ts` — 改为 42,000 时仅写入五个规格的本档上界及下一档下界，共 10 行；存在断层时零写入、零审计记录。
- [第四批 fixture] `components/business/rules/pricing/__tests__/CustomerPricingDedicatedSection.test.tsx` — 默认 40,000 和自定义 42,000 的上界输入均可编辑。

隔离全量验证：554 文件，548 通过、3 失败、3 跳过；5832 测试，5773 通过、4 失败、55 跳过。新增 17 个测试通过，失败集合与基线一致。类型检查通过。没有修改数据库数据、schema 或已应用迁移。

## Lint 与豁免

已接入：`pnpm lint` 同时执行 ESLint 与 UI 文案检查，现有 `.github/workflows/quality.yml:83` 调用此命令。PR 模板新增「新增用户可见文案已对照 ui-规范 §文案」。本地检查通过；本任务未推送，不宣称远端 CI 已执行。

- [门禁] `scripts/ui-copy/check.mjs:1` — TypeScript AST 识别 JSX 文本、显示属性、toast / 提示、confirm props，并追踪本地 / 导入变量、函数返回值、条件分支、switch、try/catch；日志、注释、枚举比较、隐藏表单值豁免。
- [门禁] `scripts/ui-copy/__tests__/check.test.ts:1` — 19 个断言用例覆盖禁词、可见输入值、跨文件追踪、同名局部变量、精确豁免、日志排除、规范映射表与 lint 命令连接。
- [门禁扩展] `actions/owner-notifications.ts:146`、`:200` — 迁移路由 / Bot ID + Secret / LIGHT worker 提示 → 旧版目标不可编辑、机器人配置不完整或连接异常，并提供新建目标、联系管理员、重试的恢复动作；原错误状态与权限拒绝路径不变。
- [门禁扩展] `lib/notification/channel-selection.ts:62` — 技术通道与连接参数提示 → 通知目标不可配置 / 配置不完整及处理动作。

禁词表：`settledAt`、`DRAFT`、`幂等`、`快照`、`只读`、`服务端`、`迁移`、`revision`、`Salary`、`Prisma`、`同步中`、`DailyWorkerSalary`、`null`、`未同步`、`空快照`、`请确认影响范围`、`执行后会发生以下变化`、`确定吗`、`同步`、`HourlyWorkerPayroll`、`ProductionReport`、`ProductionTask`、`PER_UNIT`。

通知流程额外禁词：`Bot ID`、`Secret`、`worker`、`Worker`，限定 `components/business/notification/`、`actions/owner-notifications.ts`、`lib/notification/channel-selection.ts` 的可见文案；不会把管理员诊断页面一并禁用。

逐条豁免（禁止目录级放行）：
- `app/(admin)/owner/pigsty/page.tsx` — “只读检查，不会安装扩展或修改集群配置。”；原因：管理员数据库诊断操作边界，需要区分检查与修改集群；不是普通业务流程。
- `app/dev/showcase/page.tsx` — “终态保持中性只读；表格空态提供合法 table 行与紧凑移动形态。”；原因：仅开发环境的组件规范示例，面向开发人员说明组件契约。

最终隔离验证：555 文件，549 通过、3 失败、3 跳过；5851 测试，5792 通过、4 失败、55 跳过。相对初始基线新增 37 个通过测试，无新增失败。`pnpm typecheck` 通过；`pnpm lint` 通过，0 未豁免命中，保留原有 2 个无关未使用符号警告。



### 通知入口补查

- [第三批补查] `lib/notification/channel-selection.ts:70` — “绑定时 Bot ID 与当前配置不一致” → “机器人账号已变更，请新建通知目标”；新绑定 / 现有绑定的允许条件不变。
- [第三批补查] `actions/owner-notifications.ts:159`、`:573`、`:580` — Bot ID 和 LIGHT worker 返回提示 → 机器人账号变更、恢复原账号 / 新建目标、连接异常及联系管理员重试；测试发送拒绝条件不变。
- [第三批补查] `components/business/notification/ChannelForm.tsx:166` — 删除“启用”旁的后果预告及重复账号异常说明；保留上方原因与恢复动作，未绑定条件简写为“绑定后可启用”。
- [第三批补查] `components/business/notification/TestChannelButton.tsx:91`、`actions/owner-notifications.ts:576` — 排队发送 / 运行进程 / 数据库说明 → 当前是否会发送、查看投递结果和故障恢复动作；结果不明时仍先核对群消息。
- 验证：相关 28 个测试通过；增加通知范围的禁词断言后，隔离全量得到 555 文件、5851 测试，5792 通过、55 跳过、原有 4 个失败。类型检查通过，lint 零错误、零未豁免命中，原有 2 条警告保留。旧测试只更新业务提示的显示断言，匹配校验、禁用、重新验证及授权拒绝断言保留。

## 验收证据

| 验收项 | 证据 |
|---|---|
| 操作前看懂变化 | 工单审批显示数量、加工费、整单金额与差额；缺失版费不展示误导差额；价格改期显示原 / 新时间 |
| 后果只出现一次 | 共享组件去重与实际工单页面 + 弹窗整条链的出现次数断言；物流、工厂核价移除重复弹窗 |
| 失败后知道如何继续 | 物流失败提供重试且沿用原请求；通知未配置 / 连接异常提供处理动作；报价失效提示重新预览 |
| 权限、金额、版本及重复提交保护 | 全量失败集合与基线一致；物流 9 个浏览器用例保留原版本、凭据、重复点击、失败重试断言；核价提交浏览器用例通过 |
| 六视口及键盘 | 360×800、390×844、768×1024、1024×768、1440×900、1920×1080；共享确认 15、实际工单审批 6、通知绑定 6、物流 9、核价 1，共 37 个浏览器用例通过；包含 axe、溢出、Esc 与焦点恢复。复核了手机与桌面截图 |
| 业务条件 | 十档范围 13 个纯校验用例、2 个写入边界用例、2 个 UI 用例；合法调价写 10 行，非法断层零写入 |

截图：[六视口审批截图](/Users/zhixing/.codex/visualizations/2026/09/07/01a07aa7-bdfa-76c3-8bb1-73be2bb0a79c/presentation-repair/index.html)。这是实际组件浏览器测试截图，不是替代真实组件的静态设计图。未执行真实付款、批准生产或发布价目。

测试迁移遵循实际行为：旧 API mock 改接新控制入口，必要文案断言改为新的业务呈现；没有删除权限、理由、数量、金额、状态、版本或防重复提交断言来掩盖回归。各批先保留失败输出，修复本次回归后在独立候选目录复跑全量。

## 保留边界与待拍板残留

- 无新增业务真值冲突待裁决。历史九档价目仍属于缺档，不能绕过十档条件；需另行补齐完整草稿后发布。本次没有修改历史价格、数据库数据或已应用迁移。
- 初始基线的 4 个失败仍保留：Button 约束 1、原生 disclosure 约束 1、WORKER / SALES 详情契约 2。未修改这些既有失败断言；不能将本次结果表述为“全量全绿”。
- 静态门禁覆盖可追踪的源码文案，不保证识别数据库内容或外部服务运行时返回的任意字符串；这些仍需在展示边界转换业务名称，并遵循规范与 PR 检查。
- 六视口验证覆盖本次改变交互结构的确认、工单审批与通知绑定；其余仅文案修改页面用原有全量测试核对，未声称对全站每一页都做了截图对照。
- 本次所有提交均为本地提交，未推送。任务开始前及其他任务期间产生的无关工作区改动保留。
