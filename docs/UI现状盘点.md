---
status: snapshot
scanned_at: 2026-09-08
branch: codex/qiyeweixintongzhi（含工作区未提交改动）
evidence:
  - audits/2026-09-08-ui-scan-tokens.md
  - audits/2026-09-08-ui-scan-components.md
  - audits/2026-09-08-ui-scan-patterns.md
---

> 历史记录（按文内日期理解）。2026-09-24 起角色、结算与工种口径以 SPEC §L 与 DECISIONS 为准。

# UI 现状盘点（只读）

本文件是「建立项目 UI 规范」任务的第一段产出：只记录代码事实，不做裁决。每条结论带 `文件:行` 与频次；逐行清单见 frontmatter 列出的三份原始扫描（同日、同工作树）。

扫描范围：`app/**`、`components/**`（411 个 `.ts/.tsx/.css`，76,470 行），金额/日期格式化另含 `lib/**`。排除 `__tests__`、`*.test.*`、`*.spec.*`、`generated/`、`tests/`、`docs/`。计数口径为**命中次数**（同一行多次命中计多次），"文件数"单独标注。

规模基数：页面 81 个（`app/(admin)` 75、`app/(worker)` 6）；`components/ui/` 20 文件、`components/ui-business/` 26 源文件、`components/business/` 216 文件。

现有门禁基线（同一工作树实测）：

| 门禁 | 结果 |
|---|---|
| `./node_modules/.bin/eslint .` | 0 error / 2 warning（`@next/next/no-img-element` 类；调色板规则 0 命中） |
| `node scripts/ui-copy/check.mjs`（文案禁词，未跟踪的 WIP 脚本） | 0 处未豁免命中，2 条豁免 |
| `tests/visual/ui-gates.ts` | 移动端 44px 触控、根横向溢出、axe `wcag2a/2aa/21a/21aa`；6 视口 × 明暗 |

---

## 1. 令牌现状

### 1.1 定义处与引用率

唯一主题文件是 `app/globals.css`（Tailwind v4，无 `tailwind.config.*`）：`@theme inline`（L6-69）51 个别名，`:root`（L71-128）44 个值，`.dark`（L130-176）覆盖其中 41 个。另有 4 个 CSS Module 在 `components/business/order/`。

语义色引用（utility 类 + `var()`，合并 `--X` 与 `--color-X`）：

| 令牌 | 引用 | 主要写法 | 证据 |
|---|---:|---|---|
| `muted-foreground` | 993 | `text-muted-foreground` 985 | `app/(admin)/foreman/attendance/page.tsx:152` |
| `destructive` | 391 | `text-destructive` 248、`border-destructive/40` 25、`bg-destructive/5` 23 | `app/(admin)/foreman/attendance/page.tsx:118` |
| `card` | 292 | `bg-card` 286 | `app/(admin)/foreman/attendance/page.tsx:149` |
| `foreground` | 212 | `text-foreground` 87、`bg-foreground` 35、`border-foreground` 30 | `app/(admin)/foreman/cdr/page.tsx:72` |
| `muted` | 207 | `bg-muted` 64、`bg-muted/40` 58、`/20` 28、`/30` 26 | `app/(admin)/foreman/attendance/page.tsx:176` |
| `background` | 175 | `bg-background` 105、`text-background` 38 | 同上 |
| `ring` | 121 | `ring-ring` 41、`ring-ring/50` 41、`border-ring` 34 | `app/(admin)/foreman/cdr/page.tsx:172` |
| `warning` | 112 | `bg-warning/10` 44、`border-warning/40` 32、`/50` 12 | `app/(admin)/orders/[id]/page.tsx:841` |
| `primary` | 91 | `text-primary` 46、`bg-primary` 15 | `app/(admin)/foreman/materials/page.tsx:192` |
| `warning-foreground` / `success-foreground` | 57 / 40 | `text-*-foreground` | `app/(admin)/owner/salary/cs/[id]/page.tsx:230` |
| `success` | 33 | `bg-success/10` 12、`border-success/40` 10 | `components/business/agent-monthly-billing/AgentMonthlyBillForms.tsx:17` |
| `info` / `info-foreground` | 12 / 3 | `text-info` 3、`bg-info/10` 3 | `components/business/price/ExternalSalesPriceBookVersionPanel.tsx:265` |
| `info-neutral` / `-foreground` | 1 / 1 | 仅 `components/ui-business/EnvNotice.tsx:15` | |
| `chart-1…7` | 0 utility / 12 `var()` | 仅 Recharts 内联 | `components/business/dashboard/CategoryDistributionChart.tsx:26-34` |

