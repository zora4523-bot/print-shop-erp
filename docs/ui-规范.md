---
status: maintained-audit-profile
owner: project-maintainers
last_verified: 2026-08-28
canonical_source: ../UI-SYSTEM.md
token_implementation: ../app/globals.css
---

# UI 规范

## 1. 真值与适用范围

本文件是 `UI-SYSTEM.md` 的中文执行清单，不建立第二套 UI 真值。

- [`UI-SYSTEM.md`](../UI-SYSTEM.md) 是 UI 系统正源；[`app/globals.css`](../app/globals.css) 是 design token 的实现位置。
- 金额、计费、状态、权限和打印首先服从对应业务真值文档。
- 本文与 `UI-SYSTEM.md` 冲突时，以后者为准并登记冲突。
- 代码与已确认文档冲突时修代码；文档疑似笔误或同级文档冲突时只报告，等待人工裁决。
- `docs/工单变更与版本规则.md` 在 2026-08-28 审查快照中缺失，因此不得在 UI 层猜测工单 11 态、8 个对外词或驳回原因。
- 本规范适用于 `app/`、`components/ui/`、`components/ui-business/` 与 `components/business/`。打印、导出和外部协议有专门契约时，以专门契约为准。

## 2. 组件分层

| 层级 | 目录 | 职责 | 禁止 |
|---|---|---|---|
| 页面 / 布局 | `app/` | 取数、授权、路由、页面组合 | 复制状态、格式化、确认层或领域算法 |
| 业务组件 | `components/business/<domain>/` | 工单、计价、账单、薪资等领域组合 | 私建通用按钮、药丸、弹窗、复制反馈 |
| 通用业务组件 | `components/ui-business/` | 跨领域状态、反馈、页面信息架构 | 承载某一领域状态机或计费规则 |
| 无业务原子件 | `components/ui/` | 基础控件、主题、键盘和焦点语义 | 读取业务权限、金额或状态 |

业务代码统一从 `@/components/ui-business` barrel 引用，不 deep import 内部文件或 tone map。

## 3. Design tokens

浅色 `:root` 与 `.dark` 必须成对维护。业务代码只使用语义 token，不复制 HEX、RGB、OKLCH 或 Tailwind 调色板字面量。

| 类别 | Token / 约定 | 用途 |
|---|---|---|
| 页面 | `background` / `foreground` | 页面底色、正文 |
| 容器 | `card`、`popover` 及对应 foreground | 卡片、面板、弹层 |
| 主操作 | `primary` / `primary-foreground` | 品牌动作、当前选中 |
| 次要信息 | `secondary`、`muted`、`accent` | 次操作、帮助、弱化内容 |
| 失败 | `destructive` | 删除、取消、确定失败、字段错误 |
| 风险 | `warning` | 冲突、部分失败、需注意 |
| 成功 | `success` | 已完成、保存成功 |
| 信息 | `info` | 进行中、普通信息 |
| 环境信息 | `info-neutral` | 开发、mock、降级、运维提示 |
| 图表 | `chart-1`…`chart-7` | 色觉友好的分类图表 |
| 导航 | `sidebar-*` | 侧栏表面、选中、边框、焦点 |
| 焦点 | `ring` | `focus-visible` 焦点圈 |
| 圆角 | `--radius: 0.625rem`，派生 `sm`…`4xl` | 控件、面板、弹层 |
| 字体 | `font-sans`、`font-mono`、`font-heading` | 正文、编号、标题 |
| 字号 | 标准 `text-xs`…`text-2xl` | 信息层级 |
| 间距 | Tailwind 标准 spacing scale | gap、padding、margin |
| 视口 / 安全区 | `admin-viewport` / `admin-safe-*`、`worker-viewport` / `worker-safe-*`、`touch-viewport` | 动态视口、触控目标、安全区 |

通用 `Tone` 只允许：

```text
primary | warning | info | success | danger | neutral
```

任意色、字号、圆角、间距只在有 A 级设计证据或必须模拟真实材料外观时允许，并须登记来源、适用边界及浅色/暗色验证结果。

## 4. 通用组件

### 4.1 无业务原子件

