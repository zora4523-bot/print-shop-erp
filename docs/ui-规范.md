---
status: normative
owner: project-maintainers
last_verified: 2026-09-08
ruling: audits/2026-09-08-UI对照裁决表.md
inventory: UI现状盘点.md
migration: UI迁移清单.md
token_implementation: ../app/globals.css
gates:
  - ../scripts/ui-tokens/check.mjs
  - ../scripts/ui-copy/check.mjs
  - ../eslint.config.mjs
---

# UI 规范

本文件是项目 UI 的**唯一来源**。后续任何 UI 任务只引用条款号（如「§2.1」「§7 第 3 律」），不复述规则。

收录铁律：本文每一条要么代码已符合，要么在 [`UI迁移清单.md`](UI迁移清单.md) 有编号对应项。已知违例逐条登记在附录 A。本文不描述既非现状、也未排期的第三种状态。

裁决依据见 [`audits/2026-09-08-UI对照裁决表.md`](audits/2026-09-08-UI对照裁决表.md)（2026-09-08 业主确认，待拍板项按默认取值生效）。

## 1. 真值、适用范围与四原则

### 1.1 真值顺序

1. 已确认的业务不变量、权限、金额、状态机与打印契约（`SPEC-v1.2.md`、`docs/工单变更与版本规则.md`、`docs/加工费计费规则.md`）。
2. 本文。
3. `UI-SYSTEM.md`：设计证据等级、逐页面族的验收记录与门禁说明；与本文冲突时以本文为准并在 `DECISIONS.md` 登记。
4. 原型（`docs/工单列表-管理端.html` 及同系列四份）：只作条款来源，不作逐像素验收基准。

适用目录：`app/`、`components/ui/`、`components/ui-business/`、`components/business/`。打印视图（`app/print/**`、`lib/order/print-layout.tsx`）与导出文件有专门契约时以专门契约为准。

### 1.2 四原则

所有裁决与新条款都回到这四条：

| 原则 | 含义 | 本文落点 |
|---|---|---|
| **事实优先** | 界面只消费服务端给出的事实，不自行计算、推断或猜测金额、状态与日期 | §4.1、§4.3、§4.4、§6 |
| **决定就地** | 后果写在触发它的动作旁，且全流程只写一次，默认位置是确认层 | §5.3、§7 第 2 律 |
| **唯一真相** | 同一事实、同一职责只有一个来源：一个 token、一个 formatter、一个组件、一个 registry | §2、§3、§4、§6 |
| **后果可见** | 提交中、失败、禁用、待核价、估价都必须有文字可见，不靠颜色、Tooltip 或沉默 | §4.3、§5.4、§5.7、§8 |

## 2. 令牌

浅色 `:root` 与 `.dark` 必须成对维护，定义只在 `app/globals.css`。业务代码只写语义 token，不复制 HEX / RGB / OKLCH / Tailwind 调色板字面量，也不在 CSS Module 或对象字面量里重定义 token。门禁见 §10。

### 2.1 颜色

| 角色 | Token | 用途 | 原型对应 |
|---|---|---|---|
| 页面 | `background` / `foreground` | 页面底色（米白）、正文 | `--paper` / `--ink` |
| 容器 | `card`、`popover` 及 foreground | 卡片、面板、弹层（纯白） | `--card` |
| 边框 / 弱底 | `border`、`input`、`muted` | 分隔线、控件边、弱化背景 | `--rule` / `--rule-2` |
| 弱化文字 | `muted-foreground` | 次要信息、帮助文字 | `--mute`（取色相；L 由 0.56 压到 0.53，原型值在米白底与 `bg-muted` 上分别只有 4.4:1 / 4.1:1，达不到 AA） |
| **主强调** | `primary` / `primary-foreground` | 品牌朱红：主动作、当前选中、待工厂核价 | `--seal`（唯一强调色；`--seal-bg` = `bg-primary/10`） |
| 失败 | `destructive` | 删除、取消、确定失败、字段错误 | — |
| 风险 | `warning` / `warning-foreground` | 冲突、部分失败、待办、脏数据、星标 | `--gold` / `--gold-bg`（= `bg-warning/10`） |
| 成功 | `success` / `success-foreground` | 已完成、保存成功、差额下降 | `--ok` |
| 信息 | `info` / `info-foreground` | 进行中、待确认 | — |
| 环境 | `info-neutral` | 仅 `EnvNotice`（开发 / mock / 降级提示），不扩散 | — |
| 图表 | `--chart-1…7`（`var()` 直引） | 色觉友好分类色 | — |
| 导航 | `sidebar-*` | 侧栏表面与选中 | — |
| 焦点 | `ring` | `focus-visible` 焦点圈 | — |

