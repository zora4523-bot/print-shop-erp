# 组件清单与重复实现扫描（只读）

- 仓库：`print-shop-erp`（Next.js 16 + Tailwind v4 + shadcn/base-ui）
- 扫描范围：`app/**`、`components/business/**`、`components/ui/**`、`components/ui-business/**`、`lib/**`（金额/日期）
- 排除：`node_modules`、`generated`、`tests/`、`__tests__/`、`*.test.*`、`*.spec.*`
- 统计口径：除特别说明外，"文件数" = 含该模式的文件个数；"次数" = grep 命中行/匹配数。
  引用计数来自逐文件解析 `import { … } from '…'`（含多行 import），脚本见 scratchpad `imports.mjs`。

---

## 1. 共享组件清单

### 1.1 `components/ui/`（shadcn 原子件，20 个文件）

| 文件 | 导出 | 引用文件数（app+business） | 备注 |
|---|---|---|---|
| `button.tsx:59` | Button, buttonVariants | 155（Button 109 / buttonVariants 71；`<Button` 241 处、`buttonVariants(` 160 处） | 最核心 |
| `input.tsx:20` | Input | 57（`<Input` 174 处） | |
| `badge.tsx:52` | Badge, badgeVariants | 38（Badge 38，badgeVariants 0；`<Badge` 103 处） | badgeVariants 无业务引用 |
| `label.tsx:20` | Label | 32（`<Label` 103 处） | |
| `disclosure.tsx:39` | Disclosure, DisclosureSummary | 23 | |
| `checkbox.tsx:53` | Checkbox（+type CheckboxProps） | 18（`<Checkbox` 32 处） | |
| `table.tsx:126` | Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption | 13（TableFooter 0、TableCaption 0） | |
| `dialog.tsx:130` | Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger | 7（DialogOverlay 0、DialogPortal 0、DialogClose 1） | |
| `textarea.tsx:18` | Textarea | 6（Textarea 5 文件、`<Textarea` 15 处） | 对比原生 `<textarea` 17 处 |
| `card.tsx:87` | Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent | 5（Card 5 / CardContent 5 / CardHeader 4；CardFooter/CardAction/CardDescription/CardTitle 0） | **手写卡面 112 文件**，见 §2.4 |
| `sheet.tsx:131` | Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription | 4 | |
| `dropdown-menu.tsx:264` | DropdownMenu + 14 子件 | 3（CheckboxItem/Shortcut/Sub*/Portal 均 0） | |
| `sidebar.tsx:629` | Sidebar + 20 子件 | 3（仅 AppSidebar 全量使用；SidebarGroupAction/MenuAction/MenuBadge/Rail 0） | |
| `skeleton.tsx:13` | Skeleton | 3（`<Skeleton` 30 处，24 处集中在 `app/(admin)/orders/_components/OrdersListContentSkeleton.tsx`） | ContentSkeleton 内部也用 |
| `alert-dialog.tsx:173` | AlertDialog + 10 子件 | 1（仅 `components/ui-business/ConfirmActionDialog.tsx:4-14`） | 业务层 0 直接引用 |
| `alert.tsx:70` | Alert, AlertTitle, AlertDescription, alertVariants | 1（alertVariants 0） | 几乎未用 |
| `avatar.tsx:102` | Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge | 1（仅 Avatar+AvatarFallback；其余 0） | |
| `breadcrumb.tsx:117` | Breadcrumb + 6 子件 | 1（BreadcrumbEllipsis 0） | |
| `progress.tsx:34` | Progress | **0** | `AdminOrderDetailView.tsx:38` 有同名本地 `function Progress` |
| `tooltip.tsx:66` | Tooltip, TooltipTrigger, TooltipContent, TooltipProvider | **0** | dashboard 3 个图表里的 `Tooltip` 是 recharts 的 |
| `use-horizontal-scroll-cue.ts:18,42` | getHorizontalScrollCueState, useHorizontalScrollCue | 1 | |

**0 引用**：`progress.tsx`、`tooltip.tsx` 整文件；子件级 0 引用：AlertDialogOverlay/Portal、Avatar{Image,Group,GroupCount,Badge}、BreadcrumbEllipsis、Card{Footer,Action,Description,Title}、Dialog{Overlay,Portal}、DropdownMenu{CheckboxItem,Shortcut,Sub,SubTrigger,SubContent,Portal}、Sidebar{GroupAction,MenuAction,MenuBadge,Rail}、Table{Footer,Caption}、TooltipProvider、badgeVariants、alertVariants。

### 1.2 `components/ui-business/`（barrel `index.ts`，26 个源文件）