前 9 项占全部语义色 utility 引用约 86%。

**定义了但没人用**（不算令牌）：`--color-chart-1…7` 的 7 个 `@theme` 别名（`bg-chart-N` 0 次）、`--sidebar-primary-foreground`（0）、`--radius-3xl`（0）、`--admin-scroll-padding-top`（仅 globals 内部）。`--accent`、`--font-heading`、`--sidebar-*`（除 accent）业务层 0 次，只被 `components/ui/` 原子件消费。

**局部覆盖全局令牌**（漂移点）：

| 位置 | 内容 |
|---|---|
| `components/business/order/AdminOrderWorkspace.module.css:3-27` | 用 hex 重定义 10 个令牌（`--background/--foreground/--card/--card-foreground/--border/--muted/--muted-foreground/--primary/--primary-foreground/--success-foreground`），明暗各一套共 20 处；`--muted-foreground: #716e68`（`:10`）与原型 `--mute #77746e` 不同值 |
| `components/business/order/AdminOrderDetailView.module.css:137` | `.decision { --primary: var(--foreground) }` 把主色反转成黑白 |
| `components/business/order/AdminOrderDetailView.module.css:146-151` | 按 `class~='bg-primary'` 选择器覆盖按钮配色 |

结果：同一 ADMIN 壳内并存两套底色（全局 `--background: oklch(1 0 0)` 纯白，`app/globals.css:80`；工单列表页 `#faf9f7` 米白，`components/business/order/AdminOrderWorkspace.module.css:4`）。

### 1.2 原始颜色字面量

81 处，全部在 `components/business/`（`app/`、`ui/`、`ui-business/` 均 0）：

| 位置 | 次数 | 性质 |
|---|---:|---|
| `components/business/order/order-form-b/OrderPaperSwatchPicker.tsx:41-67` | 31 | 纸张实物色卡数据 |
| `components/business/order/order-form-b/OrderFoilSwatchPicker.tsx:48-75` | 28 | 烫金/烫银实物色卡数据 |
| `components/business/order/AdminOrderWorkspace.module.css:4-26` | 20 | 页面局部主题覆盖（§1.1） |
| `components/business/order/AutoPrint.tsx:210` | 2 | 打印视图内联 `#fff` / `#a8121a` |

Tailwind 调色板字面量（`bg-amber-50` 类）：**0**；任意色类（`bg-[#…]`）：**0**。门禁 `eslint.config.mjs:37-56`（`no-restricted-syntax`，范围 `:30-34`，`components/ui/` 豁免 `:10-11`）生效，无针对该规则的 `eslint-disable`。门禁**不覆盖** CSS 文件与 TS 对象字面量里的 hex，上表 81 处因此全部漏网。

### 1.3 字号与字重

Tailwind 字号 2,009 次：

| 类 | px | 次数 | 占比 |
|---|---|---:|---:|
| `text-xs` | 12 | 903 | 45.0% |
| `text-sm` | 14 | 762 | 37.9% |
| `text-base` | 16 | 118 | 5.9% |
| `text-lg` / `xl` / `2xl` / `3xl` | 18/20/24/30 | 34 / 30 / 10 / 3 | 3.8% |
| 任意值 `text-[…]` | — | 149 | 7.4% |

任意字号 149 处、19 种写法，146 处在 `components/business/`。按等效像素归并：11px **61**（`text-[11px]` 49 + `text-[0.6875rem]` 12）、13px **30**、10px **29**、10.5px 8、9px 6、11.5px 3、12.5/13.5/21/34px 各 2、15/12.8px 各 1。同一像素并存 px/rem 双写法。集中文件：`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx`（`:202,257,395,520,978,1000…`）、`AdminOrderWorkspace.tsx:101,142,416,437`、`ExternalSalesOrderFormRail.tsx:187,216,395,494`、`AdminOrderProgress.tsx:20,53,57,61`、`app/(admin)/owner/rules/page.tsx:109,113`、`components/business/price/RulePriceWorkbench.tsx:485,589`。

CSS Module 另有 `font-size` 41 处（`components/business/order/AdminOrderDetailView.module.css`：12px 15、11px 9、10px 4、17px 4、13px 3、15px 3、16/22px 各 1）。

字重：`font-semibold` 382（45%）、`font-medium` 362（42%）、`font-bold` 51、`font-extrabold` 44、`font-normal` 13、`font-black` 2。

