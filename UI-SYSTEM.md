---
status: maintained
owner: project-maintainers
last_verified: 2026-08-26
applies_to: repository UI implementation and design evidence at last_verified
---

# UI 系统与 UX 规范

本文是当前项目 UI 实现规范。它规定设计证据、组件边界、状态反馈、颜色、响应式、可访问性和视觉验收；不把尚未逐页验证的界面写成“已按设计稿完成”。

## 设计证据与优先级

设计资料入口是 [`docs/ux-redesign/README.md`](./docs/ux-redesign/README.md)，逐页面族的证据和验证边界记录在 [`docs/UI-DESIGN-COVERAGE.md`](./docs/UI-DESIGN-COVERAGE.md)。发生冲突时按以下顺序判断：

1. 已确认的业务不变量、权限、金额、状态机和打印契约；
2. 同一页面最新、证据最完整的高保真或交互稿；
3. 全站交互/状态规范；
4. 线框和推断页；
5. 现有页面样式，仅作为迁移起点。

早期 `收费项目工作台 重设计.dc.html` 的 Industry 皮肤已经被后续设计取代；定价以
`批次五 价格与报价 交互稿.dc.html` 的现有 shadcn 皮肤版为准。不能把“包中有 85 页”理解为 85 个页面都有同等级高保真证据。

### 证据等级

| 等级 | 定义 | 可以声称什么 |
|---|---|---|
| A：直接对照 | 有当前版本高保真/交互稿，且逐区块核对实现、状态和窄屏行为 | 该页面在已核对范围对齐 |
| B：契约对照 | 有页面线框或明确交互契约，但缺完整当前实屏 | 结构与交互契约对齐，不声称像素还原 |
| C：系统收口 | 只有领域推断或共享规范 | 组件、主题、响应式与可访问性统一，不声称按实屏稿设计 |

任何页面交付记录都应标注证据等级、设计文件、覆盖状态、视口和人工审查结果。

## 业务语言与技术标识可见性

管理后台默认面向业务用户，而不是数据库或规则引擎的调试界面。

- 可见文本、无障碍名称和表单提示中，不得直接展示数据库枚举值、字段名、规则 code、JSON key / 公式 DSL、内部 ID、哈希、导入单元格范围或英文匹配操作符。
- 内部值可继续存在于数据库、服务端、日志、URL、React key 与表单 `value`，但必须通过集中映射显示稳定的中文业务名称。未知值显示“未识别配置”，不回显原始 token。
- 工单号、SKU、物料/仓库编码、审批编号和版本号是业务标识，允许展示；有业务名称时，编码降为次要信息。
- 同一业务事实只设一个主展示位置。列表只显示当前决策所需字段；低频适用条件默认折叠；纯诊断信息必须另有权限、显式开启且只显示白名单字段。
- UI 测试应检查可见文本以及 `aria-label` / `title` / `alt` / `placeholder`，不应因为合法的 `value` / `href` / `data-*` 含有内部值而误报。

### 界面文案只陈述事实和后果

界面不是业务概念说明书。用户已经能从标题、字段和值看懂的内容，不再用副标题、第二行灰字或提示重复解释。

- 保留：字段名称与当前值、状态、数量、金额、适用范围、输入限制、权限结果、保存范围、不可逆影响、价格或生产后果，以及解除阻断所需的下一步。
- 删除：概念定义、模块存在原因、实现背景、数据来源解释、内部兼容说明、同义反复，以及“这是收费项目”“该分类不是工艺”这类对可见事实的再次解说。
- 同一事实在同一区域只展示一次。主值与次值相同时只显示主值；分组标题已经表达含义时，不再附加泛化类目。
- 页面副标题最多一句，只回答“这里有哪些事实”或“本操作会产生什么后果”。无法满足这两个条件时不显示副标题。
- 表单帮助只写格式、边界、必填条件或保存后果；示例可以保留，但不得夹带业务概念教学。
- 错误、警告和高风险确认不受“少文案”影响，仍必须明确指出失败原因、影响范围和可执行下一步。

例如：报价 SKU 页的“统一维护三条计价路线并说明分类用途”直接删除，由标题和表头表达事实；列表中“空白现货 / 空白现货”只显示一次；“160g 艳闪 / 红卡”下不再重复显示“基础加工费”。