| 场景 | 组件 |
|---|---|
| 动作 | `Button` |
| 表单 | `Input`、`Textarea`、`Label` |
| 容器 | `Card` 家族 |
| 提示 | `Alert` 家族 |
| 普通模态 | `Dialog` |
| 高风险确认 | `AlertDialog` |
| 抽屉 | `Sheet` |
| 行菜单 | `DropdownMenu` |
| 行内展开 | `Disclosure` |
| 进度 | `Progress` |
| 表格 | `Table` 家族 |
| 导航 | `Sidebar`、`Breadcrumb` |
| 通用状态 | `Badge`、`Skeleton`、`Tooltip` |
| 身份 / 组合头像 | `Avatar` 家族 |

当前没有统一 Select 原子件。新增选择器前先确定共享 `NativeSelect` 或 Select 方案，不继续复制本地 class string。

### 4.2 通用业务组件

| 场景 | 组件 |
|---|---|
| 页面标题 / 入口 | `PageHeader`、`HeroBanner`、`NavCard`、`ActionShortcut` |
| KPI | `StatCard` |
| 领域状态 | `StatusBadge` |
| 加载 | `ContentSkeleton`、`SlowLoadingHint` |
| 空态 | `EmptyState`、`TableEmptyState` |
| 错误 | `ErrorState`、`ErrorBoundary` |
| 禁用原因 | `DisabledReason` |
| 提交中 | `PendingButton`、`PendingLink` |
| 操作确认 | `ConfirmActionDialog` |
| 操作反馈 | `ActionNotice` |
| 字段反馈 | `FormMessage`、`FormErrorSummary` |
| 批量 / 冲突 | `BatchActionResult`、`ConflictResolutionPanel` |
| 长任务 / 终态 | `LongTaskReceipt`、`TerminalReadOnlyBanner` |
| 环境提示 | `EnvNotice` |
| 横向表格 | `TableScrollArea` |

复制交互目前没有共享组件，是本轮确认的实施缺口。

## 5. 格式化

格式化必须由共享函数产出。页面不得内联 `Intl.NumberFormat`、`toFixed` 或日期模板。

- 人民币使用千分位和固定两位小数；币符号位置及空格由唯一共享 formatter 决定，本文件不另立第二口径。
- 金额列右对齐并使用 `tabular-nums`；数量使用千分位。
- 用户可见日期调用 `formatDateShanghai`，当前输出 `YYYY/MM/DD`；日期时间调用 `formatDateTimeShanghai`，当前输出 `YYYY/MM/DD HH:mm`。
- HTML date input 与 URL 日历参数调用 `formatDateInputShanghai`，输出 `YYYY-MM-DD`。
- 毫米尺寸统一为 `宽 × 高 mm`。
- 无值使用 `—`；未知金额不得显示为 `0`。
- 未知内部枚举显示“未识别配置”，不回显原始 token。

## 6. 金额三态

所有金额出现位置必须表达同一个状态，包括列表、只读抽屉、详情、表单侧栏、确认层和预览。

| 状态 | 目标来源 | 展示 | 视觉 |
|---|---|---|---|
| 已确认 | `confirmedFee` | 共享 formatter 产出的金额 | 正常前景、主金额权重，不加“估” |
| 报价 | `quotedFee` | 格式化金额 + 可见“估” | “估”紧邻金额，不能只靠颜色或 Tooltip |
| 待核价 | 两者均无 | `待核价` | 朱红品牌强调，例如 `text-primary`；不得显示零金额 |

规则：

- `confirmedFee` 存在时不得按 quoted 状态展示。
- UI 不得从金额是否为零、空字符串或本地枚举猜测三态。
- 待核价不是技术失败；没有真实失败时不用 `destructive`。
- UI 只消费服务端提供的金额和状态，不计算最终金额。

### 当前实施缺口

本轮未发现统一的 `confirmedFee` / `quotedFee` 数据契约。现有页面主要依赖 `pricingStatus`、`totalAmount` 与多类费用字段；销售专用列表/详情已部分表达“估”和朱红待核价，但通用列表、创建侧栏和确认层仍未统一。

