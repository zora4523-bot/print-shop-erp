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

待完成。

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