### 1.4 间距

4,712 次。按数值归并：

| 值 | px | 次数 | 占比 |
|---|---|---:|---:|
| 3 | 12 | 1,328 | 28.2% |
| 2 | 8 | 1,191 | 25.3% |
| 4 | 16 | 845 | 17.9% |
| 1 | 4 | 603 | 12.8% |
| 6 | 24 | 213 | 4.5% |
| 1.5 / 5 / 0.5 / 0 / 2.5 / 3.5 / 8 | | 115 / 113 / 74 / 68 / 54 / 29 / 20 | 10.0% |
| 7 / 9 / 10 / 12 / 14 | | 23 合计 | 0.5% |
| 任意值 | | 33 | 0.7% |

四档（1/2/3/4）占 84%。任意间距 33 处：safe-area `env()` 表达式 19（`SalesOrdersList.tsx:543,568,715`、`OrderListFilters.tsx:517`、`components/business/order/AdminOrderEditor.tsx:1116`，globals.css L212-306 已有 `.admin-safe-*` / `.worker-safe-*` 同义类）、`[1.125rem]` 8（`OrderForm.tsx:3498,3604`）、`p-[18px]` 4（`ExternalSalesOrderFormRail.tsx:168,257,368,369`）、`py-[11px]` 2。另有 `min/max-w-[Npx]` 表格宽 62 处、`min-[Npx]:` 自定义断点 40 处（960px 14、560px 13、360px 8）。

### 1.5 圆角

`--radius: 0.625rem` → sm 6 / md 8 / lg 10 / xl 14 / 2xl 18 / 3xl 22 / 4xl 26px。793 次：

| 类 | px | 次数 | 占比 |
|---|---|---:|---:|
| `rounded-xl` | 14 | 292 | 36.8% |
| `rounded-md` | 8 | 187 | 23.6% |
| `rounded-lg` | 10 | 176 | 22.2% |
| `rounded-full` | ∞ | 76 | 9.6% |
| 裸 `rounded`（固定 4px，脱离 `--radius`） | 4 | 25 | 3.2% |
| `rounded-[14px]`（= xl，冗余） | 14 | 16 | 2.0% |
| `rounded-[9px]` / `rounded-sm` / `rounded-2xl` | | 4 / 4 / 4 | 1.5% |
| 其余 7 种 | | 各 1–4 | |

任意圆角 27 处：`rounded-[14px]` ×16（`ExternalSalesOrderFormRail.tsx:168,257,368,369`、`rules/pricing/CustomerPricingSectionViews.tsx:400,547,586,663,817,824,860,1042,1063,1155,1178`、`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx:1057`）、`rounded-[9px]` ×4（`ExternalSalesOrderFormB.tsx:1000,1019,1028,1039`）、`rounded-[10px]` ×1、`components/ui/` 内 6 处。CSS Module 20 处 `border-radius` 中只有 1 处走令牌（`components/business/order/AdminOrderEditor.module.css:5`）。

### 1.6 阴影与字体

阴影 287 次：`shadow-sm` 226（79%）、`shadow-xs` 26、`shadow-none` 16、`shadow-lg` 6、任意 box-shadow 10（5 种写法，均引用 `var(--border/--foreground/--sidebar-*)`，如 `OrdersTable.tsx:181,197`）。

字体：`font-sans` 310 次（body 已全局 `@apply font-sans`，`app/globals.css:185`，基本冗余）；`font-mono` 39；`font-heading` 仅 `components/ui/` 5 处。

### 1.7 原型令牌对照（四份原型）

`docs/工单列表-管理端.html:8-9`、`~/Downloads/工单详情-管理端.html:8-9`、`~/Downloads/编辑工单-管理端.html:8-9` 三份 `:root` **完全一致**；`工单详情-管理端 v2.dc.html` 无 `:root`，内联同一调色板。

| 原型变量 | 值 | 仓库对应（`components/business/order/AdminOrderWorkspace.module.css:3-14`） | 全局 `app/globals.css` |
|---|---|---|---|
| `--ink` | `#17181c` | `--foreground #17181c` ✅ | `oklch(0.145 0 0)` |
| `--mute` | `#77746e` | `--muted-foreground #716e68` ❌ | `oklch(0.5 0 0)` |
| `--paper` | `#faf9f7` | `--background #faf9f7` ✅ | `oklch(1 0 0)` 纯白 |
| `--card` | `#fff` | ✅ | ✅ |
| `--rule` / `--rule-2` | `#e4e1dc` / `#f0eeea` | `--border` / `--muted` ✅ | 灰阶 oklch |
| `--seal` | `#a8121a` | `--primary #a8121a` ✅ | `oklch(0.51 0.2 25)`（近似非同值） |
| `--seal-bg` | `#fdf3f3` | 无 | 无（`bg-primary/10` 可推出） |
| `--ok` | `#2f6b46` | `--success-foreground` ✅ | `oklch(0.28 0.07 152)` |
| `--gold` / `--gold-bg` | `#c9a227` / `#fdf6e3` | 无 | 无 |

