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
- [第二批] `components/business/order/OrderChangeFieldDiff.tsx` — 删除“计价影响 / 生产影响”通用预测列，保留字段旧值、新值与数量。后果在批准复核层显示一次。
- [第二批] `components/business/order/AdminOrderDecisionPanel.tsx` — 下发、结算改为工单名称、数量 / 金额、状态变更；不再把内部工单号和版本作为确认主文案。

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

待完成。

## 第四批：价格阶梯业务条件

待完成。固定十档、可编辑上界、单调性必须依据真值文档裁决，不能删除提示或简单放开禁用。

## Lint 与豁免

检查器正在实现，尚未接入 CI，当前不宣称门禁生效。最终禁词表与逐条豁免将在校验完成后列入。

## 待完成验收

- 逐批完整测试与基线对比。
- 实际业务页面的六视口与键盘验证。
- 所有调用方实际数值和后果整理、重复复核移除。
- 价格条件 fixtures 与断言。