因此上表是目标展示契约，不代表仓库已经实现。闭合前须人工确认 DTO、历史数据映射、列表/详情/打印/导出范围及允许提交的状态；不得由 UI 临时推断，也不得顺手修改 schema、计费或状态流转。

## 7. 价格熄灭

任何会影响报价的字段发生变化后，旧报价不得继续保持“当前有效金额”的视觉权重。

- 旧金额如需保留，只能作为参考值降为 `muted`。
- 同时显示“报价已失效”或“待重新核价”等文字状态。
- 重新核价期间展示 pending，不得把旧值提交成当前价。
- 熄灭不是改成零、透明、只改变颜色或静默删除历史值。
- 新报价返回后恢复 quoted 样式和“估”；确认价返回后才切换为 confirmed。

具体文案需与恢复后的金额和状态真值统一。

## 8. 状态药丸

- 使用 `StatusBadge`；业务枚举的 `label + tone` 只在集中 registry 中定义一次。
- 状态必须有文字，颜色和圆点只作辅助。
- 未识别值显示“未识别配置”。
- `danger` 只用于失败、取消等非正常终态；正常终态使用 `success` 或 `neutral`。
- 页面不得定义私有 `StatusBadge` 或本地 tone class map。
- 工单状态必须等待 `docs/工单变更与版本规则.md` 恢复后逐项核对。

## 9. 确认弹窗：写后果，不写“确定吗”

确认层必须回答：

1. 正在操作哪个对象；
2. 执行后哪些事实会变化；
3. 哪些影响不可逆或会跨记录；
4. 取消后会怎样；
5. 结果记录到哪里。

标题和确认按钮使用具体动作，例如“停用纸张”“发布价格版本”“拒绝修改申请”，不得使用“提示”“确认”“确定吗”。

- L1：可逆、低影响，可直接执行并反馈。
- L2：影响单条记录或有明确副作用，列对象、变化和取消路径。
- L3：金额、薪资、发布、取消、批量或跨记录影响，列范围、不可逆点、理由/确认字段及审计结果。
- 只有服务端已接受并保存理由时才能要求填写理由。
- 影响清单为空时确认按钮不可用。
- 禁止 `window.alert` / `window.confirm`。
- 禁止 Dialog 套 Dialog，也禁止 Sheet 上叠加编辑 Dialog。

## 10. 校验错误定位到款

多款工单和动态数组表单必须同时提供字段错误与错误索引。

- 控件使用稳定唯一 id；`FormMessage` 与真实控件关联。
- `FormErrorSummary` 在提交失败后获得焦点。
- 摘要 label 包含款序和字段，例如“第 2 款（红包 A）· 包装数量”。
- 每一项链接到真实控件；点击后展开所属款、滚动并聚焦。
- 款式增删、拖动或复制后，错误不得指向另一款。
- 同一错误只 assertive 播报一次。
- 禁止只显示“请检查输入”，也禁止只把边框染红。

## 11. 复制反馈

- 图标按钮使用“复制工单号 123…”等明确 `aria-label`。
- 成功显示“已复制工单号 123…”或“已复制 2 个工单号”。
- 一个交互作用域只保留一个 `role="status" aria-live="polite"`。
- 失败给出可行动下一步，例如手动选择复制或检查剪贴板权限。
- 反馈不能只改变图标颜色。
- 同类复制逻辑应抽成共享 hook/组件。

## 12. 明细抽屉只读，编辑进入独立页面

这是项目固定规则，优先于历史原型中的抽屉编辑方案。

明细抽屉允许浏览摘要、状态、款式、金额、收货/发货事实，复制业务标识，并通过链接进入详情、编辑或独立操作页。

明细抽屉禁止：

- 放置完整编辑表单或保存业务记录；
- 再打开编辑 Dialog；
- 承载需要错误摘要、离开拦截或高风险确认的流程。

独立编辑页负责草稿、校验、离开拦截、确认和成功反馈。

## 13. 禁用状态

- 无权限：通常不渲染动作。
- 状态不允许：动作可 disabled，但原因常驻显示。
- 前置条件未满足：显示原因，并在有明确路径时提供“去处理”。
- 普通 disabled 使用中性样式，不使用红色。
- Tooltip 不能是唯一原因载体。
- 提交中使用 `PendingButton`，锁定重复提交并写明动作。

