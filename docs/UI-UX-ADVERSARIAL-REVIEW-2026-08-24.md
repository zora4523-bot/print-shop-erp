---
status: actionable-audit
owner: engineering
reviewed_at: 2026-08-24
last_verified: 2026-08-25
baseline_commit: 41abe65
applies_to: current worktree and docs/ux-redesign
---

> 历史记录（按文内日期理解）。2026-09-24 起角色、结算与工种口径以 SPEC §L 与 DECISIONS 为准。

# UI / UX 对抗审查与独立任务清单

本报告在提交 `41abe65`（`feat: checkpoint UX alignment and runtime hardening`）之后形成。设计包只作为设计证据和验收输入；其中的说明不自动成为业务授权，也不替代权限、审计、金额、并发与批处理契约。

## 结论先行

- 本轮没有确认 **S0**。
- 当前实现已经建立较完整的语义 token、共享状态组件、响应式/axe 门禁和打印像素基线，但**不能声称 85 个页面均已按设计稿逐像素完成**。
- 已确认的最高风险不是配色，而是高影响操作的确认层覆盖不完整、并发覆盖、网络失败恢复、已证明长任务的回执，以及动态键盘/移动状态缺口；是否新增强制理由或统一审计载体仍需逐领域确认。
- 设计包 `refs/` 只有 17 张现状参考截图；其他页面大量属于线框、交互契约或页面族推断。对这些页面只能做契约对齐，不能把推断写成像素验收结论。
- 管理端/师傅端当前测试是几何、触控、axe 和候选截图门禁；真正使用 `toHaveScreenshot` 的生产页面只有打印视图，共 8 张基线。

## 审查范围与证据边界

| 证据 | 已核验范围 | 能证明 | 不能证明 |
|---|---|---|---|
| 路由静态盘点 | 85 个 `page.tsx`：74 个 admin、6 个 worker，其余为认证/打印等 | 当前代码页面范围 | 设计包也恰好写 85，不代表两者逐页一一映射 |
| 原设计包 | 17 张 `refs/*.png` 与 `.dc.html` 线框/交互规范 | 高保真页与契约页的目标 | 没有实屏的页面不能据此宣称像素一致 |
| 浏览器实机 | Dashboard、工单、账号等关键路径；393/1280 showcase | 可见布局、交互和运行时现象 | 未遍历 85 页全部业务状态 |
| 自动门禁 | Vitest、typecheck、lint、build；admin/worker 六视口；打印 8 张像素基线 | 当前被列路由的稳定态几何、touch、axe；打印像素稳定 | 动态菜单、pending/error、软键盘、notch、全部路由和设计稿像素一致 |
| 三路只读对抗审查 | 业务流程；a11y/响应式；覆盖率/异常状态 | 下列代码证据和可独立任务 | 未执行的业务决策仍需 owner 确认 |

浏览器审查还实际暴露了一个高风险现象：账号编辑页点击“停用账号”会直接执行，没有确认层或理由。测试账号已立即恢复为活跃状态；该现象已纳入 `ADV-S1-05`。

## 已确认保持良好的部分

- 生产业务代码未发现原生 `window.alert` / `window.confirm`；已有 lint 与结构测试保护。
- 业务层没有新增 Tailwind 调色板或任意颜色字面量；打印固定色仍受单独基线保护。
- `Table` / `TableScrollArea` 已提供有标签、可聚焦的横向滚动区域。
- Dashboard 的处理队列优先、工单的新建/详情骨架、排产核心工作台、师傅报工、定价发布中心已完成较扎实的结构对齐。
- 打印 8 张真实像素基线保持通过；管理端与师傅端已具备六视口明暗主题的几何、触控和 axe 基础门禁。
- `ConfirmActionDialog`、`ConflictResolutionPanel`、`LongTaskReceipt`、`FormErrorSummary` 等基础组件已经存在，后续重点是完善契约并迁移真实消费者。

## 审查后的执行证据

本文保留 `41abe65` 时的发现作为审计证据；完成状态仍只维护在 canonical [`docs/UI-REMEDIATION-BACKLOG.md`](./UI-REMEDIATION-BACKLOG.md)。后续独立提交已完成以下可执行子集：

