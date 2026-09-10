# 交互模式盘点（只读扫描）

- 仓库：`/Users/zhixing/我的项目/print-shop-erp`，分支 `codex/qiyeweixintongzhi`，扫描日期 2026-09-08
- 范围：`app/**`、`components/**`；排除 `node_modules`、`generated`、`__tests__`、`tests/`、`*.test.*`、`*.spec.*`、`docs/`、`app/dev/showcase`
- 计数方法：`grep -rnE` / 小段 Python 正则；所有数字都是"命中行数"或"文件数"，标注在各表中。行号以扫描时工作树为准（含未提交改动）。

---

## 1. 列表页

### 1.1 共享基础设施（先看这些，页面对比才有意义）

| 设施 | 位置 | 说明 |
|---|---|---|
| `Table` 原子件 | `components/ui/table.tsx:18-37` | 自带 `role="region"` + `aria-label`（默认「数据表格」）+ `overflow-x-auto` + `focus-visible:ring-2` 的可聚焦横滚容器；**不需要**再套 `TableScrollArea` |
| `TableScrollArea` | `components/ui-business/TableScrollArea.tsx` | 给裸 `<table>` 用的横滚容器；13 个文件用（见 1.3） |
| 查询参数解析 | `lib/admin/table.ts:26-119` | `firstSearchParam` / `parsePositiveInt` / `parseSortDirection` / `parseSortKey` / `nextSortDirection` / `paginateItems` / `paginationWindow` / `paginatedResult` / `buildTableHref`。**没有** `parseTableQuery` 这个名字 |
| 共享分页 | `components/business/admin/AdminDataTable.tsx:149 AdminPagination` | 唯一共享分页组件；「上一页/下一页」文案在 `:181,189,200,208` |
| 共享搜索栏 | `AdminDataTable.tsx:20 AdminListToolbar` | `<form action={string}>` GET 提交，`name="q"` + 隐藏参数 + 可选 filters 插槽 |
| 共享表格卡 | `AdminDataTable.tsx:73 AdminTableCard` | `isEmpty` → 内嵌 `EmptyState`（默认标题「暂无数据」`:77`）|
| 共享排序头 | `AdminDataTable.tsx:103 AdminSortLink` | href 排序 |
| 空态 | `components/ui-business/EmptyState.tsx`（整页）/ `TableEmptyState.tsx:31`（`variant: 'table'` 返回合法 `<tr><td colSpan>`，`variant: 'compact'` 返回 `role="status"` div）| 文案工厂 `empty-state-copy.ts:7-20`（`还没有X` / `X创建后会出现在这里。` / `没有符合条件的X` / `试试放宽条件`）|

`lib/admin/table` 的引用方：10 个 `app/` 页面 + 16 个组件（grep `lib/admin/table'`，共 26 文件）。

### 1.2 列表实现分四族

| 族 | 实现 | 页面/组件数 | 代表 |
|---|---|---|---|
| A. `AdminDataTable` 套件 + `components/ui/table` 的 `Table` | Toolbar/SortLink/Pagination/TableCard 全套 | 5 页 + 5 个规则中心组件 | `owner/accounts`、`owner/parties`、`owner/purchases`、`owner/boms`、`owner/order-changes`；`rules/catalog/*CatalogPages`、`RulePaperWorkspace`、`RuleSpecWorkspace` |
| B. 裸 `<table>` + `TableScrollArea`（或不套） | 页面内手写 thead/tbody | 22 个 page.tsx 含 `<table`（含 detail 页）| `owner/agent-bills`、`owner/bills/archive`、`sales/bills`、`foreman/outsource`、`owner/warehouses`、`owner/salary/*`、`owner/notifications`、`owner/pigsty` |
| C. 卡片列表 `<ul>` | 无表格 | worker 4 页 + 2 个订单业务列表 | `worker/orders|tasks|salary`；`AdminOrderWorkspaceList.tsx:112`、`SalesOrdersList.tsx:164` |
| D. 业务列表组件（Table + 移动端卡片双形态）| `OrdersTable.tsx:110 <ul md:hidden>` + `:177 hidden md:block` | 2 | `OrdersTable`（客服角色）、`AccountsTable`（`mobileCards=1`）|

### 1.3 逐页明细

图例：分页 `AP`=AdminPagination，`local`=页面内手写上一页/下一页，`—`=无；筛选 `ALT`=AdminListToolbar，`GET(noaction)`=`<form>` 无 action 属性提交回本页，`GET(str)`=`<form action="/path">`；空态 `ES`=EmptyState，`TES`=TableEmptyState，`inline`=手写文案。

