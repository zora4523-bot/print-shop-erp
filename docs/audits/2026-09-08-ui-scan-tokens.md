# 设计令牌盘点（只读扫描）— print-shop-erp

- 扫描日期：2026-09-08，分支 `codex/qiyeweixintongzhi`（含工作区未提交改动）
- 扫描范围：`app/**` + `components/**` 的 `.ts/.tsx/.css`，排除 `__tests__/`、`*.test.*`、`*.spec.*`、`generated/`、`node_modules/`、`tests/`、`docs/`
- 文件数：**411**（`app/` 147、`components/ui/` 21、`components/ui-business/` 27、`components/business/` 216），共 76,470 行
- 主题文件：仅 `app/globals.css`（Tailwind v4，无 `tailwind.config.*`；`@theme` 只出现在 globals.css）。另有 4 个 CSS Module：`components/business/order/{AdminOrderWorkspace,AdminOrderEditor,AdminOrderInlineOperations,AdminOrderDetailView}.module.css`
- 计数方法：Python `re` 逐行扫描（BSD grep 无 `-P`，已用 rg/python 校验）；脚本与原始 JSON 见同目录 `scan.py` / `scan.json`。所有计数为**出现次数**（同一行多次命中计多次），不去重。
- 下文 "utility 引用" 指匹配 `(bg|text|border|border-[trblxyse]|ring|ring-offset|fill|stroke|from|to|via|outline|divide|shadow|placeholder|decoration|accent|caret|inset-ring)-<name>(/alpha)?` 的 Tailwind 类，含 `hover:`/`data-[...]:` 等变体前缀。

---

## 1. CSS 变量定义与引用

### 1.1 定义清单

`app/globals.css` 共定义 **95 个唯一 `--token`**：`@theme inline`（L6-69）51 个（41 个 `--color-*` + 3 个 `--font-*` + 7 个 `--radius-*`），`:root`（L71-128）44 个；`.dark`（L130-176）只覆盖 `:root` 已有的 41 个，不新增。

设计模式：`--color-X: var(--X)`（@theme 别名）→ Tailwind 生成 `bg-X / text-X …`；业务代码引用 utility 类，`var(--X)` 直接引用主要出现在 Recharts 与 CSS Module。因此下表把 `--X` 与 `--color-X` 合并为一行统计。

### 1.2 语义色令牌（`--X` + `--color-X` 合并）