| 文件 | 导出（barrel） | 引用文件数（app+business） |
|---|---|---|
| `ActionNotice.tsx:61` | ActionNotice | **49** |
| `StatusBadge.tsx:20` | StatusBadge | **40**（`<StatusBadge` 66 处） |
| `PageHeader.tsx:16` | PageHeader | 39 |
| `ConfirmActionDialog.tsx:56,66,77` | ConfirmActionController, ConfirmActionDialog, confirmationCanSubmit | 30 / 30 / **0** |
| `EmptyState.tsx:75` | EmptyState | 25 |
| `FormErrorSummary.tsx:26` | FormErrorSummary（type FormErrorSummaryItem 13） | 15 |
| `PendingButton.tsx:22` | PendingButton | 14（`<PendingButton` 16 处） |
| `TableEmptyState.tsx:31` | TableEmptyState | 13 |
| `FormMessage.tsx:20,28,43` | FormMessage, formMessageA11yProps, formMessageId | 12 / 11 / **0** |
| `StatCard.tsx:51` | StatCard | 11 |
| `DisabledReason.tsx:38` | DisabledReason | 10 |
| `ErrorBoundary.tsx:46` | ErrorBoundary | 10 |
| `TableScrollArea.tsx:12` | TableScrollArea | 9 |
| `ContentSkeleton.tsx:32,84` | ContentSkeleton, SlowLoadingHint | 6 / 8 |
| `ErrorState.tsx:18` | ErrorState | 5 |
| `PendingLink.tsx:11` | PendingLink | 5 |
| `EnvNotice.tsx:9` | EnvNotice | 4 |
| `BatchActionResult.tsx:65` | BatchActionResult | 4 |
| `LongTaskReceipt.tsx:28,43` | LongTaskReceipt, remainingHoursLabel | 2 / **0** |
| `_tones.ts:10` | TONES, type Tone | 1 / 2 |
| `ActionShortcut.tsx:22` | ActionShortcut | 1 |
| `NavCard.tsx:24` | NavCard | 1 |
| `HeroBanner.tsx:19` | HeroBanner | 1 |
| `ConflictResolutionPanel.tsx:22` | ConflictResolutionPanel | 1 |
| `TerminalReadOnlyBanner.tsx:12` | TerminalReadOnlyBanner | 1 |
| `empty-state-copy.ts:1-19` | EMPTY_NO_ACCESS_{TITLE,DESCRIPTION,ACTION,HOME_HREF}（barrel 导出）；emptyNoDataTitle / emptyNoDataDescription / emptyNoResultTitle / EMPTY_NO_RESULT_DESCRIPTION（**未进 barrel**） | 全部 **0**（仅 EmptyState 内部消费） |

**0 引用导出**：`confirmationCanSubmit`、`formMessageId`、`remainingHoursLabel`、`focusFormErrorSummary`（`FormErrorSummary.tsx:19`，未进 barrel）、`empty-state-copy.ts` 全部 8 个导出。

**barrel 外 deep import（违反 `index.ts:1-2` 注释规则）——3 处**：

| 文件:行 | 语句 |
|---|---|
| `components/business/order/AdminOrderDecisionPanel.tsx:24` | `import { ActionNotice } from '@/components/ui-business/ActionNotice'` |
| `components/business/order/AdminOrderDecisionPanel.tsx:25` | `import { DisabledReason } from '@/components/ui-business/DisabledReason'` |
| `components/business/rules/pricing/CustomerPricingSectionViews.tsx:16` | `import { TableScrollArea } from '@/components/ui-business/TableScrollArea'` |

barrel 引用文件数：157（`from '@/components/ui-business'`）。

---

## 2. 页面 / 业务组件里的私有重复实现

### 2.1 状态徽章（StatusBadge / Badge）

共享实现：`components/ui-business/StatusBadge.tsx:20`（props `tone: Tone; dot?; className?`，class = `inline-flex h-6 … rounded-full border px-2.5 text-xs font-medium` + `TONE_BADGE_SOFT[tone]`，`_tones.ts:34`），tone 六档 `primary|warning|info|success|danger|neutral`（`_tones.ts:10`）。业务枚举→tone 集中在 `lib/ui/status-registry.ts:51-435`（19 个 registry）。
shadcn `Badge`（`components/ui/badge.tsx:7`）variant：default/secondary/destructive/outline/ghost/link，`h-5 rounded-4xl`（与 StatusBadge `h-6 rounded-full` 不同高）。

本地 `*Badge/*Pill` 定义 **29 个**（业务 17 + 页面 12）：

| 文件:行 | 名称 | 底层 | 差异点 |
|---|---|---|---|
| `components/business/order/OrderStatusBadge.tsx:17` | OrderStatusBadge | StatusBadge + ORDER_STATUS_REGISTRY | 合规薄封装 |
| `components/business/order/AdminWorkspaceStatusBadge.tsx:5` | AdminWorkspaceStatusBadge | StatusBadge + ORDER_STATUS_REGISTRY.tone | **自带 STATUS_LABELS 表**（:16）与 registry label 并存；className 覆写 `h-auto rounded-full px-2.5 py-0.5 text-[11px] font-extrabold` |
| `components/business/order/ShipmentStatusBadge.tsx:5` | ShipmentStatusBadge | StatusBadge + registry | 合规 |
| `components/business/order/UrgentBadge.tsx:7` | UrgentBadge | StatusBadge tone=warning | 合规；但 `AdminOrderDetailView.tsx:115` 又内联 `<StatusBadge tone="warning">急单</StatusBadge>` 未复用 |
| `components/business/order/PromisedDateBadge.tsx:7` | PromisedDateBadge | **shadcn Badge** | `variant="destructive"` / `variant="outline"` + 手写 `border-warning/50 bg-warning/10 text-warning-foreground`（≈ TONE_BADGE_SOFT.warning 但 border 透明度 50 vs 30） |
| `components/business/order/SalesOrdersList.tsx:493` | SalesStatusBadge | **shadcn Badge** + 自有 5 档 tone | tone 来自 `lib/order/sales-list-presentation.ts:31`（`muted/outline/production/shipped/attention`），class 手写（`:503-511`）——与 `Tone` 体系**平行的第二套 tone** |
| `components/business/order/SalesOrderDetailView.tsx:523` | SalesDetailStatusBadge | 同上 | 与 SalesOrdersList.tsx:493 **逐字重复**（:533-541） |
| `components/business/salary/SalaryStatusBadge.tsx:8,17` | PaymentStatusBadge, SalaryPeriodStatusBadge | StatusBadge + registry | 合规 |
| `components/business/admin/AdminDataTable.tsx:216` | AdminStatusBadge | **Badge** outline/secondary | 启停两态，无 tone 语义 |
| `components/business/account/AccountsTable.tsx:28` | AccountStatusBadge | **Badge** outline/secondary | 与 AdminStatusBadge 同构（活跃/停用） |
| `components/business/price/ExternalSalesPriceBookVersionPanel.tsx:85` | PriceBookVersionStatusBadge | StatusBadge + registry | 合规 |
| `components/business/rules/RuleCenterPageHeader.tsx:24` | RuleCenterEffectBadge | StatusBadge + 本地 EFFECT_PRESENTATION（:5） | 本地 `Record<…,{label,tone}>`，未进 status-registry |
| `components/business/production/TaskDisputePanel.tsx:121` | TaskDisputeStatusBadge | **Badge** secondary/outline | 三态用三元串写 label，未进 registry |
| `components/business/purchase/PurchaseStatusBadge.tsx:11,24` | PurchaseOrderStatusBadge, PurchaseReceiptStatusBadge | StatusBadge + registry | 合规 |
| `app/(admin)/orders/[id]/page.tsx:2070` | ChangeRequestStatusBadge | StatusBadge(as UiStatusBadge) + registry | 与 `owner/order-changes/page.tsx:225` **逐字重复** |
| `app/(admin)/owner/order-changes/page.tsx:225,238` | ChangeRequestStatusBadge, RequestTypeBadge | 前者 StatusBadge；后者 **Badge outline** | |
| `app/(worker)/worker/tasks/[id]/page.tsx:342` | OperationStatusBadge | StatusBadge + registry | 页面私有，其它页无法复用 |
| `app/(admin)/owner/pigsty/page.tsx:64` | ReadinessBadge | StatusBadge + 本地 `readinessTone`（:59） | |
| `app/(admin)/owner/notifications/page.tsx:604,617` | NotificationStatusBadge, BackgroundJobStatusBadge | StatusBadge + registry | |
| `app/(admin)/sales/bills/page.tsx:172` | BillStatusBadge | StatusBadge + BILL_STATUS_REGISTRY | 与 `sales/bills/[id]/page.tsx:361` **逐字重复** |
| `app/(admin)/sales/bills/[id]/page.tsx:361` | BillStatusBadge | 同上 | |
| `app/(admin)/foreman/cdr/page.tsx:297` | DesignBundleStatusBadge | StatusBadge + registry | |
| `app/(admin)/foreman/outsource/page.tsx:94` | StatusPill | StatusBadge + OUTSOURCE_STATUS_REGISTRY | 命名不一致（Pill） |
| `app/(admin)/owner/salary/daily/page.tsx:210` | salaryFloorBadge | **Badge** secondary/outline | 与 `worker/salary/page.tsx:460` **逐字重复** |
| `app/(worker)/worker/salary/page.tsx:460` | salaryFloorBadge | 同上 | |