- `ADV-S1-02`：工单审批/拒绝已有字段、金额与生产影响 L2；`reviewRemark` 仍为服务端可选，所以未伪造 L3。
- `ADV-S1-04`：盘点过账复用已持久 `remark` 完成 L3，并保留现有并发/部分结果。
- `ADV-S1-08`：账单发单/收款及外协付款均有实时金额、对象、剩余款和幂等提示的 L2。
- `ADV-S1-09`：日薪/时薪发放与撤销、客服工资流水、时薪重算、客服周期结算已完成 L2；无持久 reason 的动作仍需 ADR 才能升 L3。
- `ADV-S1-10A/B/D`：批量排产、发货与师傅批量完工均已迁移确认层；发货文案不再伪称扣库存/进终态。
- `ADV-S1-11`：未改变后端语义；师傅批量完工 UI 已明示当前“任一失败整批回滚”，最终产品取舍仍待 owner ADR。
- `ADV-S1-16`：当前 74/74 个生产 `useActionState` 消费者已有 busy/pending 结构契约；确定性断网 E2E 仍属 `ADV-S1-12`。
- `ADV-S1-17`：账号、工艺、BOM、分类、往来单位、物料与调价的直接启停已改为 L2；真实引用数与审计理由仍未伪造。
- `ADV-S2-01/02/04/05/06/07/19` 与 `ADV-S3-02`：已收口 44px pending 几何、成功字色/焦点、筛选无结果、根 404、错误聚焦/去重播报、portal motion、disclosure/menu 触控与三个安全动态标题。

这些提交不改变本报告的证据边界：管理端/师傅端候选截图仍不是 owner 签核像素基线，也不能声称 85 页逐页像素对齐。

严重度和成本沿用 [`docs/UI-REMEDIATION-BACKLOG.md`](./UI-REMEDIATION-BACKLOG.md)：S1 高、S2 中、S3 低；C1 小、C2 中、C3 大、C4 计划级。表内“已确认”指代码或实机证据充分；“契约待定”不得在未确认业务规则时自行实现。

[`docs/UI-REMEDIATION-BACKLOG.md`](./UI-REMEDIATION-BACKLOG.md) 是唯一 canonical 状态表；下列 `ADV-*` 是证据化子任务规格，不维护第二套完成状态。执行时必须挂到文末的 canonical 父任务，或先把新父项写入 backlog。确认层也不等于授权新增数据库字段：领域已经有 reason/remark/audit 时复用，尚无时必须先形成业务/数据 ADR。

## S1：优先处理