| 令牌 | utility 引用 | ui | ui-business | business | app | `var()` 直引 | 高频写法 | 证据 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| muted-foreground | **993** | 16 | 32 | 608 | 337 | 28 | `text-muted-foreground` 985 | `app/(admin)/foreman/attendance/page.tsx:152`；var: `components/business/dashboard/CategoryDistributionChart.tsx:62` |
| destructive | **391** | 38 | 21 | 313 | 19 | 0 | `text-destructive` 248、`border-destructive/40` 25、`bg-destructive/5` 23、`border-destructive` 23 | `app/(admin)/foreman/attendance/page.tsx:118` |
| card | **292** | 2 | 4 | 115 | 171 | 11 | `bg-card` 286、`bg-card/95` 2 | `app/(admin)/foreman/attendance/page.tsx:149`；var: `AdminOrderDetailView.module.css:16` |
| foreground | **212** | 45 | 10 | 139 | 18 | 14 | `text-foreground` 87、`bg-foreground` 35、`accent-foreground` 34、`border-foreground` 30 | `app/(admin)/foreman/cdr/page.tsx:72` |
| muted | **207** | 18 | 9 | 118 | 62 | 3 | `bg-muted` 64、`bg-muted/40` 58、`bg-muted/20` 28、`bg-muted/30` 26 | `app/(admin)/foreman/attendance/page.tsx:176` |
| background | **175** | 9 | 2 | 139 | 25 | 5 | `bg-background` 105、`text-background` 38、`ring-background` 5 | `app/(admin)/foreman/attendance/page.tsx:176` |
| ring | **121** | 18 | 3 | 75 | 25 | 1 | `ring-ring` 41、`ring-ring/50` 41、`border-ring` 34、`outline-ring` 5 | `app/(admin)/foreman/cdr/page.tsx:172` |
| warning | **112** | 2 | 14 | 76 | 20 | 6 | `bg-warning/10` 44、`border-warning/40` 32、`border-warning/50` 12、`bg-warning/5` 6 | `app/(admin)/orders/[id]/page.tsx:841`；var: `AdminOrderDetailView.module.css:30` |
| primary | **91** | 15 | 12 | 42 | 22 | 2 | `text-primary` 46、`bg-primary` 15、`decoration-primary` 5、`border-primary` 5 | `app/(admin)/foreman/materials/page.tsx:192` |
| warning-foreground | 57 | 1 | 6 | 42 | 8 | 0 | `text-warning-foreground` 57 | `app/(admin)/orders/[id]/page.tsx:841` |
| input | 49 | 13 | 0 | 35 | 1 | 0 | `border-input` 38、`bg-input/30` 6 | `app/(admin)/owner/parties/page.tsx:107` |
| success-foreground | 40 | 1 | 4 | 33 | 2 | 0 | `text-success-foreground` 40 | `app/(admin)/owner/salary/cs/[id]/page.tsx:230` |
| success | 33 | 2 | 10 | 21 | 0 | 0 | `bg-success/10` 12、`border-success/40` 10、`text-success` 5 | `components/business/agent-monthly-billing/AgentMonthlyBillForms.tsx:17` |
| border | 28 | 5 | 4 | 15 | 4 | 27 | `border-border` 22、`bg-border` 4 | `app/(admin)/orders/[id]/page.tsx:634`；var: `CategoryDistributionChart.tsx:97` |
| sidebar-accent-foreground | 23 | 16 | 0 | 7 | 0 | 0 | `text-sidebar-accent-foreground` 23 | `components/business/admin/AppSidebar.tsx:225` |
| card-foreground | 18 | 2 | 0 | 16 | 0 | 0 | `text-card-foreground` 6、`text-card-foreground/55` 2 | `components/business/order/order-form-b/OrderSubmissionReviewDialog.tsx:125` |
| sidebar-accent | 17 | 11 | 0 | 6 | 0 | 1 | `bg-sidebar-accent` 15 | `components/business/admin/AppSidebar.tsx:225` |
| info | 12 | 2 | 7 | 3 | 0 | 0 | `text-info` 3、`bg-info/10` 3、`border-info/30` 2、`border-info/40` 2 | `components/business/price/ExternalSalesPriceBookVersionPanel.tsx:265` |
| sidebar-foreground | 12 | 8 | 0 | 4 | 0 | 0 | `text-sidebar-foreground` 7、`/70` 4 | `components/business/admin/AppSidebar.tsx:219` |
| accent-foreground | 11 | 11 | 0 | 0 | 0 | 0 | `text-accent-foreground` 11 | `components/ui/dropdown-menu.tsx:103` |
| primary-foreground | 9 | 5 | 0 | 2 | 2 | 1 | `text-primary-foreground` 9 | `app/dev/showcase/page.tsx:513` |
| accent | 6 | 6 | 0 | 0 | 0 | 0 | `bg-accent` 6 | `components/ui/dropdown-menu.tsx:103` |
| popover | 6 | 5 | 0 | 1 | 0 | 3 | `bg-popover` 6 | `components/business/order/OrderListFilters.tsx:517` |
| secondary | 6 | 5 | 0 | 1 | 0 | 0 | `bg-secondary` 4、`bg-secondary/80` 2 | `components/business/order/OrderAdvancedFilters.tsx:75` |
| popover-foreground | 5 | 5 | 0 | 0 | 0 | 3 | `text-popover-foreground` 5 | `components/ui/alert-dialog.tsx:63` |
| sidebar | 5 | 5 | 0 | 0 | 0 | 0 | `bg-sidebar` 5 | `components/ui/sidebar.tsx:138` |
| sidebar-border | 5 | 3 | 0 | 2 | 0 | 1 | `border-sidebar-border/70` 2 | `components/business/admin/AppSidebar.tsx:278` |
| sidebar-ring | 5 | 5 | 0 | 0 | 0 | 0 | `ring-sidebar-ring` 5 | `components/ui/sidebar.tsx:372` |
| secondary-foreground | 4 | 3 | 0 | 1 | 0 | 0 | `text-secondary-foreground` 4 | `components/business/order/OrderAdvancedFilters.tsx:75` |
| info-foreground | 3 | 1 | 1 | 1 | 0 | 0 | `text-info-foreground` 3 | `ExternalSalesPriceBookVersionPanel.tsx:426` |
| sidebar-primary | 1 | 0 | 0 | 1 | 0 | 0 | `bg-sidebar-primary` 1 | `components/business/admin/AppSidebar.tsx:521` |
| info-neutral | 1 | 0 | 1 | 0 | 0 | 0 | `border-l-info-neutral` 1 | `components/ui-business/EnvNotice.tsx:15` |
| info-neutral-foreground | 1 | 0 | 1 | 0 | 0 | 0 | `text-info-neutral-foreground` 1 | `components/ui-business/EnvNotice.tsx:15` |
| chart-1 … chart-7 | **0** | 0 | 0 | 0 | 0 | 4/1/2/1/1/1/1 | 仅 `var(--chart-N)` | `CategoryDistributionChart.tsx:26-34`、`ProductionTrendChart.tsx:99`、`SalesRankingChart.tsx:34` |
| sidebar-primary-foreground | **0** | 0 | 0 | 0 | 0 | 0 | — | 仅 `globals.css:24,123,170` 自身定义 |

utility 类引用总量（所有语义名合计，含 `bg-transparent` 等非令牌）：6,038 次；`bg-transparent` 41、`border-transparent` 7、`bg-black/40` 2（`components/ui/alert-dialog.tsx:45`、`components/ui/dialog.tsx:39`）、`bg-black/10` 1（`components/ui/sheet.tsx:31`）、`text-current` 3 等属于 Tailwind 内建色，不在令牌表内。

### 1.3 非颜色令牌

| 令牌 | 值 | utility 引用 | 分布 | `var()` 直引 | 证据 |
|---|---|---:|---|---:|---|
| `--font-sans` | 系统 UI 栈 | 310 | app 174 / business 134 / ui-business 2 | 0 | `app/(admin)/foreman/attendance/page.tsx:111`（`font-sans` 在 body 已全局 apply，310 处大多冗余） |
| `--font-mono` | `var(--font-geist-mono), ui-monospace…` | 39 | app 17 / business 21 / ui-business 1 | 5 | `app/(admin)/foreman/cdr/page.tsx:243`；var: `AdminOrderDetailView.module.css:6,41,47,52,72` |
| `--font-heading` | `var(--font-sans)` | 5 | ui 5 | 0 | `components/ui/alert-dialog.tsx:109` |
| `--radius` | `0.625rem`(10px) | — | 见 §6 | 0 | 只被 @theme 的 7 个 `--radius-*` 引用（`globals.css:62-68`） |
| `--radius-sm` | 6px | 4 | business 3 / ui 1 | 0 | `components/business/admin/UserMenu.tsx:89` |
| `--radius-md` | 8px | 187 | app 36 / business 135 / ui 14 / ui-business 2 | 4 | `components/ui/button.tsx:25,26,30,32`（`rounded-[min(var(--radius-md),10px)]`） |
| `--radius-lg` | 10px | 176 | app 33 / business 122 / ui 13 / ui-business 8 | 0 | `app/(admin)/foreman/materials/page.tsx:98` |
| `--radius-xl` | 14px | 292 | app 168 / business 109 / ui-business 11 / ui 4 | 1 | `app/(admin)/foreman/attendance/page.tsx:149`；var: `AdminOrderEditor.module.css:5` |
| `--radius-2xl` | 18px | 4 | app 1 / business 3 | 0 | `app/wo/[orderNo]/page.tsx:28` |
| `--radius-3xl` | 22px | **0** | — | 0 | 定义于 `globals.css:67`，未用 |
| `--radius-4xl` | 26px | 1 | ui 1 | 0 | `components/ui/badge.tsx:8` |
| `--admin-header-offset` | `max(3.5rem,…)` | — | — | 1 (+2 globals 内部) | `components/business/order/OrderDetailTimeline.tsx:19` |
| `--admin-scroll-padding-top` | calc | — | — | 0 (+3 globals 内部 L242,258,267) | 仅 globals.css 自用 |