其它非组件化的 `<span className="… rounded-full …">` 手写 pill：15 处 / 11 文件，如 `ExternalSalesOrderFormRail.tsx:178,260,384`、`OrderAdvancedFilters.tsx:75`、`ExternalSalesPriceBookDraftForms.tsx:678`（`bg-destructive` 实色）、`RuleCenterWorkspaceBar.tsx:83`、`RuleSpecWorkspace.tsx:86` 与 `RulePaperWorkspace.tsx:86`（逐字相同）、`ExternalSalesOrderFormB.tsx:982`、`SalesOrdersList.tsx:454` 与 `AdminOrderWorkspaceList.tsx:343`（角标计数，几乎相同）。

本地 tone/variant 类名映射：`SalesOrdersList.tsx:503-511`、`SalesOrderDetailView.tsx:533-541`（同一 5 档表复制两份）；`InventoryCountClient.tsx:82 diffTone()` 返回 Badge variant；`ExternalSalesPriceBookVersionPanel.tsx:422 deltaTone()`。仓库里没有 `Record<Status, 'bg-… text-…'>` 形式的裸调色板映射（eslint 门禁生效），差异都体现在 semantic token 组合上。

直接用 shadcn `<Badge` 的站点 103 处 / 38 文件，与 `<StatusBadge` 66 处 / 40 文件并行——两套徽章高度（h-5 vs h-6）和圆角（rounded-4xl vs rounded-full）在同页共存。

### 2.2 按钮 / Pending 按钮

- 原生 `<button` 仅 **3 处 / 2 文件**：`app/global-error.tsx`（2）、`app/dev/showcase/page.tsx`（1）。业务层全部走 `Button`/`buttonVariants`。
- `useFormStatus` 业务层 **0 处**（`LogoutButton.tsx:4-7` 注释明确拒绝）。
- 共享 `PendingButton`（`components/ui-business/PendingButton.tsx:22`）：props `pending, pendingLabel, groupNote, blockNavigation`，自动给 form 打 `aria-busy`、pending 时拦截 beforeunload。
- **私有等价实现：`<Button disabled={pending}>` 54 处 / 33 文件**，这些文件都不用 PendingButton（`<PendingButton` 仅 16 处 / 14 文件）。列表：AttendanceRecordDialog、AdminOrderDecisionPanel、OrderChangeWithdrawButton、OrderPricingReviewForm、FulfillmentPricingReviewForm、ReworkOrderForm、OrderChangeRequestForm、SubmitOrderButton、SfCollectToggleForm、AdminOrderDetailDecision、EditOrderForm、OrderCommercialDetailsManager、CraftForm、BomForm、IssueBillButton、GenerateBillsForm、OrderCostEntryForm、AgentMonthlyBillExportControls、AgentMonthlyBillForms、LoginForm、ChangePasswordForm、DeleteChannelButton、UnknownNotificationActions、SalaryRuleSettingsForm、PieceworkSettlementActions、StartCsPeriodForm、BackgroundJobActionButton、ProductCategoryForm、ExternalSalesPriceBookDraftForms、OutsourceAmountForm、TaskDisputePanel、OperationReportForm、PurchaseOrderForm、SettingsForm（均在 `components/business/`）。
  典型样本：`components/business/order/SubmitOrderButton.tsx:34-40` —— `<form aria-busy={pending}><Button disabled={pending}>{pending ? '提交中…' : …}</Button>`，手工复刻 PendingButton 的 aria-busy + 文案切换，但无导航拦截。
- `useActionState` 74 文件、`useTransition` 28 文件。

### 2.3 对话框 / 确认