- 全局 `primary` / `background` / `foreground` / `muted-foreground` / `border` / `muted` / `success-foreground` / `warning` 已对齐原型 hex 的 OKLCH 等值（P1-1，2026-09-09，业主目视确认）。
- 不新增 `seal` / `gold` / `ok` 别名；`--color-chart-*` 别名、`--radius-3xl`、`--sidebar-primary-foreground` 已删除（P1-3，2026-09-09）。
- 通用 `Tone` 只允许六档：`primary | warning | info | success | danger | neutral`（`components/ui-business/_tones.ts`）。业务枚举到 Tone 的映射只在 `lib/ui/status-registry.ts` 定义一次。
- 唯一允许的裸色：模拟真实材料外观的色卡数据（纸张、烫金 swatch），登记在附录 A-1。
- 局部强调（如工单详情「当前待办」列的深色主操作）用作用域数据属性 + `Button` 变体里的 `in-data-[emphasis=inverse]:*`，**不得**在 CSS Module 里反转 token：同一 token 在同页出现两个值会让所有引用它的规则跟着错（P2-12 曾因此让拒绝按钮也变深色）。

### 2.2 字号与字重

| 用途 | 类 | 说明 |
|---|---|---|
| 标签、密集表格、辅助信息 | `text-xs`（12px） | 原型 9–11.5px 一律归此档 |
| 正文、表单、列表主文 | `text-sm`（14px） | 原型 12.5–13.5px 一律归此档 |
| 页面正文、师傅端 | `text-base`（16px） | |
| 小标题 / 页面标题 / KPI | `text-lg` / `text-xl` / `text-2xl` / `text-3xl` | |

- 不写 `text-[…]` 任意字号；CSS Module 用 `var(--text-*)`（P1-6 已于 2026-09-09 清除）。
- 字重：正文与标签 `font-medium`，标题与主值 `font-semibold`；`font-extrabold` 仅用于 KPI 数字与工单号；不使用 `font-black`。存量不迁移。
- 侧栏字号由 `AppSidebar` 集中管理（`UI-SYSTEM.md`「后台导航」）。

### 2.3 间距

标准档位：`1`（4px）、`2`（8px）、`3`（12px）、`4`（16px）、`6`（24px）；`0.5`、`1.5`、`5`、`8` 允许但不作默认。

- 不写任意间距 `-[Npx]` / `-[Nrem]`；safe-area 用 `.admin-safe-*` / `.worker-safe-*`（`globals.css`）。P1-5 已于 2026-09-09 清除；唯一保留的表达式是 Sheet 头部为关闭按钮预留的 `pt/pr-[max(…env())]`（附录 A-7）。
- `min-w-[Npx]` / `max-w-[Npx]` 表格与容器宽度、`min-[Npx]:` 容器断点是布局参数，允许，不算漂移。

### 2.4 圆角

`--radius: 0.625rem`；派生 `sm` 6 / `md` 8 / `lg` 10 / `xl` 14 / `2xl` 18px。

| 用途 | 类 |
|---|---|
| 卡片、面板、抽屉 | `rounded-xl` |
| 按钮、输入、菜单项 | `rounded-md` |
| 内嵌小面板、色卡 | `rounded-lg` |
| 药丸、头像、圆点 | `rounded-full` |

不写裸 `rounded`（固定 4px，脱离 `--radius`）、`rounded-[Npx]`；CSS Module 用 `var(--radius-*)`，胶囊与圆用 `9999px` / `50%`（P1-5 已于 2026-09-09 清除）。

### 2.5 阴影

面板 `shadow-sm`，控件 `shadow-xs`，其余 `shadow-none`。任意 `shadow-[…]` 仅限粘性列分隔与底部导航，且必须引用 `var(--border)` / `var(--foreground)`。

### 2.6 视口与安全区

`admin-viewport` / `admin-safe-*`、`worker-viewport` / `worker-safe-*`、`touch-viewport`：动态视口高度（`100vh` → `100svh` → `100dvh`）、44px 触控兜底、安全区。独立页面外壳必须挂其中一个。

### 2.7 例外登记

任意色、字号、圆角、间距只在有 A 级设计证据或必须模拟真实材料外观时允许，并登记于附录 A（文件、原因、浅色/暗色验证）。

## 3. 组件

### 3.1 分层