### 1.4 定义但零外部引用（"defined but unused"）

| 令牌 | 说明 |
|---|---|
| `--color-chart-1` … `--color-chart-7`（7 个 @theme 别名） | `bg-chart-N/text-chart-N` 0 次；底层 `--chart-N` 全部通过 `var()` 传给 Recharts（12 次） |
| `--sidebar-primary-foreground` / `--color-sidebar-primary-foreground` | utility 0、var 0 |
| `--radius-3xl` | 0 |
| `--admin-scroll-padding-top` | 只在 globals.css 内部消费 |
| `--accent`、`--accent-foreground`、`--font-heading`、`--sidebar*`(除 accent) | 业务层 0 次，只被 `components/ui/` shadcn 原子件使用 |

### 1.5 引用但未在 globals.css 定义

| 变量 | 次数 | 位置 | 定义来源 |
|---|---:|---|---|
| `--font-geist-mono` | 1 | `app/globals.css:16` | `app/layout.tsx:10`（next/font `Geist_Mono({ variable })`）— 合法 |
| `--order-detail-timeline-top` | 4 | `AdminOrderDetailView.module.css:12,18,61` | 组件 inline style 设置 — 页面局部令牌 |
| `--sidebar-width` / `--sidebar-width-icon` | 2 / 2 | `components/ui/sidebar.tsx:222-233` | 同文件 inline style — shadcn 约定 |

### 1.6 CSS Module 对全局令牌的**局部覆盖**（重要漂移点）

| 文件 | 覆盖内容 |
|---|---|
| `components/business/order/AdminOrderWorkspace.module.css:3-27` | 用 **hex** 重定义 10 个令牌（`--background/--foreground/--card/--card-foreground/--border/--muted/--muted-foreground/--primary/--primary-foreground/--success-foreground`），明暗各一套，共 20 个 hex 字面量；注释称"来自已批准 HTML 参考稿" |
| `components/business/order/AdminOrderDetailView.module.css:137` | `.decision { --primary: var(--foreground); --primary-foreground: var(--background); }` 把主色反转成黑白 |
| `components/business/order/AdminOrderDetailView.module.css:146-151` | 按 `class~='bg-primary'` / `text-destructive` 选择器覆盖按钮配色 |

---

## 2. 原始颜色字面量（hex / rgb / hsl / oklch）

总计 **81** 处，**全部在 `components/business/`**（`components/ui/` 0、`components/ui-business/` 0、`app/` 0）。类型：hex 80、`rgb()` 1、`hsl()/oklch()` 0（globals.css 的 oklch 定义已排除）。

| 文件 | 次数 | 性质 |
|---|---:|---|
| `components/business/order/order-form-b/OrderPaperSwatchPicker.tsx:41-67` | 31 | 纸张实物色卡（渐变/材质数据） |
| `components/business/order/order-form-b/OrderFoilSwatchPicker.tsx:48-75` | 28 | 烫金/烫银实物色卡 |
| `components/business/order/AdminOrderWorkspace.module.css:4-26` | 20 | 页面局部主题覆盖（见 §1.6） |
| `components/business/order/AutoPrint.tsx:210` | 2 | 打印视图内联 `#fff` / `#a8121a` |

Top 值（共 68 个不同值，≥2 次的如下）：

| 值 | 次数 | 位置 |
|---|---:|---|
| `#d9dcdf` | 4 | `OrderFoilSwatchPicker.tsx:70` ×4 |
| `#17181c` | 3 | `AdminOrderWorkspace.module.css:5,7`；`OrderFoilSwatchPicker.tsx:58` |
| `#fff` | 3 | `AdminOrderWorkspace.module.css:6,12`；`AutoPrint.tsx:210` |
| `#a8121a`（品牌红 seal） | 3 | `AdminOrderWorkspace.module.css:11`；`AutoPrint.tsx:210`；`OrderFoilSwatchPicker.tsx:55` |
| `#f4f2ef` | 2 | `AdminOrderWorkspace.module.css:18,20` |
| `#fdfdfd` | 2 | `OrderFoilSwatchPicker.tsx:62`；`OrderPaperSwatchPicker.tsx:65` |
| `#ffe8a8` | 2 | `OrderPaperSwatchPicker.tsx:59` ×2 |
| 其余 61 个值 | 各 1 | 例：`#faf9f7`(module.css:4)、`#e4e1dc`(:8)、`#f0eeea`(:9)、`#716e68`(:10)、`#2f6b46`(:13)、`#e96670`(:24)、`rgb(0 0 0 / 28%)`(`OrderPaperSwatchPicker.tsx:54`) |

判断：色卡组件的 59 处是"物料真实颜色"数据而非主题色，属合理例外；真正的主题漂移是 `AdminOrderWorkspace.module.css` 的 20 处（把原型 hex 直接钉在 CSS Module 里，与 globals.css 的 oklch 体系并行）和 `AutoPrint.tsx:210` 的 2 处。

---

## 3. Tailwind 调色板字面量