## 组件分层

```text
components/ui/
  无业务语义的原子控件

components/ui-business/
  状态、反馈、页面信息架构和业务语义外观

components/business/<domain>/
  工单、定价、薪资等领域组合

app/
  取数、授权和页面组合；不复制共享视觉模式
```

业务代码统一从 `@/components/ui-business` barrel 引用共享业务组件。不要 deep import 后依赖内部样式 map。

### 工单处理抽屉

- 抽屉以用户提供的 `工单列表-管理端 (1).html` 为布局参考：所有视口使用 `min(480px, 100vw)` 宽度，卡片白底（深色主题成对适配），页头与正文左右留白 20px。标题 16px/800、元信息 11.5px/600，区块标题使用细分隔线。
- 内容按“待你处理 → 简化金额 → 按需折叠进度 → 操作”排列；申请原因和变更预览置于同一张处理卡片，不叠加重复外框。查看完整工单、下载 PDF、复制链接和可编辑入口放在滚动正文末尾，不固定占据底部；基本信息、全部款式和动态由完整工单页承载。
- `AdminOrderDrawer.module.css` 限定抽屉的局部明暗 token 与尺寸。遮罩浅色为 34% 深色且不模糊，面板从右侧完整滑入（240ms）；减少动态效果时取消过渡，不改变其他 Sheet 的默认样式。抽屉操作保持 44px 触控目标，批准使用深色、拒绝使用红色，修改申请左右等宽排列；运费编辑在抽屉内单列排列。
- 修改申请使用精简审批视图：金额只展示一次，费用明细和拒绝备注默认折叠，待补齐或未重新预览通过的运费自动展开。版费未核定、计价未完成、审批失败与并发冲突保持可见，不改变金额口径、重新预览及服务端审批校验。
- 存在修改申请时不同时展示工厂确认按钮或确认预检；批准和拒绝继续使用现有确认流程。批准按钮固定为“批准变更”，禁用原因单独显示；待审批申请隐藏编辑入口，其余可编辑状态显示“编辑工单”。
- `AdminOrderDrawerLayout.browser.spec.tsx` 验证六视口明暗主题、尺寸留白、触控、溢出、axe、正文滚动与操作区位置，以及关闭按钮、Esc、遮罩和焦点恢复；加载和错误状态沿用同一抽屉外壳。

### 管理端工单操作补齐

- 取消审批须先按当前已产数量取得参考价，再展示明确的最终结算金额与已有调整理由；数量改变、预览失败或工单版本变化时旧预览失效。确认、下发、结算及原因类裁决使用共享影响确认层，沿用现有业务字段，不新增未保存的理由。
- 抽屉按需展开现有核价、物流费用确认与逐票发货表单；已确定费用默认收起，核价定位链接只滚动抽屉，不覆盖 `#wo=`。所有金额计算、四版本与幂等校验沿用既有服务端契约。
- 已驳回/待补正使用真实状态筛选，保留一句原因；变更摘要显示已校验的前后事实。暂无工单与筛选无结果分别提供切换队列、清除筛选路径；管理员使用看板和卡片形态的专用骨架。
- 批量操作先显示适用数量与逐单影响，再提交确认时的对象/版本；完整回执位于列表选择器之外，工单移出队列仍可查看。`BatchActionResult` 可选 `summary` 与 `skipped / unknown / not-attempted` 表达跳过、结果未知和未执行；未知结果先核对，不能当作已失败直接重复提交。
- 复制、星标、裁决使用可见的 `ActionNotice`；提交中锁定重复操作。业务阻断使用 `DisabledReason` 给出原因及处理路径。保持六视口明暗、44px 表单/列表外操作、桌面列表紧凑目标、无溢出及键盘焦点规范。
- 本批按 B 级交互契约核对，以用户 HTML 的操作入口及本规范为依据；浏览器组件测试覆盖列表、抽屉、内嵌表单、关键确认和批量结果。实屏查看本地工单列表，不以测试通过代替所有业务状态的像素验收。

## 设计 token

token 位于 [`app/globals.css`](./app/globals.css)，浅色 `:root` 与 `.dark` 必须成对维护。