| 模式 | 计数 |
|---|---|
| 原生 `<dialog` | 0 |
| 自定义 `fixed inset-0` 遮罩 | 0 |
| `window.confirm` / `window.alert` / `confirm(` / `alert(` | 0 |
| `<ConfirmActionDialog` | 48 处 / 36 文件（`ConfirmActionController` 30 文件） |
| `<Dialog` | 10 处 / 8 文件 |
| `<Sheet` | 5 处 / 5 文件 |
| `<AlertDialog` 业务直接使用 | 0（全部经 ConfirmActionDialog） |

按文件（`Dialog / Sheet / ConfirmActionDialog`）：`AdminOrderEditor.tsx` 3/1/0、`AdminOrderDetailView.tsx` 1/0/0、`AdminOrderBatchResultProvider.tsx` 1/0/0、`OrderExportControls.tsx` 0/1/0、`OrderListFilters.tsx` 0/1/0、`SalesOrdersList.tsx` 1/1/0、`AdminOrderDetailDecision.tsx` 1/0/0、`OrderSubmissionReviewDialog.tsx` 1/0/0、`CustomerPricingCreateDraftDialog.tsx` 1/0/0；ConfirmActionDialog 3 处的：`UnknownNotificationActions.tsx`、`PieceworkSettlementActions.tsx`、`ExternalSalesPriceBookDraftForms.tsx`；2 处：`OrderChangeReviewForm.tsx`、`OrderCommercialDetailsManager.tsx`、`PriceWorkspaceNavigationGuard.tsx`、`OutsourceActions.tsx`、`app/dev/showcase/page.tsx`；其余 1 处（见 grep 清单，共 27 文件）。

结论：对话框层收敛良好，无私有重复；差异只在 `Dialog` 与 `ConfirmActionDialog`（L2/L3 确认）的分工。

### 2.4 卡片 / 面板表面

- `Card` 组件（`components/ui/card.tsx:5`，`rounded-xl border bg-card py-4 shadow-sm`）：仅 **5 文件、22 处**（`OrderSavedConfiguration`、`AdminOrderEditor`、`EditOrderForm`、`orders/[id]/edit/page.tsx`、`CustomerPricingSectionViews`）。
- **手写卡面** `rounded-(lg|xl|2xl) border … bg-(card|background|white)`：**284 处 / 112 文件**；其中精确串 `rounded-xl border bg-card` 234 处、`rounded-lg border bg-card` 18 处、`rounded-2xl border bg-card` 2 处。
- 最重的文件：`app/(admin)/orders/[id]/page.tsx` 14、`app/(worker)/worker/tasks/[id]/page.tsx` 10、`app/(admin)/owner/warehouses/page.tsx` 10、`components/business/price/RulePriceWorkbench.tsx` 8、`components/business/order/SalesOrderDetailView.tsx` 8、`app/(admin)/sales/bills/[id]/page.tsx` 8、`app/(admin)/owner/pigsty/page.tsx` 8。
- 差异点：手写版多为 `p-4`/`p-5` + 可选 `shadow-sm`，无 `py-4 gap-4 flex-col` 默认布局，无 `data-slot="card"`；同一文件里 padding 不统一（如 `foreman/cdr/page.tsx:312` 用 `p-3 shadow-sm`，`worker/error.tsx:15` 用 `p-5 shadow-sm`）。

### 2.5 原生表单控件

`components/ui/` **没有 Select / NativeSelect**（`ls components/ui | grep -i select` 为空）。

| 控件 | 原生次数 / 文件数 | 共享组件次数 |
|---|---|---|
| `<select` | **68 / 39** | 无共享 |
| `<textarea` | 17 / 15 | `<Textarea` 15 处 / 5 文件 |
| `<input` | 115 / 54，其中 `type="hidden"` 85；**可见原生 input 30 处 / 19 文件** | `<Input` 174 处 / 57 文件 |

`<select` 最多的文件：`ExternalSalesPriceBookDraftForms.tsx` 6、`AccountForm.tsx` 5、`OrderChangeRequestForm.tsx` 4、`BomForm.tsx` 4、`StockTransferForm.tsx` 3、`StockTransactionForm.tsx` 3；页面层：`owner/salary/hourly` 2、`owner/salary/daily` 2、`owner/agent-bills` 2、`sales/bills` 1、`owner/salary/piecework` 1、`owner/parties` 1、`foreman/attendance` 1。

**8 份互不相同的 `selectClass` 常量**（18 文件引用）：

| 文件:行 | 关键差异 |
|---|---|
| `components/business/order/OrderListFilterFields.tsx:13`（export） | `h-8 rounded-lg bg-background text-base md:text-sm dark:bg-input/30` |
| `components/business/bom/BomForm.tsx:42` | `h-9 rounded-md bg-transparent px-3 text-sm` |
| `components/business/product-category/ProductCategoryForm.tsx:48` | 同 BomForm 逐字 |
| `components/business/purchase/PurchaseReceiptForm.tsx:53` | 同 BomForm 逐字 |
| `components/business/order/OrderForm.tsx:4158` | `min-h-11 rounded-md`（触控高） |
| `components/business/order/SfCollectToggleForm.tsx:264` | `min-h-8 rounded-lg` |
| `components/business/price/ExternalSalesPriceBookDraftForms.tsx:57` | `min-h-11 rounded-lg bg-background` + aria-invalid 样式 |
| `components/business/price/RulePriceWorkbench.tsx:123` | `min-h-11 rounded-lg bg-background`，无 aria-invalid |

可见原生 `<input` 集中在：`ShipOrderFields.tsx`（5）、`ExternalSalesPriceBookDraftForms.tsx`（3）、`EditOrderForm.tsx`/`AdminOrderBatchActions.tsx`/`MaterialForm.tsx`/`worker/salary/page.tsx`/`foreman/cdr/page.tsx`（各 2）。

### 2.6 复制到剪贴板

`navigator.clipboard` **4 处 / 4 文件**，各自实现 try/catch + 文案，无共享 hook：