## 14. 响应式与可访问性

最低矩阵：375×667、393×852、768×1024、1024×768、1280×800、1920×1080。

- 页面 body 不横向溢出；表格内部滚动不等于页面溢出。
- 手机交互目标最低 44×44 CSS px；视口高度保留 `100vh` 回退，支持时依次采用 `100svh`、`100dvh`，并处理 safe area。
- 长中文、订单号、地址和备注可换行或提供全文访问，不静默裁字。
- 保持 heading、label、键盘、焦点陷阱、焦点返回和 reduced-motion 契约。
- 颜色不是唯一信息通道。
- 未经人工确认，不运行 `--update-snapshots` 接受差异。

## 15. 禁止模式

- 页面内新建另一套状态药丸、空态、loading、pending、金额 formatter 或确认层。
- deep import `@/components/ui-business/<file>`。
- Dialog 套 Dialog、Sheet 上叠编辑 Dialog，或在明细抽屉内保存。
- Tooltip 作为禁用原因、错误或关键指令的唯一载体。
- 用红色表达普通不可用、权限不足、环境信息或正常终态。
- 用任意色、调色板字面量或仅适用于浅色的值。
- 无设计证据使用任意字号、圆角、间距和 sticky offset。
- 原子件已存在时继续直接写原生 `textarea`。
- Select 方案未收口前继续复制本地 select 样式。
- 表格撑破 viewport 或静默裁字。
- 同一复制事件在多个 live region 重复播报。
- UI 自行计算或推断最终金额、薪资、报价、状态流转。
- 用零代替未知金额，用颜色代替“估”或“待核价”文字。
- 显示数据库枚举、字段名、规则 code、JSON key 或内部 ID。
- 为通过测试删除断言、排除 axe 节点、增加任意 sleep 或盲目更新截图。

## 16. 本轮反例与实施缺口

| 反例 / 缺口 | 证据 | 处置 |
|---|---|---|
| 通用业务组件 deep import | `components/business/rules/pricing/PriceDataBoundary.tsx` | 本轮已改从 barrel 引用 |
| 页面私建状态药丸 | 工单、账单、通知、生产、薪资等多处本地 `*StatusBadge` | 状态正源恢复后逐域迁移 |
| 复制反馈重复播报 | `SalesOrdersList.tsx` 页面根部和 Sheet 内各有 live region | 保留单一反馈出口 |
| 金额三态没有统一数据契约 | 无统一 `confirmedFee` / `quotedFee` | 人工确认 DTO 与历史映射 |
| 报价失效仍可能保持旧金额 | 包装组成清空时存在旧袋数/旧报价路径 | 先补 fixture，再修报价行为 |
| 金额 formatter 重复 | 多处 `toFixed`、`Intl.NumberFormat`、币符号模板 | 核对打印/导出契约后集中实现 |
| 卡片 surface 与原生控件重复 | 多页面手写 Card、`textarea`、`select` | 明确共享边界后分批迁移 |
| 任意字号、圆角和间距 | 规则工作台与工单表单存在 `text-[…]`、`rounded-[…]` | 登记 A 级例外或收敛到 scale |
| 材质色板使用 HEX/渐变 | 纸张、烫金 swatch picker | 人工决定是否登记材料外观例外 |
| 独立页面未使用统一动态视口高度 | `app/(auth)/login/layout.tsx`、`app/account/password/page.tsx` 只有 `min-h-screen` | 迁移到统一 viewport shell 并补移动端视觉门禁 |
| 高风险业务仍使用 L2 | 主数据启停、部分薪资动作、工单修改审批 | 先确认服务端理由/审计契约 |
| 工单详情职责过重 | `app/(admin)/orders/[id]/page.tsx` 超过 1800 行 | 仅作架构重构建议 |
| 工单状态无法按正源核对 | `docs/工单变更与版本规则.md` 缺失 | 恢复文档后核对 11 态、8 词和驳回原因 |

当前可保留的正例：销售工单列表 Sheet 以只读明细为主，编辑和业务操作通过链接进入独立页面；后续不得退回抽屉编辑。