- 命中：**0**（`app/` 0、`components/ui/` 0、`components/ui-business/` 0、`components/business/` 0）。模式：`(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|divide|placeholder|accent|caret)-(slate|gray|zinc|…|rose)-\d+`。
- 任意色类（`bg-[#…]` / `text-[rgb(…)]`）：**0**。
- 门禁规则：`eslint.config.mjs:37-56` 的 **`no-restricted-syntax`**，4 个 selector：`Literal[value=PALETTE_LITERAL_PATTERN]`、`TemplateElement[value.cooked=…]`（`:12-13` 定义正则 `\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|caret|accent|shadow)-(red|…|gray)-\d{2,3}\b`）以及 `ARBITRARY_COLOR_LITERAL_PATTERN`（`:15-16`）。生效范围 `:30-34`：`app/**`、`components/business/**`、`components/ui-business/**`；`components/ui/` 豁免（注释 `:10-11`）。
- 规则未覆盖的口子：`bg-white/black/transparent`（内建色，非 palette），当前 `bg-black/40` ×2、`bg-black/10` ×1 全在 `components/ui/`；hex 写在 CSS Module / 对象字面量（§2）也不在 ESLint 的 JSX 字符串 selector 命中范围内。
- `eslint-disable` 注释：共 7 处，**全部是 `@next/next/no-img-element`**（`AdminOrderDetailView.tsx:154,245`、`AdminOrderWorkspaceList.tsx:3`、`DesignImageGallery.tsx:41`、`DesignUploadPanel.tsx:236`、`LocalDesignImagePreview.tsx:40`、`SalesOrdersList.tsx:3`），无针对调色板规则的豁免。

---

## 4. 字号与字重

### 4.1 Tailwind 字号类（总 2,009 次）

| 类 | 像素 | 次数 | 占比 | ui | ui-business | business | app |
|---|---|---:|---:|---:|---:|---:|---:|
| `text-xs` | 12px | **903** | 45.0% | 10 | 12 | 584 | 297 |
| `text-sm` | 14px | **762** | 37.9% | 27 | 28 | 474 | 233 |
| `text-base` | 16px | 118 | 5.9% | 5 | 0 | 50 | 63 |
| `text-lg` | 18px | 34 | 1.7% | 0 | 0 | 12 | 22 |
| `text-xl` | 20px | 30 | 1.5% | 0 | 2 | 9 | 19 |
| `text-2xl` | 24px | 10 | 0.5% | 0 | 1 | 6 | 3 |
| `text-3xl` | 30px | 3 | 0.1% | 0 | 0 | 2 | 1 |
| 任意值 `text-[…]` | — | **149** | 7.4% | 1 | 0 | 146 | 2 |

响应式前缀变体极少：`md:text-sm` 6、`sm:text-xs/xl/base/2xl` 各 1。

### 4.2 任意字号全清单（19 种写法，149 次；按等效像素归并）

| 等效 px | 写法 | 次数 | 位置（前 4 处） |
|---|---|---:|---|
| **11px** | `text-[11px]` | 49 | `app/(admin)/owner/rules/page.tsx:109`、`AdminOrderWorkspace.tsx:416,437`、`AdminOrderWorkspaceList.tsx:191` |
| 11px | `text-[0.6875rem]` | 12 | `OrderForm.tsx:3532,3608`、`order-form-b/ExternalSalesOrderFormB.tsx:202,257` |
| **13px** | `text-[13px]` | 21 | `AdminOrderWorkspace.tsx:142`、`ExternalSalesOrderFormRail.tsx:187,395,415` |
| 13px | `text-[0.8125rem]` | 9 | `ExternalSalesOrderFormB.tsx:395,1000,1019,1028` |
| **10px** | `text-[10px]` | 26 | `app/(admin)/owner/rules/page.tsx:113`、`AdminOrderProgress.tsx:53,57,61` |
| 10px | `text-[0.625rem]` | 3 | `ExternalSalesOrderFormB.tsx:261,287,382` |
| 10.5px | `text-[0.65625rem]` | 5 | `ExternalSalesOrderFormB.tsx:1451,1460`、`OrderFoilSwatchPicker.tsx:228`、`OrderSubmissionReviewDialog.tsx:164` |
| 10.5px | `text-[10.5px]` | 3 | `AdminOrderProgress.tsx:20`、`price/RulePriceWorkbench.tsx:485,589` |
| 9px | `text-[9px]` | 4 | `AdminOrderWorkspaceList.tsx:343`、`SalesOrdersList.tsx:454`、`OrderFoilSwatchPicker.tsx:223`、`OrderSubmissionReviewDialog.tsx:89` |
| 9px | `text-[0.5625rem]` | 2 | `ExternalSalesOrderFormB.tsx:220`、`OrderSubmissionReviewDialog.tsx:241` |
| 11.5px | `text-[0.71875rem]` | 3 | `ExternalSalesOrderFormB.tsx:520,982,1045` |
| ~10.9px | `text-[0.68rem]` | 2 | `rules/pricing/PriceVersionsPage.tsx:280,424` |
| 12.5px | `text-[12.5px]` | 2 | `AdminOrderDecisionPanel.tsx:814,823` |
| 12.8px | `text-[0.8rem]` | 1 | `components/ui/button.tsx:26` |
| 13.5px | `text-[0.84375rem]` | 2 | `ExternalSalesOrderFormB.tsx:278,755` |
| 15px | `text-[15px]` | 1 | `SalesOrdersList.tsx:260` |
| 21px | `text-[21px]` / `text-[1.3125rem]` | 1 / 1 | `AdminOrderWorkspace.tsx:101` / `ExternalSalesOrderFormB.tsx:978` |
| 34px | `text-[34px]` | 2 | `ExternalSalesOrderFormRail.tsx:216,494` |

（以上路径省略前缀 `components/business/order/`。）归并后：11px **61**、13px **30**、10px **29**、10.5px 8、9px 6、其余 ≤3。同一像素值存在 px 与 rem 两种写法并存（11px: 49+12；13px: 21+9；10px: 26+3；9px: 4+2）。