| 层 | 目录 | 职责 | 禁止 |
|---|---|---|---|
| 页面 / 布局 | `app/` | 取数、授权、路由、页面组合 | 复制状态、格式化、确认层或领域算法 |
| 业务组件 | `components/business/<domain>/` | 工单、计价、账单、薪资等领域组合 | 私建通用按钮、药丸、弹窗、复制反馈、金额函数 |
| 通用业务组件 | `components/ui-business/` | 跨领域状态、反馈、页面信息架构 | 承载某一领域状态机或计费规则 |
| 无业务原子件 | `components/ui/` | 基础控件、主题、键盘和焦点语义 | 读取业务权限、金额或状态 |

业务代码只从 `@/components/ui-business` barrel 引用，不 deep import（P1-4 已于 2026-09-09 清除；门禁 §10）。

### 3.2 原子件（`components/ui/`）

| 场景 | 组件 |
|---|---|
| 动作 | `Button`（原生 `<button>` 只允许在 `global-error.tsx`） |
| 表单 | `Input`、`Textarea`、`Label`、`Checkbox`、`NativeSelect`（新增，**P2-2**；收口前不再复制本地 `selectClass`） |
| 容器 | `Card` 家族；手写卡面允许的唯一字面串是 `rounded-xl border bg-card p-4 shadow-sm`，新代码用 `Card` |
| 提示 | `Alert` 家族 |
| 普通模态 | `Dialog` |
| 高风险确认 | `AlertDialog`（只经 `ConfirmActionDialog` 使用） |
| 抽屉 | `Sheet` |
| 行菜单 | `DropdownMenu` |
| 行内展开 | `Disclosure` |
| 表格 | `Table` 家族（自带可聚焦横滚 region） |
| 导航 | `Sidebar`、`Breadcrumb` |
| 通用状态 | `Badge`（仅非状态标签：计数角标、类型、启停两态）、`Skeleton`、`Tooltip`（辅助，不作唯一载体） |
| 身份 | `Avatar` 家族 |

`Progress` 目前只有契约测试使用，业务进度条用 `AdminOrderDetailView` 的本地实现；两者不冲突，需要通用进度条时优先复用 `Progress`。

### 3.3 通用业务组件（`components/ui-business/`）

| 场景 | 组件 |
|---|---|
| 页面标题 / 入口 | `PageHeader`、`HeroBanner`、`NavCard`、`ActionShortcut` |
| KPI | `StatCard` |
| 领域状态 | `StatusBadge`（§6） |
| 加载 | `ContentSkeleton`（列表数据区，按行数撑高）、`SectionLoading`（Suspense 区块 / 路由 loading 的单块或网格骨架）、`SlowLoadingHint`（两者内置，页面不再单独放） |
| 空态 | `EmptyState`、`TableEmptyState` |
| 错误 | `ErrorState`、`ErrorBoundary` |
| 禁用原因 | `DisabledReason` |
| 提交中 | `PendingButton`、`PendingLink` |
| 操作确认 | `ConfirmActionController` + `ConfirmActionDialog` |
| 操作反馈 | `ActionNotice` |
| 字段反馈 | `FormMessage`、`FormErrorSummary` |
| 批量 / 冲突 | `BatchActionResult`、`ConflictResolutionPanel` |
| 长任务 / 终态 | `LongTaskReceipt`、`TerminalReadOnlyBanner` |
| 环境提示 | `EnvNotice` |
| 横向表格 | `TableScrollArea`（裸 `<table>` 必须包裹） |
| 复制 | `useCopyToClipboard` |

## 4. 格式化

格式化由共享函数产出。页面与组件不得内联 `toFixed`、`Intl.NumberFormat`、带小数位选项的 `toLocaleString` 或日期模板（门禁 §10）。

### 4.1 金额

- 唯一 formatter：`lib/dashboard/format.ts` 的 `formatMoney`，输出 `¥ 1,234.56`（千分位、两位小数、`¥` 后一个空格）；模板内不带币符号用 `formatMoneyPlain`；需要固定四位对齐的单价列用 `lib/format/unit-price.ts` 的 `formatUnitPrice`；费率与阶梯价（每下 / 每板 / 时薪 / 数量档价）用同文件的 `formatRate`（2–4 位小数去尾零，至少两位）。
- 不允许第二个 `formatMoney` / `money` / `formatCurrency` 定义，也不允许 `¥ ${x}` 直拼服务端字符串（P0-1 已于 2026-09-09 清除；门禁 §10 拦截）。差额用 `formatMoneyDelta`。
- 金额列右对齐并 `tabular-nums`。
- 无值用 `—`；未知金额不得显示为 `0`。

### 4.2 数量、日期、尺寸