| 顺序 | ID | 成本 | 类型 | 独立任务 | 关键证据 | 完成标准 |
|---:|---|---|---|---|---|---|
| 1 | ADV-S1-02 | C2 | 已确认缺确认层；理由契约待定 | 工单变更批准/拒绝迁移到 L3 | `OrderChangeReviewForm.tsx:219,241` 备注可选且按钮直接执行；现有流程已记录 reviewer/time/reviewRemark 并写 OrderLog | 显示字段/计价/生产影响并处理并发审核；保留既有日志；是否把 reviewRemark 改为必填须由 owner 确认，UI 不自行创契约 |
| 2 | ADV-S1-03 | C2 | 已确认恢复缺口 | CDR 失败与导出超时补可恢复回执 | `cdr/page.tsx:139` 未显示已有 `lastErrorCode`；`OrderExportControls.tsx:68,241` 120 秒后停止轮询但仍永久“生成中” | 安全错误类别、回执 ID、重试/同条件重生、手动刷新与后台任务入口；覆盖 pending/failed/expired/slow |
| 3 | ADV-S1-04 | C2 | 已确认缺确认层；理由契约待定 | 盘点过账补 L3 影响预检 | `components/business/material/InventoryCountClient.tsx:421` 最终过账仍直接执行；现有实现已有差异预览、actor/time/remark、逐行 delta 与 MaterialTransaction | 确认层复用现有差异与 remark，保留并发/部分成功和库存流水；是否把 remark 改为必填须由 owner 确认 |
| 4 | ADV-S1-10A | C2 | 已确认高风险操作缺口 | 批量排产补 L2 影响确认 | `PendingSchedulingBoard.tsx:143,237` 选中后直接调用既有批量 Action | 确认层列工单、任务、师傅兼容性和交期；继续使用现有逐项结果契约 |
| 5 | ADV-S1-10B | C2 | 已确认高风险操作缺口 | 发货补 L2 影响确认 | `components/business/order/ShipOrderForm.tsx:321` 直接执行；发货会定稿外部销售快递/耗材收费、重算应收总额、更新 Shipment/Order 为非终态 `SHIPPED` 并发通知，不扣库存 | 准确显示工单、数量、物流、收费定稿和应收变化；不得伪称扣库存或进入终态；幂等、pending 和错误恢复完整 |
| 6 | ADV-S1-10C | C2 | 风险等级待业务确认 | 单项开工/报工补适当确认与结果反馈 | `BeginTaskButton.tsx:20`、`ReportTaskForm.tsx:187` 直接执行 | 先确认 L1/L2；保留快速作业效率、超报校验与计薪反馈，不把批量语义套到单项操作 |
| 7 | ADV-S1-10D | C2 | 依赖契约决策 | 师傅批量完工补确认 | `WorkerTaskBatchList.tsx:136,190` 直接执行 | 先完成 `ADV-S1-11`；确认层准确表达最终选定的原子或逐项语义，不先承诺部分成功 |
| 8 | ADV-S1-11 | C2 | 契约待定 | 决定批量完工是原子回滚还是逐项部分成功 | 设计的“不回滚”示例未明确覆盖 `reportTasks`；`lib/production.ts:1659-1663` 当前明确整批原子 | owner 形成 ADR；仅在决策改变时同步 schema、Action 结果与 `BatchActionResult`；契约未定前不改语义 |
| 9 | ADV-S1-05 | C3 | 已确认安全 UX 缺口；审计载体待定 | 账号停用、角色、机器和工艺能力变更统一 L3 | `account/ToggleActiveButton.tsx:27` 直接提交；`AccountForm.tsx:272,361,523` 普通保存；实机已复现直接停用 | 真实引用/会话/任务影响、二次确认、服务端校验和焦点恢复；是否新增理由或统一审计载体先做 ADR |
| 10 | ADV-S1-06 | C3 | 已确认并发缺口 | 工单编辑增加乐观锁和冲突三选 | 编辑页/Action 不传 revision：`orders/[id]/edit/page.tsx:50`、`actions/order.ts:291`；服务层最终按 id 更新：`lib/order.ts:1671,1740` | CAS/revision；同时展示我的版本与最新版本；“用我的/用最新/取消”均不静默丢输入；并发 E2E |
| 11 | ADV-S1-07 | C3 | 已确认恢复缺口 | 定价草稿与阶梯冲突接入真实差异三选 | `components/business/price/ExternalSalesPriceBookDraftForms.tsx:247`、`components/business/price/ExternalSalesPriceTierGroupEditor.tsx:432` 只有刷新；生产 UI 未消费 `ConflictResolutionPanel` | Action 返回最新快照/版本；保留本地草稿；差异可读；三个动作再次做 CAS |
| 12 | ADV-S1-08 | C3 | 已确认高风险操作缺口 | 账单发单、登记付款、外协付款统一 L2 | `components/business/bill/IssueBillButton.tsx:15`、`components/business/bill/RecordPaymentForm.tsx:39`、`components/business/outsource/OutsourcePaymentForm.tsx:55` 直接提交；设计规范将发单/付款列为 L2 | 确认层显示周期、对象、金额、剩余应收及不可回退影响；幂等、pending、结果反馈完整 |
| 13 | ADV-S1-09 | C3 | 已确认高风险操作缺口；理由契约待定 | 薪资发放/撤销、结算、时薪重算统一 L3 | `CsPayrollPaymentForm.tsx:48`、`MarkPaidForm.tsx:25`、`RecomputeHourlyForm.tsx:23`、`SettleReadyCsButton.tsx:15` 直接执行 | 复用日薪重算的两阶段模式；显示人数/金额/周期影响并保留幂等/并发；理由或新审计字段只在既有契约或 ADR 下接入 |
| 14 | ADV-S1-12 | C3 | 已确认网络恢复缺口 | Server Action 传输失败保留输入并可安全重试 | 当前没有 `Failed to fetch` / offline E2E；根错误测试只是字符串契约；此前真实出现 `fetchServerAction` 失败 | 确定性断网 fixture；区分网络/字段/业务错误；保留输入；幂等重试；恢复后不重复写入 |
| 15 | ADV-S1-13 | C3 | 已确认隔离缺口 | 对复杂页拆分数据源、Suspense 与 ErrorBoundary | 工单列表 `app/(admin)/orders/_components/OrdersListContent.tsx:34`、仓库 `warehouses/page.tsx:68`、Dashboard `owner/page.tsx:74` 将独立源绑在 `Promise.all` | 附属源失败不替换核心操作；分别覆盖列表/筛选/导出、库存/调拨/历史、KPI/待办/图表的单源失败 |
| 16 | ADV-S1-14 | C3 | 缺确认层；理由/审计契约待定 | 通知模板与群绑定变更迁移 L3 | `RuleForm.tsx:49,200` 普通保存；当前 Action 不接理由 | 先展示影响规则/群/接收人和并发恢复；是否要求理由、用何种审计载体由 owner/数据 ADR 决定 |
| 17 | ADV-S1-15 | C3 | 已确认数据完整性风险；服务端契约待定 | 建立考勤更正/撤销安全契约 | `removeAttendanceAction` 已存在，但 `lib/attendance.ts:265-286` 会 hard delete、丢弃 actor、吞掉全部异常，且没有 worker-month 锁或已发工资阻断 | owner/数据 ADR 决定 hard delete 或更正记录；服务端锁定月份并阻断已发工资依据删除；保留 actor/原因/审计；仅把 P2025 视为不存在；完成前不得开放撤销 UI |
| 18 | ADV-S1-16 | C4，可按域拆 C2/C3 | 已确认系统性反馈缺口 | 完成所有写表单 pending/结果契约迁移 | 启发式扫描 71 个状态化业务表单，48 个既无表单级 `aria-busy` 也无 `PendingButton`；这不代表 48 个都可重复提交，但统一忙碌语义未闭合 | 按“账单薪资→采购外协→工单→价格→设置认证”拆批；每批有 busy、阻止重复、成功/失败反馈与网络状态测试 |
| 19 | ADV-S1-17 | C4，可按域独立 | 已确认主数据影响缺口；理由/审计契约待定 | 为工艺、BOM、分类、往来单位、物料等补真实引用影响和停用确认 | 产品域已完成；`craft/ToggleActiveButton.tsx:27`、`party/TogglePartyActiveButton.tsx:25`、`bom/ToggleBomActiveButton.tsx:35` 等仍直接提交 | 每个领域独立查询真实引用、列受影响对象并保留历史引用；理由与新审计字段仅按既有契约或 ADR 接入；禁止假计数 |