### 4.3 CSS Module 中的 `font-size`（仅 `AdminOrderDetailView.module.css`）

| 值 | 次数 | 行 |
|---|---:|---|
| 12px | 15 | :8,14,22,36,50,67,73,76,87,98,111,… |
| 11px | 9 | :7,15,29,33,53,65,72,77,83 |
| 10px | 4 | :24,42,51,92 |
| 17px | 4 | :27,52,82,113 |
| 13px | 3 | :1,34,102 |
| 15px | 3 | :2,6,28 |
| 16px / 22px | 1 / 1 | :140 / :47 |

另 `AdminOrderWorkspace.module.css:84` `font-size: 12px`、`AdminOrderInlineOperations.module.css:14` `font-size: 12px`。

### 4.4 字重

| 类 | 次数 | 占比 |
|---|---:|---:|
| `font-semibold`(600) | 382 | 44.7% |
| `font-medium`(500) | 362 | 42.4% |
| `font-bold`(700) | 51 | 6.0% |
| `font-extrabold`(800) | 44 | 5.2% |
| `font-normal` | 13 | 1.5% |
| `font-black`(900) | 2 | 0.2% |

CSS Module：`font-weight: 800` 7、`600` 7、`700` 3、`500` 2（`AdminOrderDetailView.module.css:2,6,7,23,27,…`；`AdminOrderWorkspace.module.css:85`）。

---

## 5. 间距（p / m / gap / space）

总计 **4,712** 次（ui 114、ui-business 101、business 2,615、app 1,882）。按数值归并（`gap-x/y-N`、`space-x/y-N` 已并入 N）：

| 值 | 像素 | 次数 | 占比 | 说明 |
|---|---|---:|---:|---|
| **3** | 12px | ≈1,328 | 28.2% | p 801、m 126、gap 245、space-y 144、gap-x 9、其他 |
| **2** | 8px | ≈1,191 | 25.3% | p 545、m 184、gap 297、space-y 149 |
| **4** | 16px | ≈845 | 17.9% | p 601、m 63、gap 74、space-y 99 |
| **1** | 4px | ≈603 | 12.8% | p 107、m 289、gap 49、space-y 150 |
| 6 | 24px | ≈213 | 4.5% | p 125、space-y 72、gap-x 5 |
| 1.5 | 6px | ≈115 | 2.4% | m 23、p 41、gap 31、space-y 20 |
| 5 | 20px | ≈113 | 2.4% | p 74、m 12、space-y 24 |
| 0.5 | 2px | ≈74 | 1.6% | m 48、p 15、space-y 7 |
| 0 | 0 | ≈68 | 1.4% | |
| 2.5 | 10px | 54 | 1.1% | p 46 |
| 3.5 | 14px | ≈29 | 0.6% | p 20 |
| 8 | 32px | ≈20 | 0.4% | |
| 7 / 10 / 9 / 14 / 12 | 28/40/36/56/48px | 8 / 6 / 6 / 2 / 1 | <0.2% | 长尾 |
| 任意值 | — | 33 | 0.7% | 见下 |

### 5.1 任意间距（33 处）

| 写法 | 次数 | 位置 |
|---|---:|---|
| `pb/pt/pl/pr-[max(1rem,env(safe-area-inset-*))]` 及 `calc(…)` 变体 | 19 | `components/business/order/SalesOrdersList.tsx:543,568,715`、`OrderListFilters.tsx:517`、`OrderListBatchSelection.tsx:242`、`AdminOrderEditor.tsx:1116` 等（safe-area 处理，globals.css 已有 `.admin-safe-*` / `.worker-safe-*` 同义类 L212-306） |
| `mt-[1.125rem]` / `pt-[1.125rem]`（18px） | 8 | `components/business/order/OrderForm.tsx:3498,3604` 等 |
| `p-[18px]` | 4 | `components/business/order/ExternalSalesOrderFormRail.tsx:168,257,368,369` |
| `py-[11px]` | 2 | `app/(admin)/orders/_components/OrdersListContentSkeleton.tsx:23`、`components/business/order/AdminOrderWorkspaceList.tsx:168` |

### 5.2 其他 `-[Npx]` 任意值（全部 227 处；非字号/圆角/间距部分）

| 类别 | 主要值（次数） | 例 |
|---|---|---|
| 容器断点 `min-[Npx]:` | 960px 14、560px 13、360px 8、881px 3、480px 1、420px 1 | `OrdersListContentSkeleton.tsx:30-32`、`OrderForm.tsx:1000`、`app/(worker)/worker/salary/[id]/page.tsx:189`、`ExternalSalesOrderFormB.tsx:73` |
| 表格最小宽 `min-w-[Npx]` | 720 3、980 3、1080 2、780 2、860 2、900 2、1250 1、960 1、920 1、760 1、680 1、200 1、104 2、96 1 | `app/(admin)/owner/pigsty/page.tsx:400,485,595,659,722,786`、`salary/daily/[id]/page.tsx:138` |
| `max-w-[Npx]` | 1180 3、420 3、220 2、880 1、360 1 | `app/(admin)/owner/rules/layout.tsx:8`、`AdminOrderEditor.tsx:537` |
| 尺寸 | `h-[46px]` 2、`w-[34px]` 2、`w-[110px]` 2、`h-[72px]`、`w-[104px]`、`min-h-[84px]`、`h-[3px]`、`w-[2px]`、`top-[70px]`、`left-[11px]` | `OrdersListContentSkeleton.tsx:10,23,25`、`AdminOrderWorkspaceList.tsx:329`、`AppSidebar.tsx:521` |
| 描边 | `ring-[3px]` 3、`border-l-[3px]` 1 | `SettingsForm.tsx:132,289`、`ui/badge.tsx:8`、`ExternalSalesOrderFormRail.tsx:505` |