- 数量千分位：`n.toLocaleString('zh-CN')`（允许，无小数位选项）。
- 日期：`formatDateShanghai` → `YYYY/MM/DD`；日期时间：`formatDateTimeShanghai` → `YYYY/MM/DD HH:mm`；HTML date input 与 URL 日历参数：`formatDateInputShanghai` → `YYYY-MM-DD`；datetime-local：`formatDateTimeLocalShanghai`。均在 `lib/format/dates.ts`。
- `app/` 与 `components/` 不写 `toISOString().slice(0, 10)`（P0-2 已于 2026-09-08 清除）；`lib/` 层对 `@db.Date` 与 `promisedDate`（均存日历日 UTC 零点）的 UTC 切片是数据契约，允许。不重写 Intl 日期实例（P1-10 已于 2026-09-09 清除）。
- 毫米尺寸统一 `宽 × 高 mm`。
- 未知内部枚举显示「未识别配置」，不回显原始 token。

### 4.3 金额三态

所有金额出现位置（列表、只读抽屉、详情、表单侧栏、确认层、预览）表达同一个状态：

| 状态 | 来源 | 展示 | 视觉 |
|---|---|---|---|
| 已确认 | `pricingStatus` 非待确认，且费用行无 `estimated` | `formatMoney` 结果 | 正常前景、主金额权重，不加「估」 |
| 报价 | 任一费用行 `estimated = true` | 金额 + 可见「估」 | 「估」紧邻金额，不能只靠颜色或 Tooltip |
| 待工厂核价 | `pricingStatus = PENDING_ADMIN_CONFIRMATION` | `待工厂核价` | `text-primary`；不显示零金额 |
| 草稿 | `status = DRAFT` | `—` / `未报价` | 中性 |

- 三态只由上表两个服务端事实决定（DECISIONS 2026-09-09）；UI 不得从金额是否为零、空字符串或本地枚举猜测；待工厂核价不是技术失败，不用 `destructive`。
- 唯一实现是 `lib/order/amount-presentation.ts` 的 `orderAmountPresentation`（P2-13，2026-09-09）；列表、卡片、详情费用区都消费它，页面不再自行判断三态。「未报价」「金额不完整」是它的另两个 pending 分支。

### 4.4 价格熄灭

影响报价的字段变化后，旧报价不得保持「当前有效金额」的视觉权重：旧值只能降为 `muted` 参考值，并显示「报价已失效」或「待重新核价」；重算期间展示 pending；不得改成零、透明、只改颜色或静默删除。新报价返回后恢复 quoted 样式与「估」，确认价返回后才切换为 confirmed。

## 5. 交互模式

### 5.1 列表

三族，各有场景：

| 族 | 适用 | 组件 |
|---|---|---|
| A 主数据 CRUD | 字典、账号、采购、BOM、变更审批 | `AdminListToolbar` + `Table` + `AdminSortLink` + `AdminTableCard` + `AdminPagination` |
| B 报表 / 账单 / 薪资裸表 | 列固定、含合计行 | 裸 `<table>` 必须包 `TableScrollArea`（P1-2 / P2-11 已于 2026-09-09 全部完成）；分页用 `AdminPagination`（同页多表用 `pageParam`；P2-5 已完成，唯一豁免见 A-8） |
| C 卡片列表 | 师傅端、工单工作台、销售列表 | `<ul>` 行卡；桌面可扩展为 Table + 卡片双形态 |

- 查询参数解析用 `lib/admin/table.ts`（订单列表用 `lib/order/list-query`）。
- 筛选：GET `<form>`，`action` 可省或指向本路由，两种写法等价。
- 页面 body 不横向溢出；表格内部滚动不等于页面溢出（§8）。

### 5.2 表单提交

- 默认 `<form action={formAction}>` + `useActionState` + 非受控控件；pending 取 `useActionState` 第三个返回值。
- 零 JS 硬约束只有登录、登出、改密码三条（`tests/e2e/no-js.spec.ts`）。其余箭头包裹 / 闭包写法共 14 处是已接受的现状（`DECISIONS.md` 2026-08-17），登记附录 A-5，不迁移。
- react-hook-form 只用于 `OrderForm`（多款动态数组）。

### 5.3 确认：写后果，不写「确定吗」

确认层必须回答：操作哪个对象；哪些事实会变化；哪些不可逆或跨记录；取消后怎样；结果记录到哪里。标题和确认按钮用具体动作（「停用纸张」「发布价格版本」），结构见 §7 第 3 律。

| 级别 | 适用 | 实现 |
|---|---|---|
| L1 | 可逆、低影响 | 直接执行 + `ActionNotice` |
| L2 | 单条记录或明确副作用 | `ConfirmActionController level="L2"` |
| L3 | 金额、薪资、发布、取消、批量、跨记录 | `ConfirmActionController level="L3"`（强制理由） |