| 页面 | 列表实现 | 分页 | 筛选 | 空态 |
|---|---|---|---|---|
| `orders/page.tsx` → `_components/OrdersListContent.tsx` | ADMIN：`AdminOrderWorkspace`→`AdminOrderWorkspaceList`（`<ul>` `:112`）；SALES：`SalesOrdersList`（`<ul>` `:164`）；CS：`OrdersTable`（Table+卡片）| `AP`（`OrdersListContent.tsx:329,450`；`AdminOrderWorkspace.tsx:356`）| `OrderListFilters.tsx:410 <form action="/orders" method="get">`、`SalesOrderListFilters.tsx:109`、`AdminOrderWorkspace.tsx:118`；自家 `lib/order/list-query` 解析，不走 `lib/admin/table` 分页器 | `AdminOrderWorkspaceList.tsx:128 TES`；`OrdersTable.tsx` `ES`×2；`SalesOrdersList.tsx` `ES`×1 |
| `owner/accounts/page.tsx` | `AccountsTable`（Table）| `AP:79` | `ALT:62` | `AccountsTable.tsx` `ES`×1 |
| `owner/parties/page.tsx` | `PartiesTable`（Table）| `AP:125` | `ALT:90` | `AdminTableCard.isEmpty`（inline 文案在 `:` 2 处 `暂无/没有`，为 emptyTitle 参数）|
| `owner/purchases/page.tsx` | `PurchaseOrdersTable`（Table）| `AP:95` | `ALT:78` | `AdminTableCard` |
| `owner/boms/page.tsx` | `BomsTable`（Table）| `AP:71` | 无搜索 | `AdminTableCard` |
| `owner/order-changes/page.tsx` | 页面直接 `Table`（`:152 min-w-[50rem] table-fixed`）+ `<ul>` | `AP:212` | 无 | `ES`×1 |
| `owner/rules/stock-skus|crafts|papers|product-categories|materials` | `rules/catalog/*CatalogPages`（Table / `MaterialCatalogPages.tsx` 含裸 `<table>`）| `AP`（`ProductCatalogPages:208`、`MaterialCatalogPages:212`、`CraftCatalogPages:94`、`RulePaperWorkspace:224`、`RuleSpecWorkspace:269`）| `ALT`（`ProductCatalogPages:156`、`MaterialCatalogPages:193`）；`RulePaperWorkspace:91`、`RuleSpecWorkspace:111` 用 `<form action={routeBase}>` | `ES` / `TES`（`MaterialCatalogPages:413`）；inline 文案 `ProductCatalogPages:200-204` 三种（「没有匹配当前搜索与状态条件的记录。」「暂无已停用记录。」「暂无已启用记录，可切换到“全部”查看。」）|
| `owner/attention/page.tsx` → `OwnerAttentionContent` | 卡片面板 | `AP:38` + `paginationWindow:93,108` | 无 | `emptyText` prop（`:54,69,101`）|
| `owner/prices/external-sales/page.tsx` → `RulePriceWorkbench` | 裸 `<table>` | **local**（`RulePriceWorkbench.tsx:905-947`，`PriceWorkspaceLink` + `min-h-11`）| `RulePriceWorkbench.tsx:278 <form action={props.searchAction} method="get">` | `ES`×2 |
| `owner/agent-bills/page.tsx` | 裸 `<table>` + `TableScrollArea`（3 处）| **local**（`:248-268`，`Link` + `buttonVariants({size:'sm'})`）| `GET(noaction):106` | `ES`×1 |
| `owner/agent-bills/[id]/page.tsx` | 裸 `<table>` + `TableScrollArea` + `<ul>` | — | — | 无空态组件 |
| `owner/bills/page.tsx` / `owner/bills/[id]/page.tsx` | `redirect('/owner/agent-bills')`（`bills/page.tsx:7`）| — | — | — |
| `owner/bills/archive/page.tsx` | 裸 `<table>` + `TableScrollArea` | — | — | `ES`×1 + inline |
| `owner/bills/archive/[id]/page.tsx` | 裸 `<table>` + `TableScrollArea` + `<ul>` | — | — | `TES:65` |
| `sales/bills/page.tsx` | 裸 `<table>` + `TableScrollArea` | — | `GET(noaction):189` | `ES`×1 |
| `sales/bills/[id]/page.tsx` | 裸 `<table>` | — | — | `TES:159` |
| `foreman/outsource/page.tsx` | 裸 `<table>` + `TableScrollArea` | — | 无 | inline `:35 暂无外协单。` |
| `foreman/materials/page.tsx` | 裸 `<table>`，**无** `TableScrollArea` | — | `GET(str):96 action="/foreman/materials"` | inline `:203 没有匹配的物料记录。` |
| `foreman/cdr/page.tsx` | 裸 `<table>` | — | `GET(str):312 action="/foreman/cdr"` | `ES`×1 |
| `foreman/attendance/page.tsx` | 卡片 | — | `GET(noaction):276` | `ES`×1 |
| `owner/salary/daily/page.tsx` | 裸 `<table>` | — | `GET(noaction):228` | `ES`×1 |
| `owner/salary/hourly/page.tsx` | 裸 `<table>` | — | `GET(noaction):295` | `ES`×1 |
| `owner/salary/piecework/page.tsx` | 裸 `<table>`×2 | — | `GET(noaction):319` | `ES`×2 |
| `owner/salary/cs/page.tsx` | 裸 `<table>` | — | 无 | `ES`×1 |
| `owner/salary/cs/[id]/page.tsx` | 裸 `<table>` | — | — | inline `:126`「暂无逐单销售额流水；旧周期可能只有期初/累计汇总。」`:241`「暂无工资发放流水。」|
| `owner/salary/daily/[id]` | 裸 `<table>` + `<ul>` | — | — | inline |
| `owner/warehouses/page.tsx` | 裸 `<table>`×3 + `TableScrollArea`×7 | — | 无 | 自定义 `EmptyRow`（`:352` 包 `TableEmptyState`），文案 `:159,195,213,242,264` |
| `owner/notifications/page.tsx` | 裸 `<table>`×4 | **local**（`:226-245`，`<nav aria-label="待处理推送分页">`，硬编码 `href=\`/owner/notifications?unknownPage=…\``）| 无 | `TES:150,252,329` |
| `owner/background-jobs/page.tsx` | 裸 `<table>` | — | 无 | inline `:98`「暂无后台任务。通知、定时结算与文件生成的任务会落在这里。」|
| `owner/pigsty/page.tsx` | 裸 `<table>`×6 | — | 无 | inline ×7（`SqlBlock emptyLabel` `:427,534,629-631,758`；`:467`「暂无推荐步骤」）|
| `owner/purchases/[id]`、`owner/boms/[id]`、`foreman/materials/[id]`、`foreman/outsource/[id]`、`orders/[id]` | 裸 `<table>`（详情页子表）| — | — | `TES`（`purchases/[id]:147`、`boms/[id]:94`、`materials/[id]:120`、`outsource/[id]:240`、`orders/[id]:1398,1488,1505`）|
| `worker/orders/page.tsx` | `<ul>:49` | `parsePositiveInt`（`:9`）但无分页 UI | 无 | `ES:43`「暂无工序工单」|
| `worker/tasks/page.tsx` | `<ul>:61` | — | 无 | `ES:55`「暂无待处理工序」|
| `worker/salary/page.tsx` | `<ul>`×3（`:127,206,298`）| — | `GET(noaction):392` | `ES`×3（`:121,200,292`）|