| 文件:行 | 反馈机制 | aria-live |
|---|---|---|
| `components/business/order/OrderListBatchSelection.tsx:218-219` | `setFeedback({tone,message})` | 有：`:118` `sr-only role="status" aria-live="polite"`，`:303` aria-live |
| `components/business/order/SalesOrdersList.tsx:154` | `setCopyFeedback(string)` | 有：`:221`、`:749` `sr-only role="status" aria-live="polite"` |
| `components/business/order/AdminOrderDetailView.tsx:122` | `setCopyNotice` → `<ActionNotice tone=success/error>`（:131） | **无** aria-live / role=status（ActionNotice 自身是否带 role 需另查） |
| `components/business/notification/SmartBotBindingPanel.tsx:54` | `setCopyStatus(string)` | 仅 `:136` `<p role="status">`，无 aria-live |

### 2.7 金额格式化

**共享 formatter 定义（lib）**

| 定义 | 输出形态 | UI 引用文件数 |
|---|---|---|
| `lib/dashboard/format.ts:18 formatMoney(Decimal.Value)` | `¥ 1,234.56`（带 `¥ ` 前缀，Decimal half-up） | 25 文件（通过 `@/lib/dashboard/format`） |
| `lib/dashboard/format.ts:30 formatMoneyPlain` | `1,234.56` | 0（仅 lib 内 3 文件） |
| `lib/order/sales-list-presentation.ts:98 formatMoney(string)` | `1,234.56`（**同名不同语义**：无 ¥、Number 转换） | 2 文件（SalesOrdersList、SalesOrderDetailView）|
| `lib/price/create-order/money.ts:15 money(Decimal.Value)` | `1234.56`（无千分位，报价内部） | 0 UI 文件 |
| `lib/format/unit-price.ts:4 formatUnitPrice` | `¥ 1,234.5678` | 3 文件 |

**UI 层私有 money 函数（14 个）**

| 文件:行 | 实现 | 与共享差异 |
|---|---|---|
| `components/business/order/AdminOrderDecisionPanel.tsx:946 formatMoney` | `Number(v).toLocaleString('zh-CN',{2,2})` | 无 ¥，调用点再拼 `¥${…}`（:193,375-381） |
| `components/business/order/AdminOrderWorkspace.tsx:489 formatMoney` | 同上逐字 | 调用点 `¥{formatMoney()}`（:318,435） |
| `components/business/order/AdminOrderWorkspaceList.tsx:428 formatMoney` | 同上逐字 | :245 |
| `components/business/order/SubmitOrderButton.tsx:8 money` | `` `¥${Number(v).toLocaleString(...)}` `` | ¥ 无空格（共享是 `¥ `） |
| `components/business/order/AdminOrderEditor.tsx:132 money` | 同上 + null→'待核定' | |
| `components/business/order/OrderSavedConfiguration.tsx:21 money` | 包 `formatMoney` + null→'待核定' | |
| `components/business/order/OrderChangeReviewForm.tsx:107 money / :111 deltaMoney` | `` `¥${value}` `` 直接拼字符串 | 无千分位 |
| `components/business/order/OrderForm.tsx:627 formatOrderCurrency` | `Intl.NumberFormat style:'currency' CNY` | 输出 `¥1,234.56`（无空格） |
| `components/business/order/ExternalSalesOrderFormRail.tsx:61 money` | 同 OrderForm 逐字 | |
| `components/business/salary/CsPayrollPaymentForm.tsx:44 money` | `Number(v).toFixed(2)` | 无千分位 |
| `components/business/dashboard/SalesRankingChart.tsx:141,151 formatAxisMoney/formatTooltipMoney` | Intl 0 位 / 2 位 | 图表专用 |
| `components/business/price/ExternalSalesPriceTierGroupEditor.tsx:354 formatDraftAmountDelta` | `¥${decimalLabel}` 带符号 | |
| `app/(admin)/foreman/materials/page.tsx:36 money` | `` `¥${value}` `` | |

**内联格式化站点**

- `.toFixed(` UI 层 **68 处 / 28 文件**：`owner/salary/cs/[id]/page.tsx` 13、`foreman/outsource/[id]/page.tsx` 6、`sales/bills/[id]/page.tsx` 5、`owner/salary/cs/page.tsx` 4、`CsPayrollPaymentForm.tsx` 3、`InventoryCountClient.tsx` 3、`owner/salary/hourly/page.tsx` 3 …（lib 层另有 57 文件，多为 Decimal→string 边界，不属于展示格式化）。
- `Intl.NumberFormat` 9 处：`OrderForm.tsx:628`、`ExternalSalesOrderFormRail.tsx:62`、`SalesRankingChart.tsx:145,152`、`ExternalSalesPriceTierGroupEditor.tsx:63`、`orders/[id]/page.tsx:1991`、`VisualFixturePriceTierPanel.tsx:17`、`lib/dashboard/format.ts:13`、`lib/order/print-layout.tsx:1497`。
- `toLocaleString(` 29 文件，最多 `AdminOrderWorkspace.tsx` 9、`OrderForm.tsx` 6、`OrderChangeReviewForm.tsx` 6。
- 含 `¥`/`￥` 的行：UI 层 **139 行 / 52 文件**；三种写法并存——`¥ {x}`（带空格：`OrdersTable.tsx:147,154,311`、`BillCostEntryList.tsx:92`、`AgentMonthlyBillForms.tsx:106`、`CsPeriodSummary.tsx:36,40`、salary 系列）、`¥{x}`（无空格：`AdminOrderWorkspace.tsx:318`、`AdminOrderWorkspaceList.tsx:245`、`SalesOrdersList.tsx:651`、`OrderChangeReviewForm.tsx:108-114`）、共享 `formatMoney` 自带 `¥ `。最重文件：`owner/salary/page.tsx` 9、`owner/salary/daily/[id]/page.tsx` 8、`AdminOrderDecisionPanel.tsx` 7。