| Token | 用途 |
|---|---|
| `background` / `foreground` | 页面底色与正文 |
| `card` / `card-foreground` | 卡片、面板 |
| `primary` | 品牌主操作、当前选中 |
| `secondary` / `muted` | 中性次要操作、弱化区 |
| `destructive` | 删除、取消、确定失败、字段错误 |
| `warning` | 风险、冲突、部分失败、需注意但未失败 |
| `success` | 已成功、已完成、正向结果 |
| `info` | 进行中、普通信息 |
| `info-neutral` | 环境或运维类中性信息 |
| `chart-1`…`chart-7` | 色觉友好的分类图表色 |
| `sidebar-*` | 导航专用表面与状态 |

业务页面禁止 `bg-red-50`、`text-emerald-600`、`bg-[#...]` 等调色板或任意色字面量。使用 `bg-warning/10`、`text-success-foreground`、`border-info/40` 等语义类；[`eslint.config.mjs`](./eslint.config.mjs) 会守门。

### 红色使用规则

红色只用于：

- 破坏性操作；
- 已确定的技术/业务失败；
- 字段校验错误；
- 取消等非正常终态。

权限不足、前置条件未满足、普通 disabled、终态只读和开发环境提示都不使用红色。风险或冲突使用 warning，中性只读使用 muted。

### Tone

`Tone` 只有 `primary | warning | info | success | danger | neutral`。业务枚举到 tone/label 的映射集中维护；页面不重复声明本地 `StatusBadge`。状态还必须有文本，不能只靠颜色区分。

## 基础组件

基础原子件位于 [`components/ui/`](./components/ui/)：

| 需求 | 组件 | 使用约束 |
|---|---|---|
| 主要/次要/破坏性动作 | `Button` | 使用 variant；disabled 必须有可感知原因 |
| 表单单行/多行 | `Input`、`Textarea`、`Label` | 控件与 label、help、error 用 id 关联 |
| 内容容器 | `Card` 及 Header/Title/Description/Action/Content/Footer | 不再手写重复的 border/radius/bg/shadow 组合；`CardTitle` 是 `div`，调用方负责页面 heading 层级 |
| 静态或动态提示 | `Alert`、`AlertTitle`、`AlertDescription` | variant 使用语义色；默认 `role=alert`，静态说明必须覆盖为 `note` 或 `status`；Title 是 `div`，不自动创建 heading |
| 普通模态流程 | `Dialog` 组合 | 用于可取消的查看/编辑；依赖 Base UI 管理 focus trap、Escape 和焦点返回 |
| 高风险确认 | `AlertDialog` 组合 | 必须有明确取消和确认；无右上角关闭；确认文案写具体动作，破坏性使用 destructive variant |
| 抽屉 | `Sheet` | 窄屏导航或次级内容，不替代确认层 |
| 行内菜单 | `DropdownMenu` | 表格行“更多”动作；键盘和焦点语义必须保留 |
| 进度 | `Progress` | `value` 为 `number | null`；调用方必须给 `aria-label` 或 `aria-labelledby` |
| 数据表格 | `Table` + `TableScrollArea` | 桌面表格必须有横滚/边缘提示，窄屏按任务密度决定卡片降级 |
| 导航 | `Sidebar`、`Breadcrumb` | 保持折叠、当前项、面包屑降级和手机抽屉契约 |
| 通用状态 | `Badge`、`Skeleton`、`Tooltip` | Tooltip 只补充信息，不能承载唯一禁用原因或关键指令 |

所有新增原子件使用 `data-slot`、语义 token、可见 `focus-visible` 和 reduced-motion 处理。不要绕开组件直接调用 Base UI primitive，除非正在维护该原子件。

## 共享状态与反馈

共享实现位于 [`components/ui-business/`](./components/ui-business/)。