- 只有服务端已接受并保存理由时才能要求填写理由；影响清单为空时确认按钮不可用。
- 薪资发放 / 出账 / 批量操作保持 L2（DECISIONS 2026-09-09：对应 action 不保存理由，不得空要理由）；如需审计理由，先补服务端字段再升 L3。
- 禁止 `window.alert` / `window.confirm`（eslint）；禁止 Dialog 套 Dialog、Sheet 上叠编辑 Dialog、用 Sheet 或普通 Dialog 充当确认层（P0-3 已于 2026-09-08 清除）。

### 5.4 操作反馈

不引入 toast 库；反馈就地、页内、可见：

| 场景 | 组件 |
|---|---|
| 操作结果（成功 / 失败 / 警告 / 信息） | `ActionNotice tone`（自带 `role` 与 `aria-live`） |
| 单字段错误 | `FormMessage` + `formMessageA11yProps` 连线 |
| 多字段 / 多款错误摘要 | `FormErrorSummary`（提交失败后获得焦点） |

- 裸 `role="status"` / `role="alert"` / `<p className="text-destructive">` 只允许在 `components/ui-business/` 内部。存量手写不迁移，新代码按上表。
- 失败提示 = 原因 + 恢复动作（§7 第 6 律）。

### 5.5 空态

- 整页 / 区块用 `EmptyState`，表格用 `TableEmptyState`（`variant="table"` 输出合法 `<tr>`）。
- 措辞：「暂无X」，X 为业务名词，无句号，无「还没有」；有筛选条件时「没有匹配的X」并给「清除筛选」动作。`EmptyState` 的 no-data / no-result 默认标题即此口径（P2-8，2026-09-09）；空态下方的引导整句允许带句号。
- 「暂无法预测 / 计算」不是空态措辞，属文案任务（§7）。

### 5.6 错误态

- 路由级：`error.tsx` 一律 `ErrorState`（admin 经 `AdminRouteError`，师傅端已同构，P1-8 2026-09-09）。
- 区块级：`ErrorBoundary` 包裹可独立失败的区块。
- 字段级：见 §5.4 与 §5.10。

### 5.7 禁用与提交中

- 无权限：通常不渲染动作。
- 状态不允许：可 `disabled`，原因用 `DisabledReason cause="status"` 常驻显示。
- 前置条件未满足：`DisabledReason cause="prerequisite"`，有路径时提供「去处理」。
- 普通 disabled 用中性样式，不用红色；Tooltip 不能是唯一原因载体。
- 提交中用 `PendingButton`（锁重复提交、写明动作、拦截导航）→ **P2-3**；无原因 disabled 审计 → **P2-10**。

### 5.8 明细抽屉只读

抽屉允许浏览摘要、状态、款式、金额、收发货事实，复制业务标识，链接到详情、编辑或独立操作页。禁止放完整编辑表单、保存业务记录、再开编辑 Dialog、承载错误摘要 / 离开拦截 / 高风险确认。独立编辑页负责草稿、校验、离开拦截、确认和成功反馈。

- 导出请求表单（创建后台任务，不改业务记录）允许留在抽屉，登记附录 A-3。

### 5.9 复制反馈

图标按钮用「复制工单号 123…」明确 `aria-label`；成功显示「已复制工单号 123…」或「已复制 2 个工单号」；一个交互作用域只保留一个 `role="status" aria-live="polite"`；失败给可行动下一步；反馈不能只改图标颜色。统一走 `useCopyToClipboard`（P2-4，2026-09-09）：文案与失败路径由 hook 产出，页面只渲染一个 `role="status" aria-live="polite"`。

### 5.10 校验错误定位到款

多款工单与动态数组表单同时提供字段错误与错误索引：控件稳定唯一 id；`FormMessage` 与真实控件关联；`FormErrorSummary` 提交失败后获得焦点，label 含款序和字段（「第 2 款（红包 A）· 包装数量」），每项链接到真实控件并展开、滚动、聚焦；款式增删、拖动或复制后错误不得指向另一款；同一错误只 assertive 播报一次。禁止只显示「请检查输入」或只把边框染红。一线表单（订单 / 通知 / 登录 / 薪资）接入 → **P2-6**。

## 6. 状态药丸