### 2.8 日期格式化

共享：`lib/format/dates.ts:49 formatDateShanghai`（YYYY/MM/DD）、`:58 formatDateTimeShanghai`（YYYY/MM/DD HH:mm）、`:67 formatDateInputShanghai`（YYYY-MM-DD）、`:76 formatDateTimeLocalShanghai`（datetime-local）。无 dayjs/date-fns 依赖（package.json 无命中）。

| 用法 | 文件数 / 次数 |
|---|---|
| `formatDateTimeShanghai` | 33 / 101 |
| `formatDateShanghai` | 19 / 62 |
| `formatDateInputShanghai` | **1 / 3** |
| 内联 `toISOString().slice(0, 10)` | 9 文件 / 14 处：`order-detail-timeline.ts:175`、`OwnerWatchlists.tsx:72`、`AccountForm.tsx:330,331,342`、`foreman/attendance/page.tsx:86`、`orders/[id]/page.tsx:706,1262,1756`、`orders/[id]/edit/page.tsx:189,364,404`、`owner/salary/piecework/[id]/page.tsx:55`、`owner/salary/daily/[id]/page.tsx:53`（**UTC 切片，非上海时区**，与 formatDateInputShanghai 语义不同） |
| 内联 `Intl.DateTimeFormat` | 4：`OrderForm.tsx:880`（仅时分秒，无 timeZone）、`ExternalSalesPriceBookVersionPanel.tsx:65`（= formatDateTimeLocalShanghai 重写）、`EmployeePayRulesPage.tsx:9 localDateTimeValue`（= formatDateTimeLocalShanghai 逐字重写）、`CustomerPricingDedicatedSection.tsx:511 formatShanghaiDateTime`（= formatDateTimeShanghai 但 `hour12:false` 且接收 string） |
| `toLocaleDateString` / `toLocaleTimeString` | 0 |

### 2.9 空状态

- `<EmptyState` 25 文件、`<TableEmptyState` 13 文件（合计 37 文件）。
- 内联 JSX 文本节点含 `暂无/没有/无数据`（单行 `>…<`）**10 处**：`SalesOrdersList.tsx:450,662`、`SalesOrderDetailView.tsx:380,473`、`AdminOrderWorkspaceList.tsx:339`、`CreateOutsourceForm.tsx:123`、`RuleCenterWorkspaceBar.tsx:92`、`TaskDisputePanel.tsx:86`、`TaskDisputeAdminPanel.tsx:48`、`owner/pigsty/page.tsx:467`。
- 多行 JSX 文本以 `暂无` 开头 **14 处**：`BomForm.tsx:270`、`BillCostEntryList.tsx:38`、`StartCsPeriodForm.tsx:74`、`SalesRankingChart.tsx:53`、`CategoryDistributionChart.tsx:54`、`ProductionTrendChart.tsx:117`（三张图表逐字 `暂无数据`）、`SettingsForm.tsx:297`、`RuleSpecWorkspace.tsx:107`、`orders/[id]/page.tsx:1848`、`owner/background-jobs/page.tsx:98`、`foreman/materials/page.tsx:203`、`foreman/outsource/page.tsx:35`、`owner/salary/cs/[id]/page.tsx:126,241`。
- 字符串字面量 `'暂无…'`（三元/props 内，排除 EmptyState 调用）47 处 / 43 文件。
- `empty-state-copy.ts:7-19` 的 `emptyNoDataTitle/emptyNoResultTitle` 未进 barrel、业务 0 引用。

### 2.10 错误状态

- 路由级：`error.tsx` 7 个（`app/error.tsx`、`app/(admin)/{,owner,orders,foreman,sales}/error.tsx`、`app/(worker)/worker/error.tsx`）+ `global-error.tsx` + `not-found.tsx` 3 个。admin 5 个 error.tsx 均 re-export `components/business/admin/AdminRouteError.tsx:12`（用 ErrorState）；`app/error.tsx:24` 用 ErrorState；**`app/(worker)/worker/error.tsx:13-16` 手写 `<section role="alert" className="rounded-xl border bg-card p-5">`** 未用 ErrorState。
- `<ErrorBoundary` 30 处 / 10 文件（`owner/page.tsx` 9、`OrdersListContent.tsx` 5、`owner/warehouses/page.tsx` 4）；`<ErrorState` 6 处 / 5 文件。
- 内联 `role="alert"` **97 处 / 60 文件**（`OrderForm.tsx` 7、`ExternalSalesPriceBookDraftForms.tsx` 4、`OrderCommercialDetailsManager.tsx` 4 …）。ui-business 自身发出 role=alert 的：`ConflictResolutionPanel`、`ConfirmActionDialog`、`FormErrorSummary`（FormMessage 走 aria 连线，不用 role=alert）。
- 私有错误面板：`app/(admin)/owner/pigsty/page.tsx:78 ErrorPanel`（`rounded-lg border border-warning/30 bg-warning/5` + TriangleAlert，≈ ActionNotice tone=warning）；手写 destructive 块 4 处：`OrderListFilters.tsx:311`、`OrderChangeReviewForm.tsx:318`、`SalesOrdersList.tsx:511`、`SalesOrderDetailView.tsx:541`。
- 手写 `rounded-* border border-(success|warning|info)/N bg-…/10` 通知块（≈ ActionNotice）：27 文件，`OrderChangeReviewForm.tsx` 4、`orders/[id]/page.tsx` 3、`ExternalSalesPriceBookDraftForms.tsx` 2、`OrderForm.tsx` 2 …；而 ActionNotice 已被 49 文件引用，两者在同一文件并存（如 `AdminOrderDecisionPanel.tsx`、`SubmitOrderButton.tsx:44-46`）。

### 2.11 骨架 / 加载