| 场景 | 组件 | 核心契约 |
|---|---|---|
| 数据加载 | `ContentSkeleton` | 只为数据区画骨架，保留页头/筛选；行数接近最终内容，8 秒后给慢加载提示 |
| 页面空态 | `EmptyState` | 明确区分 `no-data`、`no-result`、`no-access`，各自提供创建、清除筛选或返回路径 |
| 表格/局部空态 | `TableEmptyState` | `table` 形态输出合法 `tr/td` 且给正确 `colSpan`；移动卡片使用 `compact` |
| 技术错误/业务阻断 | `ErrorState` | 技术错误用 destructive + retry；前置阻断用 warning + 解除路径 |
| 分区错误隔离 | `ErrorBoundary` | 关键独立区块或路由使用，未知错误交给边界和监控 |
| 禁用原因 | `DisabledReason` | permission 直接不渲染；status/prerequisite 常驻显示中性原因，前置条件可给修复入口 |
| 提交中 | `PendingButton` | 锁定重复提交、显示具体 pending 文案、设置 form `aria-busy`；不要为普通查询使用 |
| 操作确认 | `ConfirmActionDialog` | L2 必须列真实影响；L3 还必须提交 1–500 字理由；关闭后恢复触发器焦点，不能用原生 `alert/confirm` |
| 操作结果 | `ActionNotice` | success/info/warning 礼貌播报；只有 error 使用 assertive alert/destructive |
| 字段提示 | `FormMessage` | 使用 `fieldId` 与 `formMessageA11yProps` 建立 `aria-describedby` / `aria-errormessage` |
| 表单错误索引 | `FormErrorSummary` | 提交失败后可聚焦，逐项链接到真实控件 id；错误为空时不渲染 |
| 批量结果 | `BatchActionResult` | `complete/partial/failure`，显示成功/失败数；失败项必须有可行动原因 |
| 并发冲突 | `ConflictResolutionPanel` | 同时展示“我的版本/最新版本”和三种明确动作；绝不自动覆盖 |
| 长任务 | `LongTaskReceipt` | 提供回执 id、状态、剩余有效期、历史与同条件重试；失败和过期不是同一状态 |
| 终态只读 | `TerminalReadOnlyBanner` | 中性说明终态、后续路径和审计连续性，不染红 |
| 环境提示 | `EnvNotice` | 开发、mock、降级等环境信息与业务风险分色 |
| 领域状态 | `StatusBadge` | 由 [`lib/ui/status-registry.ts`](./lib/ui/status-registry.ts) 的集中映射提供 label + tone；进行中可带 dot，仍保留文字 |
| 横向表格 | `TableScrollArea` | 暴露滚动可能性与边缘状态，不允许 table 撑破 body |

### 五态最低要求

每个需要异步数据或提交的页面，至少设计并验证：

1. Loading：页面框架立即出现，数据区骨架不造成大幅布局跳动。
2. Empty：区分无数据、无结果、无权限，不把三者写成同一句“暂无数据”。
3. Error：区分技术失败与可解除业务阻断，提供下一步。
4. Disabled：中性、常驻原因；权限不足通常不展示不可用动作。
5. Pending：防重复提交，明确当前动作和等待结果。

涉及并发、批量、长任务或终态时，再增加对应状态。成功反馈也必须明确，不能只把按钮恢复原样。

## 确认等级

| 等级 | 使用场景 | UI 要求 |
|---|---|---|
| L1 | 可逆、低影响、结果立即可见 | 直接执行或轻量确认，成功后给反馈 |
| L2 | 影响单条业务记录或有明确副作用 | `AlertDialog` 列出对象、变化和取消路径 |
| L3 | 金额、薪资、发布、取消、批量或跨记录影响 | 列影响范围、不可逆点、理由/确认字段（仅当业务已有）、审计结果；确认文案使用动作名 |

确认层不能创造服务端尚不存在的字段或权限。设计要求超出现有契约时记录为缺口，不能在 UI 层伪造已保存。禁止新增 `window.alert` / `window.confirm`；现存调用按风险逐步迁移到共享 Dialog。

## 页面骨架

### ListPageShell 模式

```text
PageHeader + 主操作
筛选 / 搜索 / 已启用条件
结果数 / 保存视图
桌面表格 | 手机卡片
选择后的批量操作条
分页 / 加载更多
```

- URL 是筛选和分页的事实源；返回列表时恢复筛选、选中和滚动位置。
- 桌面可使用 sticky 表头/关键列，但必须有实际 inset；手机优先呈现任务所需字段。
- 行操作使用可见主动作加 `DropdownMenu`，不要在每行堆满按钮。
- 批量动作在选择后出现，并用 `BatchActionResult` 返回逐项结果。