## S2：一致性、响应式与验证闭环

| 顺序 | ID | 成本 | 类型 | 独立任务 | 关键证据 / 完成标准 |
|---:|---|---|---|---|---|
| 20 | ADV-S2-01 | C1 | 已确认布局缺陷 | disabled/pending 保持 44px 几何 | `components/ui/button.tsx:23` 基础为 32px，`app/globals.css:330` 的 44px 兜底排除 disabled；登录实测 active 44px → disabled 32px。修复后增加 pending 前后 rect 断言 |
| 21 | ADV-S2-02 | C1 | 已确认对比缺陷 | 修复成功小字和焦点 token | `components/business/cdr/RegenerateBundleForm.tsx:70` 的 `text-xs text-success` 约 3.39:1；浅色 ring 对比也偏弱。改用可读 foreground，并加入焦点外观测试 |
| 22 | ADV-S2-03 | C1 | 已确认语义缺陷 | 静态前置阻断不再使用 assertive alert | `components/business/bom/BomForm.tsx:148`、`components/business/purchase/PurchaseOrderForm.tsx:81` 等初始缺主数据提示抢播报；改为 `DisabledReason` / note/status，真实提交失败保留 alert |
| 23 | ADV-S2-04 | C1 | 已确认状态缺口 | 工单筛选零结果使用 `no-result` | `OrdersTable.tsx:46` 总是 `no-data`；有筛选时需说明无结果并提供“清除全部筛选” |
| 24 | ADV-S2-05 | C1 | 已确认根状态缺口 | 增加根 `app/not-found.tsx` | 当前只有 admin/worker 404；认证、打印和未知根路径会落入 Next 默认页。新增不泄露对象存在性的统一返回路径与测试 |
| 25 | ADV-S2-06 | C2 | 已确认表单 a11y 缺口 | 错误摘要聚焦、去重播报并关联字段 | `components/ui-business/FormErrorSummary.tsx:18` 只有 `tabIndex=-1`；`components/ui-business/FormMessage.tsx:52` 每字段又 assertive；采购/BOM/薪资旧表单缺 `aria-describedby` 或字段身份。统一“单一摘要播报 + 首错定位”并测 activeElement |
| 26 | ADV-S2-07 | C2 | 风险已确认 | Portal 自带 reduced-motion 与 safe-area | Sheet/Dropdown/Tooltip 挂到 body，绕过壳级 reduced-motion；全屏 Sheet 未完整处理 notch safe area。原语级修复并做 CSS env/设备验证 |
| 27 | ADV-S2-08 | C2 | 风险已确认 | 统一 sticky header offset 和 fixed bar 占位 | `PendingSchedulingBoard.tsx:185` 使用 `top-0`，时间线/版本页写死 offset；工单批量条无 spacer。滚动后断言不与 header/末行重叠，并处理 safe-inline |
| 28 | ADV-S2-09 | C2 | 已确认状态漂移 | 扩充共享 status registry | 采购、CDR、发货、导出仍有本地映射；外协存在“已发出/已回货”与“已发送/已收货”漂移；worker 详情仍用中性 Badge。统一 label/tone/dot 并扩消费者门禁 |
| 29 | ADV-S2-10 | C2 | 已确认 loading 不一致 | 统一慢加载契约 | `ContentSkeleton` 有 8 秒提示，但 worker、Dashboard、仓库等手写骨架没有。保留领域形状，复用慢加载包装器并用时间推进测试 |
| 30 | ADV-S2-11 | C2 | 已确认移动交互不一致 | 375/393 宽度工单筛选改为底部抽屉 | `OrderListFilters.tsx:265` 所有视口均用内联 `<details>`；按设计实现 ≤80vh 抽屉、常驻 chips、焦点 trap/return 与 Escape |
| 31 | ADV-S2-12 | C2 | 设计契约任务 | 工单批量条接入已有排产能力 | 当前条只有复制/取消；批量排产 Action/schema 已存在，真正缺口是所选工单到师傅兼容选择/排产页的 UI 交接。导出/打印等动作仍须分别确认契约 |
| 32 | ADV-S2-14C | C2 | 依赖服务端安全契约 | 展示考勤对薪资月份的影响并接入撤销 UI | 依赖 `ADV-S1-15`；只展示服务端返回的月份/已发阻断与下一步，不能靠客户端推断；服务端契约未完成前不得独立上线 |
| 33 | ADV-S2-15A | C2 | IA 决策任务 | 确认并调整侧栏分类 | 当前通知/设置等归“运维”；设计建议设置归“设置”、CDR 归业务、Pigsty 与业务异常分离。先由 owner 签核 taxonomy，再迁移导航和回归权限可见性 |
| 34 | ADV-S2-19 | C2 | 已确认 a11y/触控缺陷 | 统一 disclosure 与 portal 菜单的触控尺寸和强可见焦点 | `components/business/product/ProductForm.tsx:93` 等多个 `<summary>` 实测 293×40 且无 outline；`components/ui/dropdown-menu.tsx:91` 菜单项实测 168×28；当前 gate 未选择 `summary` / menuitem。新增共享 disclosure、≥44px 菜单项和打开态键盘测试 |
| 35 | ADV-S2-20 | C2 测量；满足阈值后另立 C3 | 架构候选，尚非已确认缺陷 | 量化账单生成、薪资重算/结算的长任务风险 | 同步 await 本身不能证明超时。先记录数据规模、p50/p95/p99、平台超时和失败恢复；达到阈值后再立后台回执任务，未达到则完善 pending/结果反馈 |
| 36 | ADV-S2-21 | C2 决策；实施另估 | 已决策限制，非现有 Bug | 决定 DRAFT 是否需要直接款式编辑 | `lib/order/editable-fields.ts:11` 明确只编辑顶层字段；若 owner 立项，依赖 `ADV-S1-06`，复用新建工单编辑器并保持核价/revision/日志 |
| 37 | ADV-S2-22 | C2 决策；实施另估 | 业务契约待定 | 决定款式 REMOVE 的修改申请契约 | SUBMITTED 已通过 `components/business/order/OrderChangeRequestForm.tsx:149-171` 支持 ADD/UPDATE 并走审批版本流；不得改成直接编辑。REMOVE 需先定义生产、计价和历史影响 |
| 38 | ADV-S2-23 | C2 | 契约核对任务 | 在既有“进行中 N 分组”内核对师傅任务卡 | 设计明确不是唯一单卡，`WorkerTaskBatchList.tsx:107-121` 当前分组方向正确；仅核对是否缺交期、合法主动作和触控反馈，不推翻分组信息架构 |
| 39 | ADV-S2-14B | C3 | 业务契约待定 | 设计考勤批量填 | 当前只能单员工逐日录入；先确认批量覆盖范围、冲突、审计和部分成功契约，再实现交互 |
| 40 | ADV-S2-15B | C3 | 产品范围待定 | 定义全局搜索与未决提醒 | Header 当前是重复快捷链接；搜索对象、权限过滤、索引、异常来源和未决数口径须单独立项，不能与导航改名绑在一个任务 |
| 41 | ADV-S2-16 | C3 | 验收证据缺口 | 建立 route × design × state 可追踪清单和核心像素基线 | 74 个 admin 页面仅 28 个进入当前 responsive/axe 路由门禁，另 46 个未进入；admin/worker 截图只是忽略目录里的 candidate。先固定 fixture/字体/浏览器，再由 owner 签核 393/1280 light/dark expected |
| 42 | ADV-S2-17 | C3 | 动态回归缺口 | 建立键盘、portal、pending/error、滚动态和移动设备旅程 | 当前门禁不覆盖 Tab/Shift+Tab/Enter/Space/Escape、trap/return、selected batch、sticky 滚动、网络失败；只用 Chromium viewport，未证明 WebKit、软键盘和 notch。新增共享 runtime 监听、overlay 检查、WebKit 关键流和真机清单 |
| 43 | ADV-S2-18 | C3 | 持续集成缺口 | 将 lint/type/unit/build/响应式/axe/打印纳入 CI | 仓库当前无 workflow，PR 模板也未列 E2E/视觉；现有绿色结果只是本地证据。CI 分片保存 trace/candidate，打印固定受控平台 |
| 44 | ADV-S2-13 | C4，可按页族拆 C2/C3 | 设计证据/移动策略缺口 | 分类收口移动高密度页面 | 排除 UI atom、dev 与测试后有 44 个生产 table 文件，只有少数显式卡片降级；横滚门禁不能证明设计对齐。按作业频率、列重要度和窄屏动作决定卡片、裁列或有提示横滚，禁止机械全改 |