### 1.4 差异要点

1. **分页三套**：`AdminPagination`（14 个调用点）vs `agent-bills:248` / `notifications:226` / `RulePriceWorkbench:905` 三处手写；手写版没有「第 x/y 页」统一格式（agent-bills 有、notifications 无），按钮尺寸 `size:'sm'` vs 工作台 `min-h-11`。
2. **筛选四套**：`AdminListToolbar`（5 处）、`<form>` 无 action 回本页（8 处）、`<form action="/path">`（5 处）、订单专用 `OrderListFilters`/`SalesOrderListFilters`/`AdminOrderWorkspace` 三个不同筛选 UI。
3. **横滚容器两套**：`Table` 自带 region（13 文件用 `Table`）vs 裸 `<table>` 加 `TableScrollArea`（7 页 + 2 组件）；`foreman/materials:96`、`owner/pigsty`、`owner/salary/*`、`owner/background-jobs`、`owner/notifications` 的裸表**两者都没套**。
4. **空态三套 + 一套自定义**：`EmptyState`（26 文件）、`TableEmptyState`（14 文件）、inline 文案（见 §5）、`warehouses:352 EmptyRow` 与 `InventoryCountClient.tsx:412 EmptyRow` 两个同名本地封装。

---

## 2. 表单提交

扫描 `app/` + `components/` 全部 `<form` 标签：**107 个**（Python 正则，按 `action=` / `onSubmit=` 分类）。