---

## 6. 圆角

`--radius: 0.625rem` → sm 6px / md 8px / lg 10px / xl 14px / 2xl 18px / 3xl 22px / 4xl 26px。注意裸 `rounded` 在 Tailwind v4 为固定 0.25rem(4px)，**不受 `--radius` 控制**。

总计 **793** 次：

| 类 | 像素 | 次数 | 占比 | ui | ui-business | business | app | 证据 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `rounded-xl` | 14 | **292** | 36.8% | 4 | 11 | 109 | 168 | `app/(admin)/foreman/attendance/page.tsx:149` |
| `rounded-md` | 8 | **187** | 23.6% | 14 | 2 | 135 | 36 | `app/(admin)/foreman/attendance/page.tsx:175` |
| `rounded-lg`(+t/b-lg 各 1) | 10 | **176** | 22.2% | 13 | 8 | 122 | 33 | `app/(admin)/foreman/materials/page.tsx:98` |
| `rounded-full` | ∞ | 76 | 9.6% | 8 | 3 | 57 | 8 | |
| `rounded`（裸） | 4 | 25 | 3.2% | 0 | 0 | 21 | 4 | |
| `rounded-[14px]` | 14 | 16 | 2.0% | 0 | 0 | 16 | 0 | 见下 |
| `rounded-sm` | 6 | 4 | 0.5% | 1 | 0 | 3 | 0 | `components/business/admin/UserMenu.tsx:89` |
| `rounded-[9px]` | 9 | 4 | 0.5% | 0 | 0 | 4 | 0 | |
| `rounded-2xl`(+t-2xl 1) | 18 | 4 | 0.5% | 0 | 0 | 3 | 1 | `app/wo/[orderNo]/page.tsx:28` |
| `rounded-[min(var(--radius-md),10px)]` / `…12px)]` | ≤8 | 2 / 2 | 0.5% | 4 | | | | `components/ui/button.tsx:25,26,30,32` |
| `rounded-none` | 0 | 1 | | | | 1 | | |
| `rounded-[10px]` | 10 | 1 | | | | 1 | | `order-form-b/OrderPaperSwatchPicker.tsx:105` |
| `rounded-4xl` | 26 | 1 | | 1 | | | | `components/ui/badge.tsx:8` |
| `rounded-[0.375rem]` | 6 | 1 | | 1 | | | | `components/ui/checkbox.tsx:38` |
| `rounded-[2px]` | 2 | 1 | | 1 | | | | `components/ui/tooltip.tsx:59` |

任意圆角全清单（27 处）：
- `rounded-[14px]` ×16 —— 与 `rounded-xl` 等值，纯冗余：`components/business/order/ExternalSalesOrderFormRail.tsx:168,257,368,369`、`order-form-b/ExternalSalesOrderFormB.tsx:1057`、`components/business/rules/pricing/CustomerPricingSectionViews.tsx:400,547,586,663,817,824,860,1042,1063,1155,1178`
- `rounded-[9px]` ×4：`ExternalSalesOrderFormB.tsx:1000,1019,1028,1039`
- `rounded-[10px]` ×1（= `rounded-lg`）：`OrderPaperSwatchPicker.tsx:105`
- `rounded-[0.375rem]` ×1（= `rounded-sm`）：`components/ui/checkbox.tsx:38`
- `rounded-[2px]` ×1：`components/ui/tooltip.tsx:59`
- `rounded-[min(var(--radius-md),Npx)]` ×4：`components/ui/button.tsx:25,26,30,32`

CSS Module `border-radius`（20 处）：10px 4（`AdminOrderDetailView.module.css:19,20,49,81`）、14px 2（:16,18）、6px 2（:24,30）、12px 2（:55,101）、99px 2（:89,111）、4px 1（:7）、50% 1（:23）、`var(--radius-xl)` 1（`AdminOrderEditor.module.css:5`）、`20px 20px 0 0` 1（`AdminOrderEditor.module.css:26`）、3px 1、8px 1（`AdminOrderWorkspace.module.css:67,86`）。→ CSS Module 里 12 个 px 值中只有 1 处走令牌。

---

## 7. 阴影与边框

### 7.1 `shadow-*`（总 287：app 151、business 120、ui 11、ui-business 5）

| 类 | 次数 | 占比 | 证据 |
|---|---:|---:|---|
| `shadow-sm` | **226** | 78.7% | `app/(admin)/foreman/attendance/page.tsx:149,276` |
| `shadow-xs` | 26 | 9.1% | `components/business/account/AccountForm.tsx:65`、`bom/BomForm.tsx:43` |
| `shadow-none` | 16 | 5.6% | `components/business/order/AdminOrderEditor.tsx:537,674` |
| `shadow-lg` | 6 | 2.1% | `app/(admin)/layout.tsx:52` |
| `shadow-[2px_0_0_0_var(--border)]` | 4 | | `components/business/order/OrdersTable.tsx:181,185`（粘性列分隔） |
| `shadow-[6px_0_8px_-8px_var(--foreground)]` | 2 | | `OrdersTable.tsx:197,273` |
| `shadow-[0_-8px_18px_-16px_var(--foreground)]` | 1 | | `price/ExternalSalesPriceBookDraftForms.tsx:1944` |
| `shadow-[0_-6px_20px_-16px_var(--foreground)]` | 1 | | `production/WorkerBottomNavigation.tsx:24` |
| `shadow-[0_0_0_1px_var(--sidebar-border)]` / `…sidebar-accent)]` | 1 / 1 | | `components/ui/sidebar.tsx:453` |
| `shadow-2xl` / `shadow-xl` / `shadow-md` | 1 / 1 / 1 | | `app/wo/[orderNo]/page.tsx:28`、`OrderListBatchSelection.tsx:259`、`ui/dropdown-menu.tsx:56` |