- 状态一律 `StatusBadge`；`label + tone` 只在 `lib/ui/status-registry.ts` 定义一次（P2-1 已于 2026-09-09 归并）。
- 允许页面/领域内的**薄封装**（只做 `registry[status]` → `StatusBadge` 的一层转发）；**禁止**本地 label 表、本地 tone 三元、本地 tone 类名表 —— 判据是「这个文件里有没有第二份 label/tone 事实」。多个页面共用同一状态时，薄封装要上提到 `components/business/<domain>/`。
- 状态必须有文字，颜色和圆点只作辅助；未识别值显示「未识别配置」。
- `danger` 只用于失败、取消等非正常终态；正常终态用 `success` 或 `neutral`。
- `Badge` 不承载状态（§3.2）。
- 工单 11 态与销售词表以 `docs/工单变更与版本规则.md` 为准。

<a id="文案与确认"></a>

## 7. 文案与确认

本章与《呈现规范修复任务》共用；禁词表唯一来源是 `scripts/ui-copy/policy.json`。

**文案十律**

1. 界面只陈述事实，不解释机制。实现词（快照、幂等、只读、服务端、迁移、同步、revision）不得出现在用户可见文案
2. 后果写在触发它的动作旁，且全流程只写一次——默认位置是确认层。页头、字段说明不预告后果
3. 确认层结构固定：动作标题（动词短语）→ 实际变更（旧值→新值，含数量/金额/差额）→ 必要后果（仅本次会发生的）→ 按钮文案=动词。禁用"请确认影响范围""执行后会发生以下变化""确定吗"
4. 同一信息不得在页头、表单说明、确认弹窗中重复出现
5. 内部枚举、字段名、表名不得外显：DRAFT→草稿，settledAt→结算时间，DailyWorkerSalary→历史工资记录。映射表随本章维护
6. 失败提示 = 原因 + 恢复动作，不复述规则、不道歉、不解释架构
7. 字段旁只写填写条件（必填、格式、范围），不写操作后果
8. 无值状态用业务词（待核价 / 待录 / 待定），不用系统词（null / 未同步 / 空快照）
9. 前后数值差额直接展示；机制解释只在技术校验失败需要用户理解原因时出现
10. 已有完整复核层的操作不再外套泛化确认弹窗

**禁用模式（反例入册）**：本次审计的共享弹窗固定叠加语、账单页 settledAt/幂等外显、核价页"快照只读服务端"导语……（附文件:行号）

以下行号取自安装规范时的 d742fd0，用于追溯原文，修复后不据此恢复旧文案：

- `components/ui-business/ConfirmActionDialog.tsx:118`：“请确认影响范围”；`:127`：“执行后会发生”。
- `app/(admin)/owner/agent-bills/page.tsx:75`：“仅按 settledAt 上海日历月归集…”；`:102`：“重复执行会幂等同步 DRAFT”。
- `components/business/order/OrderPricingReviewForm.tsx:485`：“仅核对工单已保存的报价快照；自动报价只读，仅补录待人工核价项。”
- `components/business/order/AdminOrderDecisionPanel.tsx:837`：“款式与费用由服务端按最新规则自动合并和重算。”
- `components/business/rules/pricing/CustomerPricingDedicatedSection.tsx:963`：“缺少设计稿规定的 5万档…本区暂时只读”。该处还涉及编辑条件，须另行核对业务规则。

### 业务词映射

| 内部词 | 用户文案 |
|---|---|
| PER_UNIT | 按件计费 |
| DRAFT | 草稿 |
| settledAt | 结算时间 |
| DailyWorkerSalary | 历史工资记录 |
| revision | 版本（仅有业务意义时展示） |
| HourlyWorkerPayroll | 历史时薪记录 |
| ProductionReport | 报工记录 |
| ProductionTask | 生产任务 |
| 同步 | 更新（仅有业务意义时展示） |
| null | 待录 / 待定（按字段） |
| 快照 | 已保存金额 / 历史记录（按业务事实） |
| 只读 | 已归档 / 不可编辑（仅在需要解释状态时） |

管理员诊断、日志、技术文档不属于普通业务流程。若用户可见位置确需技术词，须逐条登记文件、具体原文及必要原因；不得整目录放行。

### 文案门禁与豁免

- `pnpm lint:ui` 使用 TypeScript 语法树检查 JSX 文本、显示属性、toast / 提示、确认内容及其可静态追踪的本地和导入文案。`pnpm lint` 同时执行此检查，CI 的 lint 步骤失败即阻止通过。
- 禁词与精确豁免在 `scripts/ui-copy/policy.json` 维护；白名单必须包含文件、完整原文和必要原因，不允许目录通配或无理由豁免。
- 日志、注释、内部枚举比较、隐藏表单值不属于展示文案；运行时来自数据库或外部服务的内容仍需在展示边界转换业务名称并人工审查，不能将静态检查视为完整语义审计。

## 8. 响应式与可访问性