原型字号以半像素为主：12.5px ×53、13px ×44、12px ×37、10px ×30、11px ×24、11.5px ×22、10.5px ×15；字重 800 ×116、700 ×81。原型圆角散布 12 档（99px 35、9px 26、14px 13、8px 12、12px 12、4px 8…）。→ 仓库任意字号（11/13/10/10.5px）与任意圆角（9/14px）是从原型直接搬入的。

### 1.8 事实令牌 vs 漂移（小结）

| 维度 | 事实令牌（≥5% 份额） | 漂移 |
|---|---|---|
| 语义色 | 前 9 个 token 占 86%；调色板字面量 0 | CSS Module hex 覆盖 20；打印内联 2；`info`/`info-neutral` 几乎无人用；`chart-*` 别名 0 |
| 字号 | `xs`/`sm`/`base` 三档 89% | 任意值 149（19 种写法）+ CSS Module 41 |
| 字重 | `semibold`/`medium` 87% | 原型以 800/700 为主，方向不一致 |
| 间距 | 1/2/3/4 四档 84% | 任意 33 + 表格宽 62 + 自定义断点 40 |
| 圆角 | `xl`/`md`/`lg`/`full` 92% | 裸 `rounded` 25、`[14px]` 16、`[9px]` 4 |
| 阴影 | `shadow-sm` 79% | 任意 box-shadow 10 |

---

## 2. 组件清单

### 2.1 共享组件与引用率

`components/ui/`（引用文件数 = app + business）：Button 155、Input 57、Badge 38、Label 32、Disclosure 23、Checkbox 18、Table 13、Dialog 7、Textarea 6、Card **5**、Sheet 4、DropdownMenu 3、Sidebar 3、Skeleton 3、AlertDialog 1（仅 ConfirmActionDialog）、Alert 1、Avatar 1、Breadcrumb 1、**Progress 0、Tooltip 0**。子件级 0 引用 20 余项（CardFooter/Title/Description、DialogOverlay、TableFooter/Caption、`badgeVariants`、`alertVariants` 等）。

`components/ui-business/`（barrel 被 157 文件引用）：ActionNotice 49、StatusBadge 40、PageHeader 39、ConfirmActionController/Dialog 30、EmptyState 25、FormErrorSummary 15、PendingButton 14、TableEmptyState 13、FormMessage 12、StatCard 11、DisabledReason 10、ErrorBoundary 10、TableScrollArea 9、SlowLoadingHint 8、ContentSkeleton 6、ErrorState 5、PendingLink 5、EnvNotice 4、BatchActionResult 4、LongTaskReceipt 2、其余 1。**0 引用导出**：`confirmationCanSubmit`、`formMessageId`、`remainingHoursLabel`、`focusFormErrorSummary`（未进 barrel）、`components/ui-business/empty-state-copy.ts` 全部 8 个导出。

deep import 违规 3 处：`components/business/order/AdminOrderDecisionPanel.tsx:24-25`、`components/business/rules/pricing/CustomerPricingSectionViews.tsx:16`。

**没有共享 Select / NativeSelect**（`components/ui/` 无对应文件）。

### 2.2 同一职责的近似重复