- `loading.tsx` 8 个：`app/(admin)/loading.tsx`（ContentSkeleton variant=card）、`owner|sales|foreman|orders|owner/warehouses/loading.tsx`（5 个均 `AdminRouteLoading` → ContentSkeleton table）、`app/(worker)/worker/loading.tsx:8-15`（**手写 animate-pulse**）、`owner/rules/customer-pricing/loading.tsx` → `CustomerPricingLoading.tsx:3-20`（**手写 animate-pulse ×4**）。
- `<ContentSkeleton` 8 处 / 6 文件；`<Skeleton` 30 处 / 3 文件；内联 `animate-pulse` **11 处 / 7 文件**。
- 私有 Loading 组件（结构几乎相同：`role="status" aria-busy aria-live` + sr-only 标签 + 一块 `animate-pulse rounded-xl border bg-card` + `SlowLoadingHint`）：`app/(admin)/foreman/cdr/page.tsx:269 CdrSectionLoading`、`components/business/dashboard/DashboardSectionLoading.tsx:3`、`components/business/dashboard/OwnerAnalytics.tsx:79 AnalyticsChartLoading`、`components/business/dashboard/OrderAttentionSection.tsx:39 OrderAttentionLoading`、`DeferredDashboardCharts.tsx`；另 `owner/warehouses/page.tsx:364,394,416` 三个 `*Skeleton` 用 `<Skeleton>` 拼；`OrdersListContentSkeleton.tsx` 9 个导出、`CustomerPricingWorkspacePage.tsx:87 DedicatedSectionSkeleton`。

---

## 3. 近似重复对照表

| 职责 | 实现 A | 实现 B | 差异点 | 引用页面数 |
|---|---|---|---|---|
| 状态徽章 | `components/business/order/SalesOrdersList.tsx:493 SalesStatusBadge` | `components/business/order/SalesOrderDetailView.tsx:523 SalesDetailStatusBadge` | 逐字相同；均基于 shadcn Badge + 私有 5 档 tone（`lib/order/sales-list-presentation.ts`），与 ui-business Tone 平行 | 2（销售列表 / 销售详情） |
| 状态徽章 | `app/(admin)/sales/bills/page.tsx:172 BillStatusBadge` | `app/(admin)/sales/bills/[id]/page.tsx:361 BillStatusBadge` | 逐字相同（StatusBadge + BILL_STATUS_REGISTRY） | 2 |
| 状态徽章 | `app/(admin)/orders/[id]/page.tsx:2070 ChangeRequestStatusBadge` | `app/(admin)/owner/order-changes/page.tsx:225 ChangeRequestStatusBadge` | 逐字相同 | 2 |
| 状态徽章 | `app/(admin)/owner/salary/daily/page.tsx:210 salaryFloorBadge` | `app/(worker)/worker/salary/page.tsx:460 salaryFloorBadge` | 逐字相同（Badge secondary/outline 三态） | 2 |
| 状态徽章 | `components/business/admin/AdminDataTable.tsx:216 AdminStatusBadge` | `components/business/account/AccountsTable.tsx:28 AccountStatusBadge` | 同构（启用/停用 vs 活跃/停用），label 不同 | AdminStatusBadge 多表 / AccountsTable 1 |
| 状态徽章 | `components/business/order/UrgentBadge.tsx:7` | `components/business/order/AdminOrderDetailView.tsx:115` 内联 `<StatusBadge tone="warning">急单` | 后者未复用 UrgentBadge | 1 |
| 状态徽章 vs Badge | `ui-business/StatusBadge.tsx`（h-6 rounded-full，tone） | `ui/badge.tsx`（h-5 rounded-4xl，variant） | 两套尺寸/圆角/语义并存，`<Badge` 103 处 vs `<StatusBadge` 66 处 | 38 vs 40 文件 |
| 手写 pill | `components/business/rules/catalog/RuleSpecWorkspace.tsx:86` | `components/business/rules/catalog/RulePaperWorkspace.tsx:86` | 逐字相同 `<span className="shrink-0 rounded-full border bg-background px-3 py-1 …">` | 2 |
| 手写角标 | `components/business/order/SalesOrdersList.tsx:454` | `components/business/order/AdminOrderWorkspaceList.tsx:343` | 仅 `-right/-bottom` 顺序不同 | 2 |
| Pending 按钮 | `ui-business/PendingButton.tsx:22` | `<Button disabled={pending}>` 54 处 / 33 文件（如 `SubmitOrderButton.tsx:35`） | 私有版无 beforeunload 拦截、aria-busy 需手写、pendingLabel 各自三元 | 14 vs 33 文件 |
| select 样式 | `OrderListFilterFields.tsx:13 selectClass`（export） | `BomForm.tsx:42` = `ProductCategoryForm.tsx:48` = `PurchaseReceiptForm.tsx:53`；`OrderForm.tsx:4158`、`SfCollectToggleForm.tsx:264`、`ExternalSalesPriceBookDraftForms.tsx:57`、`RulePriceWorkbench.tsx:123` | 8 份常量，高度 h-8/h-9/min-h-8/min-h-11、圆角 md/lg、bg transparent/background、有无 aria-invalid 各异；无 `ui/select` 组件 | 18 文件引用 selectClass，68 处 `<select` |
| 卡面 | `ui/card.tsx:5 Card` | `rounded-xl border bg-card …` 手写 284 处 / 112 文件 | 手写版 padding p-3/p-4/p-5 不一、无 data-slot | 5 vs 112 文件 |
| 金额 | `lib/dashboard/format.ts:18 formatMoney`（`¥ 1,234.56`） | `lib/order/sales-list-presentation.ts:98 formatMoney`（`1,234.56` 无 ¥） | **同名不同输出**；后者调用点再手拼 `¥` | 25 vs 2 文件 |
| 金额 | `AdminOrderDecisionPanel.tsx:946` | `AdminOrderWorkspace.tsx:489` / `AdminOrderWorkspaceList.tsx:428` | 三份逐字相同 `formatMoney`（Number+toLocaleString），均可换共享 | 3 |
| 金额 | `OrderForm.tsx:627 formatOrderCurrency` | `ExternalSalesOrderFormRail.tsx:61 money` | 逐字相同 Intl currency CNY（输出 `¥1,234.56` 无空格，与共享 `¥ ` 不一致） | 2 |
| 金额 | `SubmitOrderButton.tsx:8 money` | `AdminOrderEditor.tsx:132 money` | 同一模板字符串，后者多 null→'待核定' | 2 |
| 金额 | `OrderChangeReviewForm.tsx:107 money` | `foreman/materials/page.tsx:36 money` | 均 `` `¥${value}` ``，无千分位 | 2 |
| 金额前缀 | `¥ {x}`（OrdersTable.tsx:147 等） | `¥{x}`（AdminOrderWorkspace.tsx:318 等） | 空格有无不一致，139 行 / 52 文件 | — |
| 日期 | `lib/format/dates.ts:76 formatDateTimeLocalShanghai` | `EmployeePayRulesPage.tsx:9 localDateTimeValue`；`ExternalSalesPriceBookVersionPanel.tsx:65` | 逐字重写（en-CA + formatToParts） | 2 |
| 日期 | `lib/format/dates.ts:58 formatDateTimeShanghai` | `CustomerPricingDedicatedSection.tsx:511 formatShanghaiDateTime` | 参数 string、`hour12:false` vs `hourCycle:'h23'` | 1 |
| 日期 | `lib/format/dates.ts:67 formatDateInputShanghai`（1 文件用） | `toISOString().slice(0,10)` 14 处 / 9 文件 | 后者按 UTC 切片，跨日边界与上海时区不一致 | 9 |
| 空状态 | `ui-business/EmptyState` / `TableEmptyState`（37 文件） | 内联 `暂无…` 文本 24 处（§2.9）+ 三张 dashboard 图表 `暂无数据`（`SalesRankingChart.tsx:53`、`CategoryDistributionChart.tsx:54`、`ProductionTrendChart.tsx:117`） | 内联版无 kind/action/icon | 37 vs ~20 文件 |
| 错误面板 | `ui-business/ErrorState`（5 文件） | `app/(worker)/worker/error.tsx:13`、`owner/pigsty/page.tsx:78 ErrorPanel` | 手写 section/div + 图标，无 retry 契约 | 2 |
| 通知块 | `ui-business/ActionNotice`（49 文件） | 手写 `rounded-* border border-warning/N bg-warning/10` 等 27 文件（`SubmitOrderButton.tsx:44`、`OrderListFilters.tsx:311`…） | 手写版 role=status/alert 不统一 | 49 vs 27 |
| 加载 | `ui-business/ContentSkeleton`（6 文件） | `CdrSectionLoading`(cdr/page.tsx:269) ≈ `DashboardSectionLoading.tsx:3` ≈ `AnalyticsChartLoading`(OwnerAnalytics.tsx:79) ≈ `worker/loading.tsx:8` ≈ `CustomerPricingLoading.tsx:3` | 同一模板（role=status + sr-only + animate-pulse 块 + SlowLoadingHint），仅高度不同 | 5 |
| 复制 | `OrderListBatchSelection.tsx:218`、`SalesOrdersList.tsx:154`（sr-only aria-live） | `AdminOrderDetailView.tsx:122`（ActionNotice）、`SmartBotBindingPanel.tsx:54`（`<p role="status">`） | 4 份 try/catch + 文案，反馈机制 3 种 | 4 |