| 类别 | 数量 | 说明 |
|---|---|---|
| (a) `action={serverAction 或 useActionState 返回的 formAction}` 直连 | 71 | 含 `AdminListToolbar` 等 `action={string}` 搜索表单 3 处（`AdminDataTable.tsx:36`、`RulePaperWorkspace.tsx:91`、`RuleSpecWorkspace.tsx:111`、`RulePriceWorkbench.tsx:278`）|
| (a') 其中 `useActionState` 传入的是**客户端闭包**（渐进增强实际归零）| 7 | 见下表 |
| (b) `action={(fd) => …}` 箭头包裹 | 7 | 见下表 |
| (c) `onSubmit` + `startTransition`/fetch（无 action）| 2 | `FulfillmentPricingReviewForm.tsx:165 onSubmit={preview}`；`InventoryCountClient.tsx:318 onSubmit={(event)=>{event.preventDefault()…}}`（搜索表单）|
| (d) `handleSubmit` 混合：`action={formAction}` **同时** `onSubmit={handleSubmit}` | 12 | 其中真正 react-hook-form 只有 **1 个**（`OrderForm.tsx:3303 handleSubmit(onValid, onInvalid)`，唯一 `from 'react-hook-form'` 引用方）；其余 11 个 `handleSubmit` 是本地函数 |
| GET 导航表单（`action="/path"` 或无 action）| 13 | 筛选用，见 §1.3 |

**(b) 箭头包裹清单（7）**

| 文件:行 | 写法 |
|---|---|
| `components/business/bill/GenerateBillsForm.tsx:22` | `action={(fd) => { … startTransition(() => action({period})) }}` |
| `components/business/bill/IssueBillButton.tsx:37` | `action={() => startTransition(() => action())}` |
| `components/business/order/OrderCancellationRequestForm.tsx:59` | `action={() => action(buildOrderCancellationRequestPayload(…))}` |
| `components/business/order/SfCollectToggleForm.tsx:61` | `action={(formData) => { if (pending) return; formData.set(…) … }}` |
| `components/business/outsource/OutsourceActions.tsx:81` | `action={(fd) => startReceive(() => receiveAction(fd))}` + `onSubmit` |
| `components/business/outsource/OutsourceActions.tsx:135` | `action={() => startCancel(() => cancelAction())}` |
| `components/business/salary/StartCsPeriodForm.tsx:33` | `action={(fd) => { const payload = … }}` |

**(a') `useActionState` 传闭包清单（7）** — `grep -A2 'useActionState[<(]'`

| 文件:行 | 写法 |
|---|---|
| `components/business/order/FinishOrderButton.tsx:19` | `async () => finishOrderAction(orderId)` |
| `components/business/order/ShipOrderForm.tsx:109` | `(previousState, formData) => …` |
| `components/business/bill/IssueBillButton.tsx:29` | `async () => issueBillAction(billId)` |
| `components/business/craft/ToggleActiveButton.tsx:22` | `async () => setCraftActiveAction(craftId, nextActive)` |
| `components/business/product/ToggleActiveButton.tsx:23` | `async (_previous, formData) => …` |
| `components/business/price/ExternalSalesPriceTierGroupEditor.tsx:537` | `async (_previousState, formData) => {…}` |
| `components/business/account/ToggleActiveButton.tsx:21` | `async () => setUserActiveAction(userId, nextActive)` |

(b)+(a') = 14，与 CLAUDE.md §15.8「约 15 处」相符。

**(d) 混合 action+onSubmit 清单（12）**：`bill/RecordPaymentForm.tsx:151`、`material/InventoryCountClient.tsx:373`、`material/StockTransactionForm.tsx:153`、`order/FinishOrderButton.tsx:39`、`order/OrderChangeRequestForm.tsx:676`、`order/OrderChangeReviewForm.tsx:997`、`order/OrderForm.tsx:3303`（RHF）、`order/ReworkOrderForm.tsx:150`、`order/ShipOrderForm.tsx:175`、`outsource/CreateOutsourceForm.tsx:116`、`outsource/OutsourcePaymentForm.tsx:170`、`purchase/PurchaseReceiptForm.tsx:134`、`salary/CsPayrollPaymentForm.tsx:208`；另 `order/EditOrderForm.tsx:127` 是 `action={onReview ? undefined : formAction}` 条件切换。

**Hook 使用量**

| Hook | 调用点 | 文件数 |
|---|---|---|
| `useActionState` | 92 | 73 |
| `useTransition` | 34 | 26（清单：`OrderForm`、`AdminOrderEditor`、`ReworkOrderForm`、`AttendanceRecordDialog`、`ShipOrderForm`、`AdminOrderDecisionPanel`、`FulfillmentPricingReviewForm`、`OrderPricingReviewForm`、`AdminOrderWorkspaceList`、`OrderChangeRequestForm`、`FinishOrderButton`、`OrderChangeReviewForm`、`SfCollectToggleForm`、`AdminOrderBatchActions`、`AdminOrderDetailDecision`、`OrderCommercialDetailsManager`、`DesignUploadPanel`、`IssueBillButton`、`GenerateBillsForm`、`SmartBotBindingPanel`、`TestChannelButton`、`DeleteChannelButton`、`StartCsPeriodForm`、`OutsourceActions`、`CreateOutsourceForm`、`InventoryCountClient`）|
| `useFormState` | 0 | 0 |
| `useFormStatus` | 0（仅注释提到 `LogoutButton.tsx:6`）| 0 |

---

## 3. 确认交互

### 3.1 `ConfirmActionDialog` API（`components/ui-business/ConfirmActionDialog.tsx`）

- `ConfirmActionLevel = 'L2' | 'L3'`（`:19`）；**没有 L1**（L1 = 不弹框）
- 组合式：`<ConfirmActionController level trigger formId disabled onConfirm reasonLabel…>` 包 `<ConfirmActionDialog action changes consequences confirmText danger>`（`:21-49, :56, :77`）
- L3 强制填写原因：`confirmationCanSubmit(level, reason)` `:66-70`，`reasonRequired = level === 'L3'` `:87`
- 按钮变体：`danger || level === 'L3'` → destructive `:158`
- 底层是 `components/ui/alert-dialog.tsx`（Base UI，自带 Esc/焦点管理）；`:75,:96` 有 Escape 处理
- `data-level={level}` 输出到 DOM `:112`；页面另有 `data-risk-level` 属性（L2 ×13、L3 ×4）标记表单容器

### 3.2 调用点：47 个 `ConfirmActionController`，30 个文件

| level | 数量 | 调用点 |
|---|---|---|
| `"L2"` | 37 | `PendingButton.tsx:137`（离开保护）、`OrderPricingReviewForm:946`、`FinishOrderButton:49`、`OrderChangeReviewForm:677,687`、`AdminOrderDecisionPanel:64`、`IssueBillButton:42`、`RecordPaymentForm:225`、`ShipOrderForm:202`、`AdminOrderBatchActions:173`、`OrderCommercialDetailsManager:277,495`、`DeleteChannelButton:49`、`UnknownNotificationActions:70,86`、`SettleReadyCsButton:78`、`RecomputeHourlyForm:100`、`MarkHourlyPaidForm:73`、`CancelPurchaseOrderButton:68`、`SettleCsPeriodButton:53`、`CsPayrollPaymentForm:323`、`PieceworkSettlementActions:54,95,140`、`ActiveStateConfirmButton:40`、`ExternalSalesPriceBookDraftForms:907`、`PriceWorkspaceNavigationGuard:166,274`、`OutsourceActions:101,140`、`OutsourcePaymentForm:251`、`PurchaseReceiptForm:227`、`StockTransactionForm:312` |
| `"L3"` | 8 | `CancelOrderForm:73`、`UnknownNotificationActions:112`、`ExternalSalesPriceBookDraftForms:965,1041`、`CancelPurchaseReceiptButton:69`、`InventoryCountClient:543` 等 |
| 动态 | 2 | `product/ToggleActiveButton:40 level={currentlyActive ? 'L3' : 'L2'}`；一处 `level={level}` 透传 |

### 3.3 其它确认形态

| 形态 | 数量 | 位置 |
|---|---|---|
| `AlertDialog` 直接使用（不经 ConfirmActionDialog）| 0 | `InventoryCountClient.tsx:275` 只是注释提到；实际用 `ConfirmActionDialog:551` |
| `Dialog` 当确认框用 | 1 | `AdminOrderEditor.tsx:1184 <DialogTitle>放弃未保存的修改？</DialogTitle>`（离开保护，未走 ConfirmActionController）|
| `Dialog` 非确认用途 | 6 | `SalesOrdersList:409`（工单明细）、`AdminOrderDetailView:243`（设计图预览）、`AdminOrderDetailDecision:75`（标记已打印）、`OrderSubmissionReviewDialog:395`、`AdminOrderBatchResultProvider:72`（结果）、`CustomerPricingCreateDraftDialog:39`、`AdminOrderEditor:1141,1175` |
| `Sheet` 当确认用 | 1 | `AdminOrderEditor.tsx:1042 <SheetTitle>确认保存修改</SheetTitle>`（见 §9）|
| `window.confirm` / `confirm(` | **0** | — |
| 二次点击 `confirming`/`armed` 状态 | 0 个 UI 级；`InventoryCountClient.tsx:53-72 armedRemark` 是提交前暂存备注的内部状态，不是二次点击 | — |
| `<details>` 做确认 | 0（`orders/[id]/page.tsx:1750 <details>` 是「工单信息」折叠；`components/ui/disclosure.tsx:15` 是通用折叠）| — |

结论：确认交互已收敛到一种主实现 + 两处离开保护走了别的组件（`AdminOrderEditor` 用 Dialog/Sheet，`PendingButton`/`PriceWorkspaceNavigationGuard` 用 ConfirmActionController）。

---

## 4. Toast / 操作反馈

- **没有 toast 库**：`package.json` 无 `sonner` / `react-hot-toast`；`app|components|lib` 中无 `useToast` / `toast(` 引用（0 命中）。反馈全部是页内 inline。

| 形态 | 命中 | 文件数 | 说明 |
|---|---|---|---|
| `<ActionNotice tone=…>` | 99 | 49 | `ui-business/ActionNotice.tsx:12` `tone: success|info|warning|error`，自带 `role` + `aria-live`（`:76-77`）。最多的文件：`WarehouseForms.tsx` ×5、`OutsourceReceiveFeedback` ×4、`StockTransferForm`/`SettleCsPeriodButton`/`PieceworkSettlementActions`/`ProductForm`/`OutsourceActions`/`EditOrderForm`/`CancelOrderForm`/`AdminOrderEditor`/`TestChannelButton`/`SmartBotBindingPanel`/`InventoryCountClient`/`salary/piecework/page.tsx` 各 ×3 |
| 手写 `role="status"`（不含 ui-business）| 65 | 42 | 最多：`OrderExportControls` ×4、`OrderChangeReviewForm` ×4、`SalesOrdersList` ×3、`AgentMonthlyBillExportControls` ×3 |
| 手写 `aria-live`（不含 ui-business）| 39 | 27 | `OrdersListContentSkeleton.tsx` ×8（骨架屏）、`OutsourceAmountForm` ×3、`CreateOutsourceForm` ×3、`warehouses/page.tsx` ×3 |
| `<p … text-destructive>` 手写错误行 | 133 | 57 | 最多：`StartCsPeriodForm` ×7、`OrderPricingReviewForm` ×6、`BomForm` ×6、`PurchaseOrderForm` ×5、`SalesOrdersList` ×5、`OrderForm` ×5、`ChannelForm` ×5、`PurchaseReceiptForm` ×4、`ProductCategoryForm` ×4、`OrderCommercialDetailsManager` ×4 |
| `router.refresh()` 后配消息 | 45 | 23 | `ExternalSalesPriceBookDraftForms` ×10、`AdminOrderDecisionPanel` ×4、`AdminOrderBatchActions` ×3、`AgentMonthlyBillExportControls` ×3 |
| 手写 `role="alert"`（不含 ui-business）| 110 | 60 | 见 §6 |

差异：同一件事（提交成功/失败）有 `ActionNotice`、裸 `role="status"` div、`<p text-destructive>`、`FormMessage tone="error"`、`FormErrorSummary` 五种落地。`ExternalSalesPriceBookDraftForms` 一个文件同时用了 `router.refresh` ×10、`role="alert"` ×4、`text-destructive` ×2。

---

## 5. 空态

| 形态 | 文件数 | 备注 |
|---|---|---|
| `<EmptyState` | 26（含 `not-found.tsx` ×3）| 标题多为「暂无X」（`worker/orders:45`「暂无工序工单」、`worker/tasks:57`「暂无待处理工序」、`worker/salary:123,202,294`）；`empty-state-copy.ts` 提供的「还没有X」工厂函数**几乎没人调**（`emptyNoDataTitle` 只在 ui-business 内部）|
| `<TableEmptyState` | 14 | `compact` 变体只在 `AdminOrderDetailView.tsx:148,187,196,203` 用 |
| inline 文案 | 约 40 文件 / 70 行 | 见下表 |

**inline 文案措辞（漂移可见）**

| 措辞族 | 例子（file:line）|
|---|---|
| `暂无X。`（句号）| `foreman/outsource/page.tsx:35`「暂无外协单。」；`owner/salary/cs/[id]:241`「暂无工资发放流水。」；`orders/[id]:1848`「暂无包装组。」；`TaskDisputePanel:86`「暂无异议记录。」；`TaskDisputeAdminPanel:48`「暂无师傅异议。」；`BillCostEntryList:38`「暂无材料、物流、伙食、电费等补录成本。」；`ExternalSalesPriceBookVersionPanel:358`「尚无可用价目版本。」|
| `暂无X`（无句号）| `warehouses:159,195,213,242,264`；`SalesOrderDetailView:380,473`「暂无发货地址/费用分项」；`SalesOrdersList:662`；`OwnerWatchlists:87,122,150`、`OwnerAttentionContent:54,69,101`；图表 `SalesRankingChart:53`、`CategoryDistributionChart:54`、`ProductionTrendChart:117`「暂无数据」；`InventoryCountClient:412`「暂无匹配物料」|
| `没有匹配…记录` | `foreman/materials:203`「没有匹配的物料记录。」；`MaterialCatalogPages:209`「没有匹配当前搜索条件的记录。」；`ProductCatalogPages:200`「没有匹配当前搜索与状态条件的记录。」|
| 带引导语 | `background-jobs:98`「暂无后台任务。通知、定时结算与文件生成的任务会落在这里。」；`ProductCatalogPages:204`「暂无已启用记录，可切换到“全部”查看。」；`BomForm:159-160,270`「暂无可用…，请先创建并启用」；`StartCsPeriodForm:74`；`SettingsForm:297`「暂无企业微信群，请先到“推送配置”新建并验证群。」；`WorkerOrderTaskList:67`「本组工序已完成，暂无待报工任务。」/「当前工单没有本岗位计件工序。」|
| select 占位 | `StartCsPeriodForm:60`「暂无可用客服」；`PurchaseOrderForm:75,112`「暂无可用供应商/物料」；`OrderListFilterFields:223`「暂无可选项」|
| 非空态误用「暂无」| `CsPeriodForecast:47,53`「暂无法预测」；`OrderChangeReviewForm:309`「暂无法计算」；`RuleCenterWorkspaceBar:92`「暂无生效版」；`PriceVersionsPage:273`「暂无草稿」；`CustomerPricingDedicatedSection:675`「暂无生效价」|

`EmptyState` 默认标题（`AdminTableCard.tsx:77`「暂无数据」）与 `empty-state-copy.ts:7`「还没有X」两套官方措辞并存。

---

## 6. 错误态

### 6.1 路由级

| 文件 | 实现 |
|---|---|
| `app/global-error.tsx` | 手写 `role="alert"` + `aria-live` + 裸 `<button>` ×2 |
| `app/error.tsx:23` | `ErrorState` + `Button render={<Link>}` |
| `app/(admin)/error.tsx`、`owner/error.tsx`、`orders/error.tsx`、`foreman/error.tsx`、`sales/error.tsx` | 5 个全部 `export { AdminRouteError as default }` → `components/business/admin/AdminRouteError.tsx:15 <ErrorState title="此页面暂时无法加载">` |
| `app/(worker)/worker/error.tsx:14` | 手写 `role="alert"` div + `Button min-h-11 onClick={unstable_retry}`，**未用 `ErrorState`** |
| `not-found.tsx` ×3（`app/`、`(admin)/`、`(worker)/worker/`）| 都用 `EmptyState` + `empty-state-copy.ts` 的 NO_ACCESS 常量 |

### 6.2 组件级

| 形态 | 命中 | 说明 |
|---|---|---|
| `<ErrorState` | 4 | `app/error.tsx:23`、`owner/notifications/page.tsx:446`、`AdminRouteError.tsx:15`、`PriceDataBoundary.tsx:22` |
| `<ErrorBoundary` | 28 处 / 10 文件 | `owner/page.tsx` ×9、`OrdersListContent.tsx` ×5、`warehouses/page.tsx` ×4、`foreman/cdr` ×2、`OwnerAnalytics` ×3、`attention`、`orders/page:43`、`CsPeriodSummary:59`、`CustomerPricingWorkspacePage:67`、`PriceVersionsPage:114` |
| 手写 `role="alert"` | 110 / 60 文件 | `OrderForm` ×7、`ExternalSalesPriceBookDraftForms` ×4、`OrderCommercialDetailsManager` ×4、`ExternalSalesPriceTierGroupEditor` ×3、`SfCollectToggleForm` ×3、`OrderChangeReviewForm` ×3、`EditOrderForm` ×3、`AttendanceRecordDialog` ×3 |
| `<FormErrorSummary` | 15 / 14 文件 | `AccountForm`、`ResetPasswordForm`、`RecordPaymentForm`、`InventoryCountClient`、`MaterialForm`、`StockTransactionForm`、`CancelOrderForm`、`OutsourcePaymentForm`、`PartyForm`、`ProductForm`、`CsPayrollPaymentForm`、`RecomputeHourlyForm`、`StockTransferForm`、`WarehouseForms`；组件自带 `role="alert" aria-live="assertive" tabIndex={-1}`（`FormErrorSummary.tsx:54-58`）|
| `<FormMessage` | 38 / 11 文件 | `AccountForm` ×7、`MaterialForm` ×7、`StockTransactionForm` ×6、`ProductForm` ×5、`PartyForm` ×3、`WarehouseForms` ×3…；`formMessageA11yProps`（`FormMessage.tsx:28`）负责 `aria-describedby/aria-invalid` 连线 |
| inline `fieldErrors?.x` 直接渲染 | 12 文件 / 50 处 | `ExternalSalesOrderFormB` ×15、`ChannelForm` ×9、`LoginForm` ×8、`CsPayrollPaymentForm` ×5、`RuleForm` ×3、`ChangePasswordForm` ×3、`TaskDisputeAdminPanel` ×2 等——这些**没用** `FormMessage`，逐字段 `<p className="text-destructive">`（例 `ChannelForm.tsx` 5 处 `text-destructive`）|

差异：主数据 CRUD 表单（account/material/product/party/warehouse）已统一到 `FormErrorSummary + FormMessage`；订单/通知/登录/薪资一线表单仍是手写 `role="alert"` + `text-destructive`。

---

## 7. Pending / Disabled

| 形态 | 命中 | 文件数 |
|---|---|---|
| `<PendingButton` | 15 | 13 |
| `<PendingLink` | 10 | 5 |
| `<Button/<button … disabled={…pending…}>`（单行）| 55 | 35（`AdminOrderDecisionPanel` ×8、`AgentMonthlyBillForms` ×4、`PieceworkSettlementActions`/`FulfillmentPricingReviewForm`/`AdminOrderDetailDecision`/`UnknownNotificationActions` ×3）|
| 独立行 `disabled={…pending…}`（含 input/select/fieldset）| 273 | 60+（`ExternalSalesPriceBookDraftForms` ×17、`OrderChangeRequestForm` ×16、`PartyForm` ×14、`AdminOrderDecisionPanel` ×11、`BomForm` ×11、`EditOrderForm`/`MaterialForm`/`AccountForm` ×10）|
| `<DisabledReason` | 10 | `orders/[id]/page.tsx:583,611`、`AdminOrderDecisionPanel:839`、`AdminOrderBatchActions:163`、`RuleForm:201`、`TestChannelButton:33`、`DeleteChannelButton:33`、`UnknownNotificationActions:101`、`CreateBundleForm:183`、`SettingsForm:340`；API `cause: 'permission'|'status'|'prerequisite'`（`DisabledReason.tsx:5`），用 `aria-describedby`（`:54`）|
| 按钮上只用 `title=` 说明禁用原因 | **0**（单行 grep `<Button… title=` 0 命中）| — |

结论：`PendingButton` 覆盖率低（15 vs 55+ 处裸 `disabled={pending}`）；`DisabledReason` 只在 10 处，其余禁用按钮大多无原因说明（例：`AdminOrderEditor.tsx:591 disabled={!dirty || locked}` 无 reason）。

---

## 8. 无障碍抽样

### 8.1 焦点样式

- `focus-visible:` 命中 **99** 行（app + components，含 ui/）
- `outline-none` 且同行无 `focus-visible` 替代：4 处，全部在 `components/ui/`（Base UI 弹层容器）：`alert-dialog.tsx:63`、`dialog.tsx:61`、`dropdown-menu.tsx:48,56`。业务层 **0** 处裸 `outline-none`。
- Ring 定义：
  - `components/ui/button.tsx:7`：`outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring`；destructive 变体 `:19` 换成 `focus-visible:ring-destructive`
  - `components/ui/input.tsx:12`：`outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`（注意与 button 不同：`/50` 透明度）
  - `textarea.tsx:10` 同 input；`checkbox.tsx:24` `size-11 … focus-visible:ring-3 focus-visible:ring-ring/50`
  - `app/globals.css:179` 全局 `outline-ring/50`
  - `components/ui/table.tsx:30` 滚动容器 `focus-visible:outline-none focus-visible:ring-2`（ring-2，与其它 ring-3 不一致）

### 8.2 键盘关闭 / 自定义浮层

- `fixed inset-0` / `role="dialog"` 在业务层：**0** 命中。
- 业务层所有 `fixed` 用法（`grep '"…fixed…"'` 非 ui/）：`app/(admin)/layout.tsx:52`（skip-link）、`components/business/production/WorkerBottomNavigation.tsx:24`（底部导航 `z-40`）——都不是浮层。
- 所有 Dialog/Sheet/AlertDialog 均基于 `components/ui/*`（Base UI），Escape/焦点返回由库处理；显式 `Escape` 处理只在 `ConfirmActionDialog.tsx:75,96`、`ThemeToggle.tsx:63,69`、`InventoryCountClient.tsx:276`。
- **缺 Escape 的自定义浮层：无。**

### 8.3 触控目标

| 类名 | 命中（app+components）|
|---|---|
| `h-11` | 229 |
| `min-h-11` | 218 |
| `h-12` | 7 |
| `min-h-12` | 5 |
| `size-11` | 10 |
| `min-h-[44px]` | 0 |
| `touch-target` | 1 |

工人端表面（`app/(worker)/**` + `components/business/production/**`，worker 页面实际引用的组件仅 `production/OperationReportForm`、`WorkerBottomNavigation`、`WorkerOrderTaskList`、`order/DesignImageGallery`、`HighlightedRemark`、`UrgentBadge`、`OrderStatusBadge`、`salary/SalaryStatusBadge`、`auth/LogoutButton`；没有 `components/business/worker*` 目录）：

| 小尺寸类 | 命中 |
|---|---|
| `h-7` | 1 — `app/(worker)/worker/loading.tsx:7`（骨架条，非控件）|
| `h-8` / `size-7` / `size-8` / `h-6` / `size-6` | 0 |

### 8.4 图标按钮 aria-label

- `<Button size="icon*">`：11 处，**全部**有 `aria-label`/`aria-labelledby`/sr-only（Python 扫描 0 缺失）。示例：`SalesOrdersList.tsx:555 size="icon-xs" aria-label={\`复制工单号 …\`}`、`OrderExportControls.tsx:145 size="icon-sm" aria-label="关闭导出工单"`。
- 裸 `<button>` 在 app/business 只有 2 处（`app/global-error.tsx`），均有文字。
- 图标+文字混排按钮（`<Save/> 保存修改…`）不缺标签（正则一度误报 4 处，人工核对为文字在 `{}` 表达式内：`AdminOrderEditor:591`、`CancelOrderForm:77`、`DeleteChannelButton:52`、`CustomerPricingSectionDraftForm:89`）。

### 8.5 `tests/visual` 门禁实际断言

| 门禁 | 位置 | 常量 |
|---|---|---|
| 移动端触控目标 | `tests/visual/ui-gates.ts:154-166` | `if (mobile)` → 选择器 `a[href], button:not([disabled]), input…, select, textarea, [role="button"], [role="checkbox"]`；`rect.width < 44 || rect.height < 44` 即失败。`mobile` 定义 `:7-8`：`viewport.width <= 768` |
| Checkbox 目标 | `ui-gates.ts:119-149` | `[data-slot="checkbox"]` 最小 `44`，紧凑桌面（`(min-width: 921px) and (hover: hover) and (pointer: fine)` + `[data-order-density="compact"]`）放宽到 `24`（`:123-134`）；指示器 18–22px（`:140-145`）|
| 水平溢出/裁切 | `ui-gates.ts:37-88` | `scrollWidth > viewportWidth + 1`、元素 `rect.right > viewportWidth + 1`、`rect.bottom > viewportHeight + 1` |
| axe | `ui-gates.ts:176` | `.withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`，无 `disableRules` |
| 视口矩阵 | `playwright.config.ts:85-99` | worker/admin 各 6：`375x667`、`393x852`、`768x1024`、`1024x768`、`1280x800`、`1920x1080`；`hasTouch/isMobile = width <= 768`（`:154-155,165-166`）|
| 明暗 | `admin-responsive.spec.ts:432`、`worker-responsive.spec.ts:51` | `emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })` |
| 几何回归 | `admin-responsive.spec.ts:170-171` | `checkbox.width/height toBeCloseTo(44, 0)`；视口 `911x881` 与 `1280x800`（`:119-121`）|
| 截图基线 | `order-print.spec.ts:22` | `ARTWORK_COUNTS = [1,2,3,5,8,10]`；`toHaveScreenshot` 于 `:386,428,451,467,503` |
| 并发 | `playwright.config.ts:114,117` | `fullyParallel: false`、`workers: 1` |

---

## 9. Sheet / 抽屉

`from '@/components/ui/sheet'` 引用方：`components/ui/sidebar.tsx`（导航）+ 4 个业务文件，共 5 个 `<Sheet>`：

| 文件:行 | 用途 | 内含保存动作？ |
|---|---|---|
| `components/business/order/AdminOrderEditor.tsx:1029-1131` | `SheetTitle`「确认保存修改」（`:1042`）| **是**：`:1096-1101 <Button onClick={save}>` → `saveAdminOrderEditAction`（`:502-504`）；另 `:1071 onClick={repriceCharges}`。Sheet 内无 `<form>`，但它就是保存的最终确认步骤，违反「抽屉只读」规则 |
| `components/business/order/OrderExportControls.tsx:105-238` | 导出工单面板 | **是（间接）**：`:160,167 <ExportRequestForm>` 渲染在 SheetContent 内，`:263 <form action={formAction}>` 触发导出任务（写 `BackgroundJob`）；另 `:184 onClick={refreshPendingExports}` |
| `components/business/order/OrderListFilters.tsx:236-290` | 移动端筛选条件（`sm:hidden` 触发 `:239`）| 否：内容是筛选字段，提交走外层 `:410 <form action="/orders" method="get">`（GET 导航，不保存）|
| `components/business/order/SalesOrdersList.tsx:199 / 539-752` | 销售端工单明细 | 否：只有复制（`:555,691`）、关闭（`:739`）|
| `components/business/order/SalesOrdersList.tsx:768-799` | 「工单明细」第二形态 | 否：`:788` 返回按钮 |

**结论**：5 个 Sheet 中 2 个（`AdminOrderEditor`、`OrderExportControls`）承载写操作。

---

## 附：关键计数速查

| 项 | 数 |
|---|---|
| `<form` 总数 | 107（A 直连 71 / B 箭头 7 / C onSubmit 2 / D 混合 12 / GET 13；A 中 7 个 useActionState 传闭包）|
| `useActionState` / `useTransition` / `useFormState` / `useFormStatus` | 92 / 34 / 0 / 0 |
| `ConfirmActionController` | 47（L2 37、L3 8、动态 2），30 文件；`window.confirm` 0 |
| toast 库 | 无；`ActionNotice` 99；手写 `role="status"` 65；`role="alert"` 110；`<p text-destructive>` 133；`router.refresh()` 45 |
| `EmptyState` 26 文件 / `TableEmptyState` 14 文件 / inline ≈70 行 |
| `error.tsx` 11 个（含 not-found/global）；`ErrorBoundary` 28；`ErrorState` 4 |
| `PendingButton` 15 / `PendingLink` 10 / 裸 `disabled={pending}` 按钮 55 / `DisabledReason` 10 |
| `focus-visible:` 99；业务层裸 `outline-none` 0；自定义浮层缺 Esc 0；icon 按钮缺 aria-label 0 |
| `Sheet` 5（含写操作 2）|