| 职责 | 共享实现 | 私有实现 | 差异点 |
|---|---|---|---|
| 状态徽章 | `ui-business/StatusBadge.tsx:20`（h-6 rounded-full，六档 Tone）+ `lib/ui/status-registry.ts:51-435`（19 个 registry） | 本地 `*Badge/*Pill` **29 个**；shadcn `Badge`（h-5 rounded-4xl）直接使用 103 处 / 38 文件 | 逐字重复对 4 组：`sales/bills/page.tsx:172` = `sales/bills/[id]/page.tsx:361`；`orders/[id]/page.tsx:2070` = `owner/order-changes/page.tsx:225`；`owner/salary/daily/page.tsx:210` = `worker/salary/page.tsx:460`；`components/business/order/SalesOrdersList.tsx:493` = `components/business/order/SalesOrderDetailView.tsx:523`（后者自带第二套 5 档 tone，`lib/order/sales-list-presentation.ts:31`）。`components/business/order/AdminWorkspaceStatusBadge.tsx:16` 自带 `STATUS_LABELS` 与 registry 并存。手写 `rounded-full` pill 15 处 / 11 文件（`components/business/rules/catalog/RuleSpecWorkspace.tsx:86` = `components/business/rules/catalog/RulePaperWorkspace.tsx:86`） |
| Pending 按钮 | `ui-business/PendingButton.tsx:22`（aria-busy + beforeunload 拦截）16 处 / 14 文件 | `<Button disabled={pending}>` 54 处 / 33 文件 | 私有版无导航拦截，pendingLabel 各自三元（`components/business/order/SubmitOrderButton.tsx:34-40`） |
| 卡面 | `ui/card.tsx:5 Card` 22 处 / 5 文件 | `rounded-(lg\|xl\|2xl) border bg-card` 手写 **284 处 / 112 文件**（`rounded-xl border bg-card` 精确串 234） | padding p-3/p-4/p-5 不统一，无 `data-slot`；最重 `orders/[id]/page.tsx` 14、`worker/tasks/[id]/page.tsx` 10、`owner/warehouses/page.tsx` 10 |
| select | `NativeSelect`（2026-09-29 起） | 原生 `<select` 与本地 `selectClass` 已清零，eslint 禁止复发（2026-09-29 盘点前为 68 处 / 39 文件、8 份常量） | 统一 `components/ui/field-styles.ts`：rounded-md、px-3、ring-3、aria-invalid、只读态 |
| textarea / input | `Textarea` 15 处 / 5 文件；`Input` 174 处 / 57 文件 | 原生 `<textarea` 17 处 / 15 文件；可见原生 `<input` 30 处 / 19 文件（`components/business/order/ShipOrderFields.tsx` 5） | |
| 复制反馈 | 无 | `navigator.clipboard` 4 处，4 种反馈：`components/business/order/OrderListBatchSelection.tsx:218`、`components/business/order/SalesOrdersList.tsx:154`（sr-only live region）、`components/business/order/AdminOrderDetailView.tsx:122`（ActionNotice）、`components/business/notification/SmartBotBindingPanel.tsx:54`（`<p role="status">` 无 aria-live） | |
| 金额格式化 | `lib/dashboard/format.ts:18 formatMoney` → `¥ 1,234.56`（25 文件）；`lib/format/unit-price.ts:4`（3 文件） | 同名异义 `lib/order/sales-list-presentation.ts:98 formatMoney` → `1,234.56`（2 文件）；UI 私有 money 函数 **14 个**（`components/business/order/AdminOrderDecisionPanel.tsx:946` = `components/business/order/AdminOrderWorkspace.tsx:489` = `components/business/order/AdminOrderWorkspaceList.tsx:428`；`components/business/order/OrderForm.tsx:627` = `components/business/order/ExternalSalesOrderFormRail.tsx:61`；`components/business/order/SubmitOrderButton.tsx:8`、`components/business/order/AdminOrderEditor.tsx:132`、`components/business/order/OrderChangeReviewForm.tsx:107`、`CsPayrollPaymentForm.tsx:44`、`foreman/materials/page.tsx:36`…）；UI 层 `.toFixed(` 68 处 / 28 文件（`owner/salary/cs/[id]/page.tsx` 13）；`Intl.NumberFormat` 9 处 | 输出并存 `¥ 1,234.56` / `¥1,234.56` / `1234.56` / `¥${raw}`；含 `¥` 的行 139 / 52 文件，空格有无不一 |
| 日期格式化 | `lib/format/dates.ts` 四函数：`formatDateTimeShanghai` 101 次、`formatDateShanghai` 62、`formatDateInputShanghai` **3（1 文件）** | `toISOString().slice(0,10)` 14 处 / 9 文件（UTC 切片，非上海：`components/business/account/AccountForm.tsx:330-342`、`orders/[id]/page.tsx:706,1262,1756`、`orders/[id]/edit/page.tsx:189,364,404`、`foreman/attendance/page.tsx:86`…）；逐字重写 3 处（`components/business/rules/salary/EmployeePayRulesPage.tsx:9`、`components/business/price/ExternalSalesPriceBookVersionPanel.tsx:65`、`components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:511`） | 跨日边界时区不一致 |
| 空态 | `EmptyState` 26 文件 / `TableEmptyState` 14 文件 | 内联「暂无…」文本节点 24 处 + 字符串字面量 47 处 / 43 文件；`EmptyRow` 本地封装 2 个（`warehouses/page.tsx:352`、`components/business/material/InventoryCountClient.tsx:412`） | 见 §3.5 |
| 错误态 | `ErrorState` 5 文件、`ErrorBoundary` 10 文件、5 个 admin `error.tsx` → `components/business/admin/AdminRouteError.tsx:15` | `app/(worker)/worker/error.tsx:13`、`owner/pigsty/page.tsx:78 ErrorPanel` 手写；手写 destructive 块 4 处 | 无 retry 契约 |
| 通知块 | `ActionNotice` 99 处 / 49 文件 | 手写 `border-warning/N bg-warning/10` 块 27 文件（`components/business/order/SubmitOrderButton.tsx:44`、`OrderListFilters.tsx:311`） | role=status/alert 不统一 |
| 加载 | `ContentSkeleton` 6 文件；5 个 admin `loading.tsx` → `AdminRouteLoading` | 手写 `animate-pulse` 11 处 / 7 文件；同构私有 Loading 5 个（`foreman/cdr/page.tsx:269`、`components/business/dashboard/DashboardSectionLoading.tsx:3`、`components/business/dashboard/OwnerAnalytics.tsx:79`、`worker/loading.tsx:8`、`components/business/rules/pricing/CustomerPricingLoading.tsx:3`） | 仅高度不同 |