---

## 4. 页面级组件使用统计

- `app/(admin)/**/page.tsx`：**75**；`app/(worker)/**/page.tsx`：**6**；合计 **81**。
- 引用 `@/components/ui-business` 的页面：**48 / 81**（admin 44，worker 4）。
- 未引用 ui-business 的页面：**33**，其中 30 个也不引用 `@/components/ui/*`（多为 ≤ 90 行的薄壳页，把渲染委托给 `components/business/**`，例如 `owner/rules/customer-pricing/page.tsx` 4 行、`owner/bills/page.tsx` 8 行）。
- 未引用 ui-business 但体量较大、值得关注的页面：`app/(admin)/owner/salary/cs/[id]/page.tsx`（365 行，含 13 处 `toFixed`、6 行 `¥`、4 处手写卡面、2 处内联 `暂无`）、`app/(worker)/worker/salary/[id]/page.tsx`（527 行，6 处手写卡面、2 行 `¥`）、`app/(worker)/worker/orders/[id]/page.tsx`（191 行）、`app/(admin)/owner/rules/page.tsx`（146 行）。
- 页面直接引用 `@/components/ui/*` 的：40 / 81。

---

## 5. 结论摘要

1. **收敛良好**：对话框（0 原生/0 window.confirm）、按钮（原生 `<button` 3 处）、日期（101+62 处走 Shanghai helper）。
2. **最大缺口**：卡面（284 手写 vs Card 22）、`<select`（68 处、8 份 selectClass、无共享组件）、Pending 按钮（54 处私有 vs 16 处 PendingButton）。
3. **语义分叉**：两个同名 `formatMoney`（带/不带 `¥ `）+ 14 个页面级 money 函数 + `¥ `/`¥` 空格不一致；`Badge` 与 `StatusBadge` 两套尺寸；`sales-list-presentation` 的 5 档 tone 与 `_tones.ts` 六档 tone 平行。
4. **逐字复制对**：BillStatusBadge ×2、ChangeRequestStatusBadge ×2、salaryFloorBadge ×2、SalesStatusBadge/SalesDetailStatusBadge、selectClass ×3、formatMoney ×3、formatOrderCurrency/money ×2、Section-Loading ×5。
5. **死导出**：`ui/progress.tsx`、`ui/tooltip.tsx`、`confirmationCanSubmit`、`formMessageId`、`remainingHoursLabel`、`focusFormErrorSummary`、`empty-state-copy.ts` 8 个导出；3 处 ui-business deep import 违规。