最低矩阵：375×667、393×852、768×1024、1024×768、1280×800、1920×1080，明暗各一（`playwright.config.ts`）。

- 页面 body 不横向溢出；表格内部滚动不等于页面溢出。
- 触控目标最低 44×44 CSS px（`≤768` 视口门禁失败）；桌面精确指针且视口 >920px 时，工单行内允许 24px 紧凑目标、行尾按钮 32px（`UI-SYSTEM.md`「管理端工单列表」）。
- 视口高度保留 `100vh` 回退，支持时依次 `100svh`、`100dvh`；处理 safe area（§2.6）。
- 长中文、订单号、地址和备注可换行或提供全文访问，不静默裁字（`.admin-wrap-anywhere` / `.worker-wrap-anywhere`）。
- `focus-visible` 焦点圈必须可见且与表面对比 ≥3:1；原子件内部 `ring-2` / `ring-3` / `/50` 差异不作统一要求。
- 保持 heading、label、键盘、焦点陷阱、焦点返回和 reduced-motion 契约；自定义浮层不允许（一律 Base UI Dialog / Sheet / AlertDialog）。
- 图标按钮必须有 `aria-label`。
- 颜色不是唯一信息通道。
- 未经人工确认，不运行 `--update-snapshots` 接受差异。

## 9. 禁止模式

- 页面内新建另一套状态药丸、空态、loading、pending、金额 formatter 或确认层。
- deep import `@/components/ui-business/<file>`。
- Dialog 套 Dialog、Sheet 上叠编辑 Dialog、Sheet 或普通 Dialog 充当确认层、在明细抽屉内保存。
- Tooltip 作为禁用原因、错误或关键指令的唯一载体。
- 用红色表达普通不可用、权限不足、环境信息或正常终态。
- 任意色、调色板字面量、CSS Module 重定义 token、仅适用于浅色的值。
- 无设计证据的任意字号、圆角、间距、sticky offset。
- 原子件已存在时继续直接写原生 `textarea` / `select` / `checkbox`。
- 表格撑破 viewport 或静默裁字。
- 同一复制事件在多个 live region 重复播报。
- UI 自行计算或推断最终金额、薪资、报价、状态流转。
- 用零代替未知金额，用颜色代替「估」或「待工厂核价」文字。
- 显示数据库枚举、字段名、规则 code、JSON key 或内部 ID。
- 为通过测试删除断言、排除 axe 节点、增加任意 sleep 或盲目更新截图。

## 10. 门禁

`pnpm lint` = eslint + 文案门禁 + 令牌门禁，任一失败即阻止。

| 门禁 | 位置 | 规则 | 分级 |
|---|---|---|---|
| Tailwind 调色板字面量、任意色类、`alert`/`confirm`、原生 checkbox | `eslint.config.mjs` `no-restricted-syntax` | 范围 `app/**`、`components/business/**`、`components/ui-business/**` | 全部 error（现状 0 命中） |
| 裸颜色（hex / rgb / hsl / oklch）——含 `.css` 与对象字面量 | `scripts/ui-tokens/check.mjs` 规则 `color`（§2.1） | 范围同上，排除 `globals.css`、`components/ui/` | 登记在 `baseline.json` 的存量 warn；未登记 error；登记项代码消失即 stale error |
| 内联金额格式化、私有 money 函数 | 同上，规则 `money`（§4.1） | `.toFixed(`、`Intl.NumberFormat(`、带小数位/币种选项的 `toLocaleString(`、`function/const formatMoney|money|formatCurrency…` | 同上 |
| ui-business deep import | 同上，规则 `deep`（§3.1） | | 同上 |
| 文案禁词 | `scripts/ui-copy/check.mjs` + `policy.json`（§7） | 语法树追踪的可见文案 | 全仓 error，逐条豁免 |
| 响应式 / 触控 / axe | `tests/visual/ui-gates.ts` | 6 视口 × 明暗；`≤768` 触控 <44 失败；axe wcag2a/2aa/21a/21aa | error |
| 打印像素 | `tests/visual/order-print.spec.ts` | 8 张基线 | error，更新须写进 commit message |

- `baseline.json` 是存量豁免清单（对应附录 A-1 / A-2 / A-6），按「规则 + 文件 + 原文」匹配，不按行号。迁移完成一处必须同时删除对应条目，否则 stale error。重新生成：`pnpm lint:ui:baseline`（只在迁移批次合并时由迁移任务运行，不在功能 PR 里运行）。
- PR 模板 checklist：文案对照 §7、颜色字号对照 §2。

---

## 附录 A · 现状豁免清单