---

## 3. 模式现状

### 3.1 列表

四族并存：

| 族 | 实现 | 数量 | 代表 |
|---|---|---|---|
| A | `AdminDataTable` 套件（Toolbar/SortLink/Pagination/TableCard）+ `ui/table` | 5 页 + 5 规则中心组件 | `owner/accounts`、`owner/parties`、`owner/purchases`、`owner/boms`、`owner/order-changes` |
| B | 裸 `<table>`（± `TableScrollArea`） | 22 个 page.tsx | `owner/agent-bills`、`sales/bills`、`foreman/outsource`、`owner/salary/*`、`owner/notifications`、`owner/pigsty` |
| C | `<ul>` 卡片列表 | worker 4 页 + `components/business/order/AdminOrderWorkspaceList.tsx:112`、`components/business/order/SalesOrdersList.tsx:164` | |
| D | Table + 移动端卡片双形态 | 2 | `OrdersTable.tsx:110/177`、`AccountsTable` |

- 分页：`AdminPagination`（`components/business/admin/AdminDataTable.tsx:149`）14 处；手写 3 处（`owner/agent-bills/page.tsx:248-268`、`owner/notifications/page.tsx:226-245`、`components/business/price/RulePriceWorkbench.tsx:905-947`），格式与按钮尺寸各异。
- 筛选：`AdminListToolbar` 5；无 action 的 GET `<form>` 8；`<form action="/path">` 5；订单专用筛选 UI 3 种。
- 横滚：`ui/table` 自带 region（13 文件）；裸表 + `TableScrollArea` 7 页 + 2 组件；**两者都没有**：`foreman/materials/page.tsx:96`、`owner/pigsty`、`owner/salary/*`、`owner/background-jobs`、`owner/notifications`。
- 查询参数：`lib/admin/table.ts` 26 个引用方；订单列表走自家 `lib/order/list-query.ts`。

### 3.2 表单提交

107 个 `<form>`：

| 类别 | 数量 |
|---|---:|
| `action={formAction}` 直连（含 4 个 `action={string}` 搜索） | 71 |
| ↳ 其中 `useActionState` 传入客户端闭包（渐进增强归零） | 7（`components/business/order/FinishOrderButton.tsx:19`、`components/business/order/ShipOrderForm.tsx:109`、`components/business/bill/IssueBillButton.tsx:29`、`craft/ToggleActiveButton.tsx:22`、`product/ToggleActiveButton.tsx:23`、`components/business/price/ExternalSalesPriceTierGroupEditor.tsx:537`、`account/ToggleActiveButton.tsx:21`） |
| `action={(fd) => …}` 箭头包裹 | 7（`components/business/bill/GenerateBillsForm.tsx:22`、`components/business/bill/IssueBillButton.tsx:37`、`components/business/order/OrderCancellationRequestForm.tsx:59`、`components/business/order/SfCollectToggleForm.tsx:61`、`OutsourceActions.tsx:81,135`、`StartCsPeriodForm.tsx:33`） |
| `onSubmit` 无 action | 2（`components/business/order/FulfillmentPricingReviewForm.tsx:165`、`components/business/material/InventoryCountClient.tsx:318`） |
| `action` + `onSubmit={handleSubmit}` 混合 | 12（真 react-hook-form 仅 `components/business/order/OrderForm.tsx:3303`） |
| GET 导航 | 13 |