## S3：治理与防漂移

| 顺序 | ID | 成本 | 独立任务 | 完成标准 |
|---:|---|---|---|---|
| 45 | ADV-S3-01 | C1 | 修正文档状态漂移（本审查提交已完成） | 旧 `docs/codex-ui-brief.md` 已标记 historical/superseded；所有已知现行引用已改指 `UI-SYSTEM.md`、coverage、backlog 和本报告 |
| 46 | ADV-S3-02 | C1 | 补三个详情页安全 metadata | 日薪详情、师傅工单详情、师傅工资详情使用不泄露权限信息的动态标题，并覆盖不存在时回落 |
| 47 | ADV-S3-03 | C2 | 扩展静态 UI 防回退门禁 | AST 扫描本地状态映射、手写“暂无”、危险直接提交、无原因 disabled、重复 live region；先报告与例外清单，再升级为失败门禁 |
| 48 | ADV-S3-04 | C2 | 设计证据自包含与签核治理 | 为原设计包建立文件清单/哈希/来源，不让仓库文档只依赖 Downloads 绝对路径；记录画板、证据等级、fixture、签核人和日期 |
| 49 | ADV-S3-05 | C4，可按页族拆 C2/C3 | 基础 UI 原子件真实迁移 | `Card`、`Alert`、`Progress` 在 showcase 存在但生产消费者接近零，业务中仍有大量手写 card 和 18 个原生 textarea。按页面族迁移，允许有理由的 progressive-enhancement 例外，禁止机械全量替换 |