CSS Module：`box-shadow: 0 0 0 3px var(--warning)`（`AdminOrderDetailView.module.css:60`）、`box-shadow: none` ×3。

### 7.2 边框宽度/方向

| 类 | 次数 |
|---|---:|
| `border` | 619 |
| `border-b` | 105 |
| `border-t` | 72 |
| `border-0` | 22 |
| `border-dashed` | 22 |
| `border-l` | 7 |
| `border-2` | 6 |
| `border-t-2` / `border-b-2` | 5 / 5 |
| `border-l-2` / `border-b-0` | 4 / 4 |
| `border-y` / `border-l-4` | 3 / 3 |
| `border-r` / `border-4` / `border-l-[3px]` | 2 / 1 / 1 |
| `divide-x/y` | 72 |

边框颜色 Top：`border-input` 38、`border-ring` 34、`border-warning/40` 32、`border-foreground` 30、`border-destructive/40` 25、`border-destructive` 23、`border-border` 22、`border-warning/50` 12、`border-success/40` 10、`border-transparent` 7、`border-destructive/30` 7、`border-destructive/50` 6、`border-primary` 5。

---

## 8. 原型令牌对照

### 8.1 四份原型的 `:root`

| 变量 | `docs/工单列表-管理端.html:8-9` | `~/Downloads/工单详情-管理端.html:8-9` | `~/Downloads/工单详情-管理端 v2.dc.html` | `~/Downloads/编辑工单-管理端.html:8-9` |
|---|---|---|---|---|
| `--ink` | `#17181c` | `#17181c` | （无 `:root`，全部内联 hex；`#17181c` ×43） | `#17181c` |
| `--mute` | `#77746e` | `#77746e` | `#77746e` ×39 内联 | `#77746e` |
| `--paper` | `#faf9f7` | `#faf9f7` | `#faf9f7` ×2 | `#faf9f7` |
| `--card` | `#fff` | `#fff` | `#fff` ×52 | `#fff` |
| `--rule` | `#e4e1dc` | `#e4e1dc` | `#e4e1dc` ×38 | `#e4e1dc` |
| `--rule-2` | `#f0eeea` | `#f0eeea` | `#f0eeea` ×10 | `#f0eeea` |
| `--seal` | `#a8121a` | `#a8121a` | `#a8121a` ×25 | `#a8121a` |
| `--seal-bg` | `#fdf3f3` | `#fdf3f3` | `#fdf3f3` ×5 | `#fdf3f3` |
| `--ok` | `#2f6b46` | `#2f6b46` | `#2f6b46` ×7 | `#2f6b46` |
| `--gold` | `#c9a227` | `#c9a227` | `#c9a227` ×7 | `#c9a227` |
| `--gold-bg` | **缺**（内联 `#fdf6e3` ×1） | `#fdf6e3` | `#fdf6e3` ×9 | `#fdf6e3` |

结论：三份带 `:root` 的原型 10 个变量**值完全一致**，仅"工单列表"少定义 `--gold-bg`。v2.dc 不用变量，但复用同一调色板，并额外引入 `#a5a19a` ×24（第二级 mute）、`#d9d5ce` ×4、`#f4f2ee` ×3、`#efe7cf/#e9dcae/#8a7f5f` ×3（金色系）、`#7d0d14` ×1（深红）等 12 个原型未命名的颜色；v2 还用 `'IBM Plex Mono'` ×21 处。

### 8.2 原型 → 仓库映射（`AdminOrderWorkspace.module.css:3-14` 明亮模式）

| 原型 | 仓库局部令牌 | 一致？ |
|---|---|---|
| `--ink #17181c` | `--foreground #17181c` | ✅ |
| `--paper #faf9f7` | `--background #faf9f7` | ✅ |
| `--card #fff` | `--card #fff` | ✅ |
| `--rule #e4e1dc` | `--border #e4e1dc` | ✅ |
| `--rule-2 #f0eeea` | `--muted #f0eeea` | ✅ |
| `--seal #a8121a` | `--primary #a8121a` | ✅ |
| `--ok #2f6b46` | `--success-foreground #2f6b46` | ✅ |
| `--mute #77746e` | `--muted-foreground **#716e68**` | ❌ 漂移（`:10`） |
| `--seal-bg / --gold / --gold-bg` | 无对应 | 缺 |

全局 `globals.css` 用 oklch：`--primary: oklch(0.51 0.2 25)`（`:86`）≈ 原型 seal 但非同值；`--background: oklch(1 0 0)` 纯白 vs 原型 `#faf9f7` 米白。即：**同一 ADMIN 壳内并存两套底色**（全局纯白 / 工单列表页米白）。

### 8.3 原型字号（`font-size: Npx`，四份合计）

| px | 列表 | 详情 | v2 | 编辑 | 合计 |
|---|---:|---:|---:|---:|---:|
| **12.5** | 7 | 6 | 32 | 8 | **53** |
| **13** | 4 | 2 | 34 | 4 | **44** |
| **12** | 10 | 9 | 17 | 1 | **37** |
| 10 | 2 | 4 | 20 | 4 | 30 |
| 11 | 6 | 3 | 9 | 6 | 24 |
| 11.5 | 5 | 3 | 8 | 6 | 22 |
| 10.5 | 4 | 5 | 0 | 6 | 15 |
| 14 | 0 | 1 | 8 | 3 | 12 |
| 16 / 18 | 2/0 | 1/0 | 5/9 | 1/0 | 9 / 9 |
| 13.5 | 2 | 0 | 3 | 2 | 7 |
| 9.5 | 1 | 2 | 0 | 2 | 5 |
| 15 / 14.5 / 9 / 17 / 19 / 20 / 21 | | | | | 4 / 2 / 1 / 1 / 1 / 1 / 1 |

原型字重：`800` 116、`700` 81、`600` 42、`500` 33（仅 v2）、`900` 22（仅 v2）。

### 8.4 原型圆角（`border-radius`）