格式：位置 → 违反条款 → 迁移项。lint 可检测的（A-1、A-2、A-6）逐条在 `scripts/ui-tokens/baseline.json`（127 条 / 132 处，2026-09-08）；本表列类别与代表位置，其余按 `file:line` 见 [`UI现状盘点.md`](UI现状盘点.md)。

### A-1 裸颜色（§2.1）

| 位置 | 处数 | 迁移项 / 处置 |
|---|---|---|
| `components/business/order/order-form-b/OrderPaperSwatchPicker.tsx:41-67` | 11 行 31 值 | **永久例外**：纸张材料外观（§2.7），保留在 baseline |
| `components/business/order/order-form-b/OrderFoilSwatchPicker.tsx:48-75` | 9 行 28 值 | **永久例外**：烫金材料外观 |

### A-2 金额格式化（§4.1）

P0-1 已完成，`baseline.json` 的 `money` 待迁移条目为 0；费率与阶梯价已于 2026-09-09 改走 `formatRate`。剩余 `permanent` 登记（各带理由）：用户输入回显（`ShipOrderForm.tsx:23`、`CsPayrollPaymentForm.tsx:71,73`）、图表刻度（`SalesRankingChart.tsx`）、Decimal→字符串序列化传子组件校验、非金额（文件大小、百分比、数量）。

### A-3 抽屉内表单（§5.8）

| 位置 | 处置 |
|---|---|
| `components/business/order/OrderExportControls.tsx:105-238`（导出请求表单） | **豁免**：创建后台任务，不改业务记录 |

### A-4 高风险操作停留 L2（§5.3）

`MarkHourlyPaidForm.tsx:73`、`CsPayrollPaymentForm.tsx:323`、`PieceworkSettlementActions.tsx:54,95,140`、`IssueBillButton.tsx:42`、`AdminOrderBatchActions.tsx:173` → **定案保持 L2**（DECISIONS 2026-09-09）。

### A-5 表单提交写法（§5.2）

箭头包裹 7 处（`GenerateBillsForm.tsx:22`、`IssueBillButton.tsx:37`、`OrderCancellationRequestForm.tsx:59`、`SfCollectToggleForm.tsx:61`、`OutsourceActions.tsx:81,135`、`StartCsPeriodForm.tsx:33`）与 `useActionState` 闭包 7 处（`FinishOrderButton.tsx:19`、`ShipOrderForm.tsx:109`、`IssueBillButton.tsx:29`、`craft/ToggleActiveButton.tsx:22`、`product/ToggleActiveButton.tsx:23`、`ExternalSalesPriceTierGroupEditor.tsx:537`、`account/ToggleActiveButton.tsx:21`） → **接受的现状**（DECISIONS 2026-08-17），不迁移。

### A-6 deep import（§3.1）

已清零（P1-4，2026-09-09）。

### A-7 令牌漂移（§2.2–2.4，lint 不检测）

| 类别 | 处数 | 迁移项 |
|---|---|---|
| Sheet 头部 safe-area 表达式 | `components/business/order/SalesOrdersList.tsx:543,772`（`pt-[max(1rem,env(top))] pr-[max(4rem,calc(3rem+env(right)))]`，为关闭按钮预留） | 布局参数，豁免 |
| CSS Module 非 token 圆角 | `AdminOrderDetailView.module.css:23,90,112`（`50%` / `99px` 胶囊）、`AdminOrderWorkspace.module.css:67`（3px 进度条） | 无对应 token，豁免 |

### A-8 组件重复（§3、§6，lint 不检测）

| 类别 | 处数 | 迁移项 |
|---|---|---|
| 本地 `*Badge` / 第二套 tone | 29 个 + `lib/order/sales-list-presentation.ts:31` | **P2-1** |
| 原生 `<select` + `selectClass` | 68 处 / 39 文件 + 8 份常量 | **P2-2** |
| 裸 `disabled={pending}` 按钮 | 55 处 / 35 文件 | **P2-3** |
| 手写分页 | `components/business/price/RulePriceWorkbench.tsx:905`（翻页链接须走 `PriceWorkspaceLink` 导航拦截，共享分页不支持） | 豁免 |
| 一线表单字段错误未接 `FormMessage` | 12 文件 / 50 处 | **P2-6** |
| 空态引导整句（带句号） | 约 10 处（`background-jobs/page.tsx:90`、`BomForm.tsx:159,160,270`、`SettingsForm.tsx:297` 等） | 允许（§5.5） |
| 手写卡面 284 处 / 112 文件、手写通知块 27 文件、裸 `role=status/alert` | — | **收编**，不迁移（§3.2、§5.4） |