## Canonical 父任务映射

下表只定义归属，完成状态仍只写在 `docs/UI-REMEDIATION-BACKLOG.md`。标记“新增父项”的发现，在 owner 接受范围前只是审查证据，不得被实现者自行扩权。

| Canonical 父项 | 对抗审查子任务 |
|---|---|
| `UI-F03` 操作反馈与确认层 | `ADV-S1-02`、`04`、`05`、`08`、`09`、`10A`～`10D`、`14` |
| `UI-F06` Server Action pending/结果 | `ADV-S1-16` |
| `UI-F07` 长任务回执 | `ADV-S1-03`、`ADV-S2-20` |
| `UI-F10` 主数据引用/停用 | `ADV-S1-17` |
| `UI-F01B` 分区错误隔离 | `ADV-S1-13` |
| `UI-F04` 状态注册表 | `ADV-S2-09` |
| `UI-F11` 空态所有权 | `ADV-S2-04` |
| `UI-F12` 表单字段与错误 | `ADV-S2-03`、`06` |
| `UI-F13` Loading | `ADV-S2-10` |
| `UI-F14` 网络恢复 | `ADV-S1-12` |
| `UI-L01` 响应式列表 | `ADV-S2-11`～`13` |
| `UI-Q01` 视觉证据 | `ADV-S2-16`、`17` |
| `UI-Q02` 静态门禁 | `ADV-S3-03` |
| 新增父项：UI primitive/token 交互修复 | `ADV-S2-01`、`02`、`19` |
| 新增父项：Portal motion/safe-area | `ADV-S2-07` |
| 新增父项：sticky/fixed 布局契约 | `ADV-S2-08` |
| 新增父项：并发恢复 | `ADV-S1-06`、`07` |
| 新增父项：批量完工契约 | `ADV-S1-11`；`ADV-S1-10D` 依赖它 |
| 新增父项：考勤更正安全与 UX | `ADV-S1-15`、`ADV-S2-14B`、`14C` |
| 新增父项：导航 taxonomy | `ADV-S2-15A` |
| 新增父项：全局搜索/未决提醒 | `ADV-S2-15B` |
| 新增父项：剩余工单款式范围 | `ADV-S2-21`、`22` |
| 新增父项：根 404 | `ADV-S2-05` |
| 新增父项：CI 门禁 | `ADV-S2-18` |
| 新增父项：师傅任务列表核对 | `ADV-S2-23` |
| 新增父项：详情 metadata | `ADV-S3-02` |
| 新增父项：设计证据/文档治理 | `ADV-S3-01`、`04` |
| 新增父项：生产页面 UI atom 迁移 | `ADV-S3-05` |