Hook：`useActionState` 92 / `useTransition` 34 / `useFormState` 0 / `useFormStatus` 0。箭头 + 闭包合计 14，与 CLAUDE.md §15.8「约 15 处」一致。

### 3.3 确认

- `ConfirmActionDialog`（`ui-business/ConfirmActionDialog.tsx`，`level: 'L2' | 'L3'`，无 L1；L3 强制理由 `:66-70,87`）：47 处 / 30 文件，L2 37、L3 8、动态 2。
- `window.confirm`/`alert`：0（eslint 守门）；二次点击确认：0；`<details>` 确认：0；`AlertDialog` 业务直用：0。
- 绕过 ConfirmActionDialog 的确认层 2 处：`components/business/order/AdminOrderEditor.tsx:1184`（Dialog「放弃未保存的修改？」）、`components/business/order/AdminOrderEditor.tsx:1042`（Sheet「确认保存修改」）。

### 3.4 操作反馈（toast）

无 toast 库（`package.json` 无 sonner / react-hot-toast）。同一件事五种落地：

| 形态 | 命中 | 文件数 |
|---|---:|---:|
| `<ActionNotice tone>` | 99 | 49 |
| 手写 `role="status"` | 65 | 42 |
| 手写 `role="alert"` | 110 | 60 |
| `<p className="… text-destructive">` | 133 | 57 |
| `router.refresh()` 后配消息 | 45 | 23（`components/business/price/ExternalSalesPriceBookDraftForms.tsx` 10） |

### 3.5 空态

`EmptyState` 26 文件、`TableEmptyState` 14 文件、内联约 70 行 / 40 文件。措辞漂移：

| 族 | 例 |
|---|---|
| 「暂无X。」 | `foreman/outsource/page.tsx:35`、`owner/salary/cs/[id]/page.tsx:241`、`orders/[id]/page.tsx:1848` |
| 「暂无X」 | `owner/warehouses/page.tsx:159,195,213,242,264`、三张图表 `components/business/dashboard/SalesRankingChart.tsx:53` / `components/business/dashboard/CategoryDistributionChart.tsx:54` / `components/business/dashboard/ProductionTrendChart.tsx:117` |
| 「没有匹配…记录」 | `foreman/materials/page.tsx:203`、`components/business/rules/catalog/ProductCatalogPages.tsx:200` |
| 「还没有X」（`components/ui-business/empty-state-copy.ts:7` 官方工厂） | 业务 0 调用 |
| 「暂无」误用于非空态 | `CsPeriodForecast.tsx:47,53`「暂无法预测」、`components/business/order/OrderChangeReviewForm.tsx:309`「暂无法计算」 |

`AdminTableCard.tsx:77` 默认「暂无数据」与 `components/ui-business/empty-state-copy.ts` 「还没有X」两套官方措辞并存。

### 3.6 错误态

- 路由级：5 个 admin `error.tsx` 统一 `AdminRouteError`；`app/(worker)/worker/error.tsx:14` 与 `app/global-error.tsx` 手写 `role="alert"`。
- 字段级：主数据 CRUD（account/material/product/party/warehouse）统一 `FormErrorSummary`（15）+ `FormMessage`（38）；订单/通知/登录/薪资一线表单仍是 `fieldErrors?.x` + `text-destructive`：12 文件 / 50 处（`components/business/order/order-form-b/ExternalSalesOrderFormB.tsx` 15、`components/business/notification/ChannelForm.tsx` 9、`components/business/auth/LoginForm.tsx` 8）。

### 3.7 Pending / Disabled

`PendingButton` 15 / `PendingLink` 10；裸 `disabled={pending}` 按钮 55 / 35 文件；`DisabledReason` 仅 10 处（`cause: permission|status|prerequisite`，`components/ui-business/DisabledReason.tsx:5`）；`title=` 作唯一原因 0。无原因的 disabled 例：`components/business/order/AdminOrderEditor.tsx:591`。

### 3.8 抽屉