### DetailPageShell 模式

```text
Breadcrumb
PageHeader + StatusBadge + 顶部/吸底动作
关键摘要
时间线 / 详情分区
审计、终态只读或后续路径
```

- 高风险动作进入 L2/L3；终态使用 `TerminalReadOnlyBanner`。
- 长详情分区可折叠，但不可隐藏影响操作决策的信息。
- 手机主操作放在拇指可达位置，并处理 safe-area。

### FormPageShell 模式

```text
PageHeader
分阶段/分区表单
字段 hint / error
摘要、缺口和影响范围
自动草稿/保存状态
固定操作区
```

- `Label`、控件、`FormMessage` 使用稳定 id；提交失败聚焦 `FormErrorSummary` 或首个错误。
- 依赖条件、保存范围、自动草稿和整组原子性必须写出来。
- 数字用 `tabular-nums`，金额右对齐；服务端是唯一计算源。

这些是模式，不要求立刻引入名为 `ListPageShell` 的万能组件。先抽稳定、重复且测试充分的组成部分，避免用一个 props 巨型组件隐藏领域差异。

## 响应式与跨设备

最低验证矩阵：375×667、393×852、768×1024、1024×768、1280×800、1920×1080。

- 页面 body 不得横向溢出；表格内部滚动不等于页面溢出。
- 移动端交互目标最低 44×44 CSS px；桌面紧凑尺寸不能污染手机。
- 手机使用 `dvh`，保留 `vh/svh` 回退；固定区域处理 `safe-area-inset-*`。
- 长中文、订单号、地址和备注可换行或显式提供全文访问，不允许静默 `overflow-hidden`。
- sticky 元素必须有 top/bottom inset，且不能覆盖页面末尾内容。
- 图表在 375px 不裁切标签，不能只靠缩小字体解决。
- 桌面表格降级成手机卡片时，操作、状态和关键标识必须仍可见。
- 新 CSS 特性先核对目标浏览器支持，并用 `@supports` 或基础布局提供回退。

## 可访问性

- 保持页面 heading 层级；`CardTitle` / `AlertTitle` 不自动提供 heading 语义。
- 所有控件有可访问名称；图标按钮不能只靠视觉图标。
- 错误与提示关联到字段；动态结果使用适当的 `role` 和 `aria-live`，避免把静态内容都设为 assertive。
- 模态层保持焦点圈、焦点陷阱、Escape（普通 Dialog）、显式取消（AlertDialog）和关闭后的焦点返回。
- 键盘操作必须覆盖菜单、表单、表格操作与导航。
- focus-visible 不被 sticky、overflow 或 outline clip 裁掉。
- 尊重 `prefers-reduced-motion`；主题切换不能让 axe 捕获到低对比过渡中间态。
- 颜色不是唯一信息通道；状态、图表和校验都需要文字、图标或形状辅助。

## 视觉验证

| 门禁 | 当前覆盖 | 能证明 | 不能证明 |
|---|---|---|---|
| `tests/visual/order-print.spec.ts` | 8 个打印 fixture 像素基线 | 相同环境下打印布局未发生非预期像素变化 | Web 全站与设计稿一致 |
| `tests/visual/admin-responsive.spec.ts` | 六视口、light/dark、geometry、touch、axe | 被覆盖管理页面不触发已定义的裁切/无障碍门禁 | 与 `.dc.html` 自动像素匹配 |
| `tests/visual/worker-responsive.spec.ts` | 六视口、light/dark、七条路由、geometry、touch、axe | 被覆盖师傅端路由满足当前门禁 | 所有师傅端业务状态已逐像素审查 |
| `/dev/showcase` | 人工组件检查 | token、状态和原子件在主题/尺寸下可目视比较 | 自动回归或页面采用率 |

### 基线规则

- 未经人工确认，不运行 `--update-snapshots` 接受差异。
- 打印二维码包含 origin；固定测试 origin 后再判断真实布局差异。
- 新的页面截图基线必须先由业主确认，再纳入版本控制。
- 截图、overflow 和 axe 都通过后，仍需按证据等级做设计稿人工对照。

### 企业微信推送配置