## 独立交付顺序

1. **安全快修**：`ADV-S1-02`～`04`、`ADV-S2-01`～`06` 与 `ADV-S2-19` 可先并行，改动边界较小。
2. **领域高风险操作**：账号、工单审批/排产、账单、薪资、盘点、通知分别拥有自己的领域文件；共享确认原语只由一个任务维护。
3. **并发与恢复**：先完成工单 CAS，再决定 DRAFT 直接款式编辑；先确认批量完工原子性 ADR，再实现其确认文案；网络恢复可独立推进，后台长任务先测量再立项。
4. **移动与信息架构**：筛选抽屉、固定条、移动列表分类可独立；师傅端保留“进行中 N 分组”；考勤批量、导航分类和全局搜索需要 owner 先签契约。
5. **证据闭环**：route manifest → 动态旅程 → owner 确认像素 expected → CI 必跑，顺序不可倒置。

## 每个任务的共同验收门禁

1. 不改变既有权限、Decimal 金额、快照、状态机、幂等、审计与乐观锁不变量；若任务需要改变，先形成独立业务/数据 ADR。
2. 新写操作必须同时覆盖默认、pending、成功、字段失败、业务失败、网络失败、并发冲突、终态只读；不适用状态需在测试中说明。
3. 布局改动至少通过 375/393/768/1024/1280/1920 的 light/dark 几何、axe、触控门禁；移动关键流另加 WebKit 或真机证据。
4. 视觉截图必须区分 candidate 与 approved baseline；没有 owner 签核不得把候选图称作设计稿回归。
5. 不通过放宽断言、隐藏错误 overlay、删除测试或更新无关基线制造绿色结果。
6. 每个任务独立提交；状态只同步 canonical backlog，并记录验证命令、剩余边界和必要的 CHANGELOG/ADR。本报告仅在证据或任务边界发生变化时更新。