5 个业务 `<Sheet>`，2 个承载写操作：`components/business/order/AdminOrderEditor.tsx:1029-1131`（`:1096-1101` 保存按钮 → `saveAdminOrderEditAction`）、`components/business/order/OrderExportControls.tsx:105-238`（`:160,167` 内嵌 `<form action={formAction}>` 触发导出）。其余 3 个只读（`OrderListFilters.tsx:236`、`SalesOrdersList.tsx:539,768`）。

---

## 4. 文案现状

由《呈现规范修复任务》审计，引用其结论（`docs/archive/REPORT-呈现修复.md`，基线 `d742fd0`）：

- 第 0 批已把文案十律、业务词映射与反例写入 `docs/ui-规范.md`「文案与确认」章（提交 `3acbf7b`）。
- 第一批已把 44 个 `ConfirmActionDialog` 调用点从 `title/description/impactItems/confirmLabel` 迁到 `action/changes/consequences/confirmText`（提交 `293c1c8`）。
- 禁词检查器 `scripts/ui-copy/check.mjs` + `scripts/ui-copy/policy.json`（22 个禁词、2 条豁免）已挂进 `pnpm lint`（`package.json:13`），工作树实测 0 处未豁免命中；该报告自述「尚未接入 CI，不宣称门禁生效」。脚本目录目前**未跟踪**（`?? scripts/ui-copy/`），属该任务的 WIP。
- 第二至四批（工单与计价、账单/工资/通知、价格阶梯）待完成。

本任务不重扫文案。

---

## 5. 可访问性抽样

| 项 | 现状 | 证据 |
|---|---|---|
| 焦点样式 | `focus-visible:` 99 处；业务层裸 `outline-none` 0（4 处在 `components/ui/` Base UI 容器） | `ui/button.tsx:7` `ring-3 ring-ring`；`ui/input.tsx:12` `ring-3 ring-ring/50`；`ui/table.tsx:30` `ring-2`（三处不一致） |
| 键盘关闭 | 业务层无自定义浮层（`fixed inset-0` / `role="dialog"` 0），Dialog/Sheet/AlertDialog 全部走 Base UI | 显式 Escape 仅 `ConfirmActionDialog.tsx:75,96`、`ThemeToggle.tsx:63,69`、`components/business/material/InventoryCountClient.tsx:276` |
| 触控目标 | `h-11` 229、`min-h-11` 218、`size-11` 10；globals.css L318-323 对三类 viewport 内控件兜底 `min-height: 2.75rem` | 师傅端表面小控件 0（唯一 `h-7` 是 `worker/loading.tsx:7` 骨架条） |
| 图标按钮 | `size="icon*"` 11 处全部有 `aria-label` | `components/business/order/SalesOrdersList.tsx:555`、`components/business/order/OrderExportControls.tsx:145` |
| 复制播报 | 4 处中 2 处无 `aria-live`（§2.2） | |
| 门禁常量 | 移动端（≤768）`< 44` 即失败 `tests/visual/ui-gates.ts:154-166`；checkbox 44（紧凑桌面 24）`:119-149`；axe 4 标签 `:176`；6 视口 × 明暗 `playwright.config.ts:85-99` | |

---

## 6. 盘点结论（供第二段对账）

1. **颜色层已基本令牌化**：调色板字面量 0、任意色类 0。残余漂移集中在一个 CSS Module（20 处 hex）、打印内联 2 处、色卡数据 59 处（物料真实颜色）。门禁盲区是 CSS 文件与对象字面量。
2. **字号 / 圆角 / 字重是从原型直接搬入的漂移**：任意字号 149 处、任意圆角 27 处几乎全部落在 `components/business/order/` 与 `rules/pricing/`，来源是原型的半像素字号（12.5/11.5/10.5）与 9/14px 圆角、800 字重。
3. **组件层最大缺口三处**：卡面（手写 284 vs Card 22）、select（68 处无共享组件、8 份样式常量）、Pending 按钮（55 裸 vs 16 共享）。
4. **语义分叉**：两个同名 `formatMoney` 输出不同；14 个页面级 money 函数；`Badge` 与 `StatusBadge` 两套尺寸；销售列表第二套 tone。
5. **模式层已收敛的**：确认层（单一实现 + 2 处离开保护例外）、对话框（0 原生）、日期（163 处走 Shanghai helper）。
6. **模式层未收敛的**：列表四族、分页 1+3、筛选 4 种、反馈 5 种、空态措辞 4 族、字段错误 2 种。
7. **原则性违例**（与「明细抽屉只读」等既定规则冲突）：2 个 Sheet 承载写操作；2 处确认层绕过 `ConfirmActionDialog`。