- 新建和编辑只展示 Bot ID + Secret 智能机器人协议，不提供 Webhook 输入或协议切换；凭据不进入客户端表单。
- 列表常驻展示 LIGHT worker 长连接状态。旧目标独立折叠为只读历史元数据，不提供旧编辑/测试入口；旧编辑 URL 显示迁移说明。
- 事件规则与系统设置隐藏未绑定的旧目标，已有选中项保留并可取消，避免保存其他字段时静默改写存量路由。
- 新建表单与只读历史块由 `NotificationConfiguration.browser.spec.tsx` 覆盖六视口、明暗主题、overflow、44px touch、axe 和键盘/提交契约。

## 工单编辑与创建数据一致性

- 编辑页读取原单事实；`OrderSavedConfiguration` 展示保存的款式、纸张规格、工艺、设计文件、每票分货、结构化包装和分阶段费用，不从当前创建默认值补写历史记录。缺失记录明确提示。
- 创建与编辑共用 `OrderReceiverContactFields`。编辑展示全部配送联系人；修改基本信息与配送后直接保存，款式变更及费用通过已有申请、审批和核价组件处理。生产后锁定基本生产事实，待审批时锁定普通保存；终态返回详情页。
- 款式、包装与费用以共享 Card / Disclosure 分区；逐款详情折叠，保存冲突保留用户输入。`EditOrderForm.browser.spec.tsx` 覆盖六视口、明暗主题、overflow、44px 控件、axe 及多地址/失败/状态交互；创建到编辑的真实数据往返由 `tests/e2e/order-create.spec.ts` 验证。

## 当前采用状态

共享 token、基础组件、结构化反馈和跨视口门禁已经建立。工单列表批量选择/行菜单、变更审批逐字段差异、CDR 同条件重新生成、通知 transport/job 状态拆分与 UNKNOWN 人工决策已经落地。业务 UI 生产代码由 ESLint 和结构测试禁止新增原生 `alert/confirm`。

采用率仍不是 100%。当前仍需分批闭合的主要缺口是：主数据“被引用”与停用影响、旧详情页手写空态、未迁移表单的字段错误摘要、Dashboard/复杂定价页更细的分区错误隔离，以及管理端/师傅端与设计稿之间的真实截图基线。完整状态、严重度、成本与独立验收边界见 [`docs/UI-REMEDIATION-BACKLOG.md`](./docs/UI-REMEDIATION-BACKLOG.md)。完成一个缺口时同时补页面测试和门禁，不通过修改文档把缺口变成“已完成”。

## 禁止模式

- 页面内新建另一套 `StatusBadge`、Empty、loading、pending 或确认层。
- 用 Tooltip 作为禁用原因或关键错误的唯一载体。
- 用红色表达普通不可用、权限不足、环境提示或正常终态。
- 用 `window.alert` / `window.confirm` 承载 L2/L3。
- 用任意色、Tailwind 调色板字面量或仅适用于 light 的色值。
- 表格直接撑破 viewport，或用 `overflow-hidden` 静默裁字。
- 为通过测试而排除 axe 节点、放宽 overflow、增加任意 sleep、删除断言或盲目更新截图。
- 把 UI 计算结果作为金额、薪资或报价的最终写入依据。
- 在没有 A 级设计证据和逐页核对时声称“像素级还原”或“全站已对齐”。

## 新组件与页面交付清单

- [ ] 选择了正确组件层，没有复制已有模式。
- [ ] 浅色、暗色和语义 tone 正确；失败以外不滥用 destructive。
- [ ] Loading / Empty / Error / Disabled / Pending 全部可到达并验证。
- [ ] 涉及批量、冲突、长任务、终态时补对应状态。
- [ ] 键盘、焦点、label、aria-live 和 reduced-motion 正确。
- [ ] 六个目标视口无 body overflow、静默裁切或不可点击动作。
- [ ] 设计证据等级、设计文件和人工审查范围已记录。
- [ ] 目标测试、typecheck、lint、相关视觉门禁和打印保护已通过。
- [ ] `/dev/showcase` 已覆盖新增共享组件及关键 variant。
- [ ] 可见文案只陈述事实、限制和后果，没有概念解释、内部背景或重复值。