## 2026-08-25 复核结论

本节只记录 `41abe65` 之后的复核状态，不重写上面的原始发现表。原表继续作为基线时点的审计证据，canonical 完成状态仍以 [`docs/UI-REMEDIATION-BACKLOG.md`](./UI-REMEDIATION-BACKLOG.md) 为准。

- `ADV-S1-03`、`ADV-S1-13`、`ADV-S2-03`、`ADV-S2-09`、`ADV-S2-11`、`ADV-S2-12` 已完成。
- `ADV-S1-16` 的当前源码 pending/重复点击保护已完成：29 个关键表单有显式 busy 契约，新 action-state 表单受 AST 门禁，12 个可变快照和 7 条表单内导航路径受 pending 锁保护；网络未知结果仍由 `ADV-S1-12` 承担。
- `ADV-S2-08` 已完成工单范围的实测 sticky offset、批量条与分页避让；其他详情页族仍需继续迁移。
- `ADV-S2-10` 已完成工单、Dashboard、仓库、定价和师傅端核心页面；`ADV-S2-17` 已覆盖移动筛选 Sheet、焦点返回、Escape、单 chip 移除、pending 快照和滚动 offset 等关键子集，仍不等于软键盘、WebKit 与真机全覆盖。
- `ADV-S2-16` 与 `UI-Q01` 仍未完成。管理端和师傅端只有 candidate 截图，只有打印页具备 owner 可审核的像素 expected；因此不能声称 85 页逐像素对齐。

当日正式回归为：管理/销售端 37 通过、5 条件跳过（6 档视口、明暗主题）；师傅端 12/12 通过；打印页 8/8 历史像素基线通过且没有更新 expected PNG；批量排产/生产 E2E 5/5 通过。clean 产品 HEAD 的 Vitest 为 301 文件 / 3387 项全通过。详细命令、作业含义与证据边界见 canonical backlog。

### 必须保留的业务边界

- `ReworkOrder` 创建、`PriceAdjustment` 创建模式、`PurchaseOrder` 创建和 `ProductCategory` 创建模式尚无稳定客户端幂等键与服务端 replay 契约；pending 锁不能替代断线后的安全重试协议。
- `PriceTier` 唯一约束只能拒绝重复，不能返回原成功结果。
- 师傅批量完工当前仍是同一事务、任一失败整批回滚；是否改为逐项部分成功必须由 owner 形成 ADR。
- 工单 CAS/冲突三选、价格覆盖/合并、考勤更正与审计、通知 reason/audit、单项开工/报工确认等级和长任务迁移阈值仍是显式 ADR 边界。

## 本轮明确不能作出的结论

- 不能说“所有界面都做了视觉回归”；目前只有打印页有真实像素断言。
- 不能把当日 37 通过 / 5 条件跳过的 admin project 作业理解为 37 张设计基线；每个作业内部循环多个路由，截图仍是 candidate。
- 不能把“页面没有独立 `loading.tsx` / `error.tsx`”直接判成没有兜底；App Router 会继承分组边界，真正缺口是复杂页的分区隔离和逐状态验证。
- 不能把设计包的线框/文字要求当成已确认业务规则；批量完工原子性、考勤批量、导航分类、全局搜索范围等必须先由 owner 决策。考勤单条撤销后端已存在，不属于“无契约”。
- 不能因为稳定初始态 axe 通过，就声称动态菜单、错误聚焦、portal、safe-area、软键盘和 pending 状态已通过。