| 值 | 列表 | 详情 | v2 | 编辑 | 合计 |
|---|---:|---:|---:|---:|---:|
| 99px（胶囊） | 8 | 5 | 16 | 6 | **35** |
| 9px | 1 | 1 | 20 | 4 | **26** |
| 14px | 0 | 1 | 11 | 1 | 13 |
| 8px | 3 | 3 | 3 | 3 | 12 |
| 12px | 2 | 1 | 6 | 3 | 12 |
| 4px | 2 | 2 | 2 | 2 | 8 |
| 10px / 11px / 50% | 1/3/0 | 1/1/1 | 6/0/5 | 0/3/1 | 7 / 7 / 7 |
| `0 8px 8px 0` | 1 | 1 | 6 | 0 | 8 |
| 6px / 5px / 16px | 1/1/0 | 0/1/0 | 3/1/4 | 0/1/0 | 4 / 4 / 4 |
| 13px / 2px / 3px / `20px 20px 0 0` / `0 10px 10px 0` | | | | | 2 / 2 / 1 / 1 / 2 |

原型圆角散布在 2–16px 共 12 档，无内部一致性；仓库把 14px 与 9px 直接搬成 `rounded-[14px]`(16)、`rounded-[9px]`(4)。

---

## 9. 事实令牌 vs 漂移

| 维度 | 事实令牌（≥5% 份额） | 漂移长尾（次数） |
|---|---|---|
| **语义色** | `muted-foreground` 993、`destructive` 391、`card` 292、`foreground` 212、`muted` 207、`background` 175、`ring` 121、`warning` 112、`primary` 91（前 9 项占 utility 引用 ~86%） | ① CSS Module 用 hex 局部重定义 10 个令牌（20 处，`AdminOrderWorkspace.module.css:4-26`），`--muted-foreground` 与原型 `--mute` 不同值；② `AutoPrint.tsx:210` 内联 `#fff/#a8121a`；③ 色卡 59 处 hex（合理数据）；④ `info`/`info-neutral` 语义色几乎无人用（12 / 1 / 1）；⑤ `chart-*` @theme 别名 0 引用、`sidebar-primary-foreground` 0、`radius-3xl` 0；⑥ 原型 `--seal-bg/--gold/--gold-bg` 在全局无对应 |
| **调色板字面量** | 0（ESLint `no-restricted-syntax` 生效，无 disable） | 无。但规则不覆盖 CSS 文件与对象字面量里的 hex |
| **字号** | `text-xs` 903（45%）、`text-sm` 762（38%）、`text-base` 118（5.9%）——三档占 89% | 任意字号 149 处 / 19 种写法：11px 61、13px 30、10px 29、10.5px 8、9px 6、11.5px 3、12.5/13.5/34/21px 各 2、15/12.8px 各 1；同像素 px/rem 双写法（11px、13px、10px、9px）；CSS Module 再加 12/11/10/17/13/15/16/22px 共 41 处；原型本身以 12.5/13/12/11.5/10.5 半像素为主（53/44/37/22/15），Tailwind 无对应档位是漂移根源 |
| **字重** | `font-semibold` 382（45%）、`font-medium` 362（42%） | `font-bold` 51、`font-extrabold` 44、`font-normal` 13、`font-black` 2；原型以 800（116）/700（81）为主，仓库以 500/600 为主——**方向性不一致** |
| **间距** | 3(12px) 1328、2(8px) 1191、4(16px) 845、1(4px) 603——四档占 84%；6 213（4.5%，临界） | 1.5 115、5 113、0.5 74、0 68、2.5 54、3.5 29、8 20、7/9/10/12/14 共 23；任意值 33（safe-area 19、`[1.125rem]` 8、`p-[18px]` 4、`py-[11px]` 2）；另有 62 处 `min/max-w-[Npx]` 表格宽与 40 处 `min-[Npx]:` 自定义断点 |
| **圆角** | `rounded-xl`(14px) 292（37%）、`rounded-md`(8px) 187（24%）、`rounded-lg`(10px) 176（22%）、`rounded-full` 76（9.6%） | 裸 `rounded`(4px，脱离 `--radius`) 25；`rounded-[14px]` 16（= xl，冗余）；`rounded-[9px]` 4；`rounded-sm` 4、`rounded-2xl` 4、`[10px]`/`4xl`/`[0.375rem]`/`[2px]`/`none` 各 1；`ui/button.tsx` 4 处 `min(var(--radius-md),Npx)`；CSS Module 12 个 px 圆角只 1 处走令牌；原型 12 档圆角无规律 |
| **阴影** | `shadow-sm` 226（79%）、`shadow-xs` 26（9%）、`shadow-none` 16（5.6%） | `shadow-lg` 6、任意 box-shadow 10（5 种写法，均引用 `var(--border/--foreground/--sidebar-*)`）、`2xl/xl/md` 各 1 |
| **边框** | `border` 619、`border-b` 105、`border-t` 72、`divide-*` 72、`border-dashed` 22 | 宽度 2/4/`[3px]` 共 30；颜色以 `input`/`ring`/`warning/40`/`foreground`/`destructive/40` 为主，`border-border` 22 处显式写出（已是默认值，冗余） |
| **字体** | `font-sans` 310（body 已全局 apply，基本冗余）、`font-mono` 39 | `font-heading` 仅 ui 5 处；原型 v2 用 IBM Plex Mono，仓库用 Geist Mono（`app/layout.tsx:10`） |

**一句话**：颜色层几乎完全令牌化（0 调色板字面量、0 任意色类），漂移集中在**一个页面级 CSS Module 用 hex 复刻原型**；字号/圆角/间距的漂移主要来自把原型的半像素字号与非标圆角（9/14px、800 字重）以任意值直接搬进 `components/business/order/` 与 `rules/pricing/` 两处（任意字号 146/149、任意圆角 21/27 都落在 `components/business/`）。
