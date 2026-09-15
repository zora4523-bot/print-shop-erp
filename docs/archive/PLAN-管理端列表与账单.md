文档版本（SHA-256）：`docs/工单列表-管理端.html`=`ad6d637ae9a2398dc81810d66ac7fd9b879b04b5647d0dcca7828ccb3b622b95`；`docs/archive/codex-管理端列表与月度账单任务.md`=`6845998e2a41abb14cb94b48fbfc8b5a1fc22afd8b4e01d5a5944a1e0c4ccb0a`；`docs/工单变更与版本规则.md`=`10711faaaab5936720e312184a3f3065474958d2d50cac8de792f4addfa92dd9`；`docs/加工费计费规则.md`=`8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852`

# PLAN-管理端列表与账单

> 状态：两波业务实现、additive migrations 与验证均已完成；静态门禁、完整 Vitest、browser tests、生产构建和独立库迁移均已通过。第二次完整 Playwright（定位器修复前）为 98 passed、6 failed、12 skipped；其中 4 项移动端定位器竞争已修复，并以 375×667、393×852 亮/暗主题各重复 3 次定向验证，12/12 通过。最终可接受失败仅为 2 条已存档的既有基线签名，剩余工作为发布收口。
>
> 实施分支：`codex/gogndan`；计划基线：`f04a5c041a7acec23ea8ac55f9532764b02c1c98`。
>
> 基线证据：`docs/audits/2026-09-02-admin-order-list-billing-baseline.md`。
>
> 真值优先级：规则文档 > 任务文档 > HTML demo 的布局与交互。demo 中的内存数据、状态映射和模拟按钮不是后端业务真值。

## 1. 执行结论

原计划的两波功能已在同一实施分支完成。`/orders` 已从普通表格升级为管理工作台，具备六队列、六个工单信号卡与一个待收款卡、全集合计、个人星标、富行、深链抽屉、裁决、批量命令、版本化打印、双工序进度和异步导出；`/owner/agent-bills` 已提供按 `settledAt` 上海月归集的新月账单，旧账单留在只读归档入口。

本轮没有把 demo 的模拟状态当成业务真值。实现新增了 11 态工作流所需状态、独立 `workOrderVersion`、`settledAt`、MODIFY/CANCEL 变更裁决、append-only 打印事实、工单数量报工/扫码认领事实和并行的 v2 代理月账本；旧状态与旧 `Bill/BillItem/BillPayment` 继续兼容读取，没有删除或重解释历史财务事实。

实施按原定两波完成：

- 第一波完成工作流、结算和打印真值，以及队列、裁决、批量、通知与新月账单。
- 第二波完成工单数量报工 ledger、扫码认领、双进度、异常、停滞检测和对应通知。

报工的计薪单位仍保持原语义；新增 `workOrderProgressQuantity` 独立表达工单件数，FOILING/PACKING 分别以当前工单版本的订单数量为硬上限。首次有效扫码写入 append-only claim；打包进度大于烫金实时提示，下发后无认领满阈值进入停滞扫描。

完整实施与验证证据见 `REPORT-管理端列表与账单.md`。

## 2. 前置三步完成情况

1. 两份附件已逐字同步到 repo：
   - `/Users/zhixing/Downloads/工单列表-管理端.html` → `docs/工单列表-管理端.html`
   - `/Users/zhixing/Downloads/codex-管理端列表与月度账单任务 (2).md` → `docs/archive/codex-管理端列表与月度账单任务.md`
2. 两组源/目标文件均通过 `cmp`；四份真值文档的 SHA-256 固定在本 PLAN 第一行。
3. 已创建干净基线 commit：`f04a5c0 docs: pin admin work-order planning sources`。
4. 已完成完整基线验证；唯一红项及全部通过项已存入基线审计，不在本任务顺手修复。
5. 用户确认后已完成 W1-01 至 W1-07、W2-01 至 W2-02；共新增 9 个 expand-only migration，fresh migration chain 已通过 `132/132`。

## 3. 规划时实现与 demo 的差距（现已关闭）

本节保留为实施前差距证据；表中的“当前”均指计划基线 `f04a5c0`，不代表实施后的代码状态。

### 3.1 可复用基础

| 能力 | 现状与证据 | 处置 |
|---|---|---|
| 页面入口 | `app/(admin)/orders/page.tsx`、`components/business/order/OrdersListContent.tsx` | 保留入口，替换管理端工作台组合层 |
| 服务端分页 | `lib/order/list-query.ts` 已在服务端 count/findMany | 保留，所有新队列与筛选继续服务端执行 |
| 稳定排序 | `lib/order/list-query.ts` 使用 `createdAt desc, id desc` | 固化为队列、统计、导出的共同顺序契约 |
| 全局搜索 | 已覆盖单号、名称、客户和运单号 | 保留，更新占位文案明确包含运单号 |
| 异步导出 | `lib/order/export.ts` 已使用持久化 HEAVY job、筛选快照、TTL 与审计 | 扩展 selected scope；不新增浏览器同步导出 |
| 费用快照 | `Order.quotedFee / confirmedFee / settledFee` 已存在 | 只读三段语义，不重算历史金额 |
| 价格版本 | `OrderPricingRevision`、`OrderPriceVersionLock` 已存在 | 用于展示 quoted/current 两版本两金额；首次确认按当前发布版重算并锁定 confirmedFee；不把当前 `revision` 直接当纸质工单版本 |
| 审计 | `OrderLog` 可提供时间线 | 抽屉复用，不复制一套日志 |
| 通知 | transactional outbox、durable LIGHT job、规则与日志已存在 | 增加事件和配置，业务事务不等待企业微信 |
| 报工 ledger | `ProductionOperation`、`ProductionReport`、无计件进度 ledger 已存在 | 第二波构建聚合读模型，不回读旧任务推测进度 |

### 3.2 必须补齐的后端真值

| 缺口 | 实际证据 | 影响 |
|---|---|---|
| 11 态生命周期 | `prisma/schema.prisma` 的 `OrderStatus` 仅 9 态；`lib/order/status-machine.ts` 仍走 DRAFT/PENDING_FACTORY/SUBMITTED/SCHEDULING/IN_PRODUCTION/COMPLETED/SHIPPED/FINISHED 等旧路径 | 待确认、暂停、下发、烫金、打包、显式结算不能靠 UI 标签伪造 |
| 独立工单版本 | `Order.revision` 也被终价 CAS/核价递增 | 二维码、旧版告警和重打印必须使用新的 `workOrderVersion` |
| 打印事实 | `OrderRowActions.tsx` 只直接打开打印/PDF；全仓无打印时间、打印版本、重打 ledger | 无法定义“待打印”“已打印”“旧版本” |
| 完整变更裁决 | `OrderChangeRequest` 无 MODIFY/CANCEL 类型、modifyKind、producedQty、settleFee；拒绝备注可空 | 无法按真值批准生产中取消、强制拒绝理由或触发重打印 |
| 显式结算时间 | 当前发货终审写 `settledFee`，之后 SHIPPED→FINISHED；schema 无 `settledAt` | 新月账单的月份归属前提不成立 |
| 队列读模型 | `view` 主要是展示态；现有管理视图只有 urgent/due-today/scheduling/saved，DTO 缩略图、版本、预检、打印、进度、账单归属、星标均缺失 | 页签计数、卡片、结果和合计可能各算各的 |
| 批量命令 | 当前选中栏只有复制工单号与清空，且选择只在当前页 | 无法下发、打印、结算和逐单返回跳过原因 |
| 通知事件 | 现有事件缺修改/取消、报工异常、停滞、待确认积压；新单模板仍带金额 | 不满足五类事件和“不带金额”约束 |
| 月账单 v2 | 旧 Bill 状态为 DRAFT/ISSUED/PARTIAL_PAID/FULLY_PAID，按 finishedAt 与 totalAmount 归集，允许 sequence 补充单和多笔部分收款 | 不能原地改成代理×月唯一的 DRAFT/CONFIRMED/PAID |

### 3.3 当前 UI 与 demo 的可见差距

本地管理账号实看 `/orders`：现有页面是标题、四个保存视图、筛选、导出和普通 20 条/页表格。demo 所示以下结构均不存在：六个工作队列、六张统计卡、当前筛选的工单/数量/费用合计、富行摘要、个人星标、缩略图、版本与打印状态、到期风险、双进度、费用阶段、批量命令栏和可寻址裁决抽屉。

demo 本身有以下已确认的不一致，执行时不能照抄其 JavaScript：

- 所有统计卡点击都落到同一 `todo` 队列；
- 状态映射缺 DRAFT，且只覆盖 10 项；
- 搜索实现包含运单号，但占位文案未说明；
- demo 队列顺序与任务文档不完全一致；
- demo 没有服务端权限、事务锁、幂等、分页和批量逐单资格校验。

## 4. 目标读模型与交互边界

### 4.1 单一队列查询规范

建立一个服务端 `AdminOrderWorkspaceQuery` 规范化输入和一套共享谓词，供以下四类读取共同使用：

1. 六队列：待办（待确认+待核价+变更申请+已暂停）、待打印、生产中、已发货、已结算/取消、全部；`REJECTED` 不属于“已结算/取消”。
2. 六个锁定看板数字：待确认、待核价、变更申请、已暂停、已逾期、今日待发；W1-07 再把“待收款”作为账单数字加入同一看板条。
3. 分页列表与当前筛选合计。
4. 异步导出的筛选快照。

规则：

- 队列内始终 `createdAt desc, id desc`；逾期只影响颜色，不改变排序。
- 队列、统计卡、筛选条件彼此独立组合，URL 可复现；翻页不丢筛选。
- 合计返回当前过滤全集的 `orderCount / quantity / fee / manualPendingCount`，不是当前页合计。
- 费用按 `settledFee ?? confirmedFee ?? quotedFee` 展示；仍待人工定价且没有可信金额的订单从金额合计排除，并单列数量。
- 搜索、计数、合计和导出必须使用同一授权边界；不为计数绕过行级权限。

### 4.2 富行与抽屉

行 DTO 一次批量投影以下信息，禁止逐行 N+1：选择框、个人星标、缩略图、工单号、独立工单版本、名称、客户/销售、工艺、提交时间、状态/待裁决摘要、交期风险、数量、烫金与打包进度、费用阶段、打印状态和允许动作。

- 点击 `#wo=<woNo>` 打开只读详情/裁决抽屉，可复制深链并支持前进/后退；服务端按工单号解析到内部 orderId。
- 抽屉只承载阅读和裁决；编辑继续跳转独立 `/orders/[id]/edit` 页面。
- 写按钮只展示服务端返回的 capability 提示；真正执行时服务端必须在事务中重新校验权限、当前状态、版本和资格。
- 个人星标只影响当前用户的视觉标记，不改变默认排序。

### 4.3 批量与打印

- 新增 append-only `OrderPrintJob`，至少记录 `orderId / workOrderVersion / printKind / reason / state / printedAt / printedById / idempotencyKey`。
- 待打印队列成员必须同时满足 `status ∈ {RELEASED, FOILING, PACKING}`，并且当前 `workOrderVersion` 尚无成功打印事实或版本升级后需要重打；修改批准在同一事务递增版本并创建重打任务。
- 二维码包含稳定工单标识和独立工单版本；扫码旧版只告警并指向最新版本，不静默当作当前版。
- 批量命令按白名单实现：下发、创建打印任务/标记已打印、结算、导出所选。服务端逐单返回成功、跳过及稳定原因码，不采用全有或全无的浏览器假设。
- `selected` 导出仍进入现有异步导出 job；服务端重新校验所选 ID 与权限。

## 5. 第一波实施序列：管理工作台、裁决、通知、账单（已完成）

### W1-01 `feat(order-workflow): expand lifecycle and settlement foundations`

- 采用 expand-migrate-contract 扩充新生命周期值，暂时保留所有 legacy 值和兼容读取。
- 新增独立 `workOrderVersion`、`settledAt`、变更申请类型与生产中取消结算所需字段。
- 加入工厂确认 preflight、拒绝原因 enum 与必填说明、暂停/恢复证据。
- 正常结算和批准取消都以数据库时间原子写 `settledFee + settledAt`；禁止客户端传结算时间。
- 生成历史映射/数据审计报告；无法由事实证明的旧状态不猜测回写。
- 只做 additive migration，不删除旧 enum 值、列、表、migration 或公开 API。

### W1-02 `feat(owner-orders): add workspace queues and rich list`

- 实现共享队列谓词、服务端计数、统计卡、合计和严格新单优先分页。
- 扩充批量行 DTO，使用集合查询投影缩略图、裁决、费用阶段等事实。
- 新增 `UserOrderStar`（或等价命名），`@@unique([userId, orderId])`，星标不参与默认排序。
- 按 demo 实现桌面工作台，并提供窄屏可横向浏览/折叠的信息层级；保留当前 URL 筛选与异步导出。
- 实现 `#wo` 可寻址只读抽屉，复用订单详情与 `OrderLog`。

### W1-03 `feat(order-decisions): add adjudication and price-version diff`

- 工厂确认、枚举驳回、暂停/恢复均走单一事务命令和审计日志。
- quoted 价表版本落后时，确认卡展示 quoted/current 两版本两金额；首次确认在同一事务按当前发布版重算，将结果和当前版本锁入 confirmedFee/确认快照，但不覆盖旧 quoted 快照。
- 完成 MODIFY/CANCEL 申请与裁决，拒绝理由必填。
- 批准修改时按确认口径处理重算、快照、版本递增与重打印任务；批准生产中取消时核实已产数量并结算。
- 并发以 revision/CAS、行锁和 idempotency key 防双裁决。

### W1-04 `feat(order-printing): add versioned print and batch commands`

- 新增打印 ledger、当前版二维码、旧版告警、待打印/重打印队列事实。
- 行动作和批量动作不再直接把“打开打印页”视为已打印。
- 实现逐单资格计算和稳定跳过原因；扩展异步导出为 `all | filtered | selected`。
- 加入并发/幂等 PostgreSQL 测试：双打印确认、修改与打印竞争、批量部分成功、重复 selected export。

### W1-05 `feat(notification): add management workflow events`

- 第一批事件：新单、修改/取消申请、待确认积压；报工类事件留到第二波。
- 复用 transactional outbox、durable job、稳定去重键、投递日志和 cron 分片。
- 企业微信消息不包含任何金额；移除新单模板当前金额字段。
- 角色开关、群映射和积压阈值进入类型化 SystemSetting；通知失败不回滚业务事务。
- 深链统一指向 `/orders#wo=<woNo>`，只携带单号、摘要和深链。

### W1-06 `feat(monthly-billing): add settled monthly ledger`

- 执行第 6 节 additive migration，新旧账单并存。
- 月初按上海时区自动生成上月 DRAFT；候选只看外部销售归属、`settledFee/settledAt`，包含已结算取消单。
- 实现代理×月唯一、DRAFT→CONFIRMED→PAID、确认冻结、下一开放月份负调整、整单收款。
- 加入真实 PostgreSQL 并发覆盖：双生成、生成↔确认、确认↔结算修正、双标记已收、双调整、月界写入↔扫描。

### W1-07 `feat(owner-billing): add monthly bill UI and cutover`

- 管理端列表、详情、成员/调整项、异步导出、标记已收、未出账筛选和应收 dashboard 改读 v2；“待收款”数字进入管理端看板条。
- 原 `/owner/bills` 的 legacy 数据移到明确的只读归档入口；不与 v2 dashboard 混算。
- 旧 cron writer 停用但旧表不删除；是否同步替换 `/sales/bills` 由第 8 节确认。
- 部署审计通过后，在后续独立 migration VALIDATE 只约束 v2/cutover 结算记录的条件约束；无法可靠回填的 legacy 记录继续显式豁免。

第一波依赖：

```text
W1-01 工作流/结算基础 ─┬─> W1-02 队列读模型/UI
                       ├─> W1-03 裁决/价表差 ─> W1-04 打印/批量/selected export
                       ├─> W1-05 工作流通知
                       └─> W1-06 新月账本 ─> W1-07 账单 UI/切换
```

## 6. 月度账单 additive migration

### 6.1 为什么不能原地改 Bill

现有 `Bill/BillItem/BillPayment` 已表达另一套已上线契约：销售用户×`finishedAt` 月、sequence 补充单、ISSUED/PARTIAL_PAID/FULLY_PAID、多笔累计收款、`totalAmount` 成员金额。现有测试、数据库约束和历史决策都固定该语义；本地开发库也已有 2 张旧账单、12 个成员和 2 条付款记录。即使当前本地 `settledFee` 历史为空，也不能重新解释已支付财务事实。

### 6.2 Expand

保留 legacy 三张表与 enum，新增平行账本：

- `AgentMonthlyBillStatus { DRAFT CONFIRMED PAID }`。
- `AgentMonthlyBill`：代理用户、YYYY-MM 账期、用户名/显示名快照、成员小计、负调整、总额、确认/收款人与时间；`@@unique([agentUserId, period])`。
- `AgentMonthlyBillItem`：账单、订单、单号/版本/状态/客户快照、`settledFeeSnapshot`、`settledAtSnapshot`；`@@unique([orderId])`。
- `AgentMonthlyBillAdjustment`：目标账单、来源成员、负金额、原因、创建人和唯一 idempotency key。
- `AgentMonthlyBillReceipt`：每账单唯一、整额、收款时间/方式/流水号/记录人和唯一 idempotency key。
- `Order.settledAt Timestamptz(3)?`、nullable 的 `settlementContractVersion`（legacy 为 null，新显式结算写 v2）及新账单成员关系。

新表加入金额、状态时间、账期格式、跨账期调整与冻结约束。父账单非 DRAFT 时，数据库 trigger 和应用层共同禁止成员/调整项增删改；订单已进入 CONFIRMED/PAID v2 账单后，禁止修改 `settledFee/settledAt/submitterId/settlementType`。

既有 Order 的新索引使用独立 `CREATE INDEX CONCURRENTLY` migration，建议 partial index：`(settlementType, settledAt, submitterId) WHERE settledFee IS NOT NULL`。新表索引可在建表 migration 内普通创建。

### 6.3 Dual write 与校验

1. Expand 先上线 nullable `settledAt` 和 v2 表，旧 writer 仍可运行。
2. 正常结算与批准生产中取消切为同事务写 `settledFee/settledAt/settlementContractVersion=v2`。
3. 运行历史审计；只有存在可靠发货结算证据的行才可使用对应业务时间回填，绝不使用迁移执行时间猜造。
4. 加入只针对 `settlementContractVersion=v2` 的条件约束，要求 settledFee/settledAt 同时非空；新 SETTLED 转移还必须带 v2 marker。legacy null marker 明确豁免，因此约束可以 VALIDATE，又不会逼迫历史记录伪造时间。只有未来另获批并完成可靠回填后，才讨论全表 pair constraint。
5. legacy Bill 永久只读保留；未来物理清理必须另行获批并遵守独立 cleanup commit。

### 6.4 生成、冻结与并发

- 候选条件：`settlementType=EXTERNAL_SALES`、可计费、`settledFee IS NOT NULL`、`settledAt` 位于上海账期 `[start,end)`；状态可含 CANCELLED。
- 代理归属锁定订单创建时的 `submitterId`，不按当前 User role 回推历史。
- 每 `(agentUserId, period)` 取得 advisory lock；成员依赖全局 order unique 做幂等 merge；总额永远从成员和调整项重算。
- CONFIRMED 在同一锁内重读/同步快照后冻结；已确认账单不接收迟到成员，真实迟到结算按其 `settledAt` 进入实际发生月。
- 标记已收由服务端写当前锁定总额，一次原子插入 Receipt 并 CONFIRMED→PAID；客户端不能传任意收款金额。
- 月界使用固定锁序 `cutoff → agent-period → bill/source-item → idempotency request`，防止结算 writer 与月初扫描遗漏或 ABBA 死锁。

## 7. 第二波实施序列：报工进度、异常、停滞通知（已完成）

已合入事实：计件与无计件进度均为 append-only ledger，累计超过各自当前计划量会在写入时硬拒绝。尚未满足的锁定契约是：PACKING 当前按袋计量，不能证明“打包累计≤工单数量”；认领运行时已被删除，不能证明“下发后无人扫码认领”。第二波先补这两个依赖缺口，再接管理列表。

### W2-01 `feat(owner-orders): project production progress and anomalies`

- 扩展报工契约，为 FOILING、PACKING 分别记录独立于计件工资单位的 `workOrderProgressQuantity`；两道工序的累计进度均以订单总数量为硬上限。PACKING 既有 PER_BAG 数据继续作为薪资计量事实，不拿袋数直接冒充工单件数。
- 增加 append-only 扫码认领事实（或等价的首次扫码 claim event），由下发后的有效扫码写入；不从旧工资任务或页面访问推测认领。
- 从 `ProductionOperation/ProductionReport`、无计件 progress ledger 和新增的工单数量进度/认领事实聚合，不再使用旧 `ProductionTask` 或工资项推测。
- 列表与抽屉显示 FOILING、PACKING 的工单数量进度；任一累计大于订单总数量时朱红“查数据”。
- `packingProgress > foilingProgress` 且两者均未超单量时只提示、不拦截；补报后实时消失，不保存可过期的“异常状态”副本。
- 按订单集合批量聚合，加入查询计划与性能门禁；页签、计数和导出使用同一投影。

### W2-02 `feat(notification): add production anomaly and stagnation alerts`

- 报工异常采用 `packingProgress > foilingProgress` 的边沿触发；停滞由“下发后仍无扫码认领”定时扫描触发。
- 阈值和开关进入类型化 SystemSetting，默认 2 天；通知无金额并带 `#wo=<woNo>` 深链。
- 使用稳定去重键、outbox、投递日志和重试；扫描范围和批量大小可配置。
- 加入真实 PostgreSQL、cron wire 和 E2E 覆盖，不把通知失败升级为报工事务失败。

依赖：

```text
已合入 production ledger ─> W2-01 聚合/异常 ─> W2-02 异常/停滞通知
W1-05 通知配置与深链基础 ───────────────────────┘
```

## 8. 待拍板清单（附默认值）

确认本 PLAN 即视为接受下列默认值；若某项不同意，应在执行 W1-01 前明确覆盖。

| # | 待拍板 | 默认值 |
|---:|---|---|
| 1 | “代理商”主键 | 使用外部 SALES User；账单归属固定为订单创建时 `settlementType=EXTERNAL_SALES + submitterId`，不使用 Party |
| 2 | 9 态历史如何进入 11 态 | expand 后新单走新状态；旧单按工序、发货、费用等可证明事实生成 projection/迁移报告，无法证明的保留 legacy projection，不猜测写回 |
| 3 | 发货与结算边界 | 发货可固化最终费用，但只有显式结算命令写 `settledAt` 并进入 SETTLED/账单 |
| 4 | 历史 `settledAt` | 仅能证明“发货即固化结算”的记录使用对应 `shippedAt`；其他保持 null，账单生成 fail closed |
| 5 | 纸质工单版本 | 新增独立 `workOrderVersion`；现有 `revision` 继续服务 CAS/核价，不复用为打印版本 |
| 6 | 批量下发资格 | 仅已 CONFIRMED、preflight 通过、无待裁决变更、未暂停且仍为当前版本的订单；其余逐单跳过并返回原因 |
| 7 | 待确认积压阈值 | 5 单，SystemSetting 可改 |
| 8 | 通知角色到群 | 工厂确认者=具有确认权限的 ADMIN/排产群；老板=owner group；每类事件可按角色开关 |
| 9 | legacy Bill | 永久只读归档；v2 不回填、不改写、不与 dashboard 混算 |
| 10 | `/sales/bills` | 第一阶段保留 legacy 只读；v2 管理端验收后再以独立 PR 决定销售自助视图，避免静默切换历史口径 |
| 11 | 部分收款 | 新 v2 不支持；一次按锁定总额标记已收，legacy 不受影响 |
| 12 | 错单负项 | 允许部分负调整，累计绝对值不得超过来源成员快照，必须有原因与幂等键 |
| 13 | 下月净额为负 | 禁止确认净负账单；未抵扣信用余额继续滚入下一开放 DRAFT，不 clamp 为 0、不丢金额 |
| 14 | `settledFee=0` | 作为 0 元成员保留审计；0 元账单确认后无需收款即原子转 PAID，并记录 0 元结清事件 |

## 9. 验证与提交纪律

### 9.0 当前执行结果

- 真值文档 SHA-256 复核未变化。
- Prisma format、validate、generate 通过；独立空库 fresh migration chain `132/132` 通过并可 seed。
- `check:architecture` 通过：704 modules、2,612 dependencies、32 个既有 long-function debt。
- lint、typecheck、`check:dead-code` 通过；dead-code 报告为 118 个 knip issue groups、656 个 ts-prune candidates、0 cycles，候选不等于授权删除。
- 完整 Node Vitest 通过：490 files，4,509 passed、43 skipped，共 4,552 tests；同套用例在迁移并 seed 的独立数据库再次通过。
- Vitest browser 通过：2 files、2 tests；production build 通过，Next.js 16.2.4 生成 59 个静态页面。
- 第二次完整 Playwright（定位器修复前）共 116 项：98 passed、6 failed、12 skipped。4 项移动端失败来自测试在 RSC 导航尚未稳定时继续操作的定位器竞争；修复后对 375×667、393×852 的亮/暗主题执行 `--repeat-each=3`，12/12 通过（5.7 分钟）。其余 2 项分别匹配已存档的 `notification-cron.spec.ts:137` 固定逾期天数基线，以及 `[worker-1024x768] worker-responsive.spec.ts:41` dark-token 过渡帧对比度波动基线，均非本轮回归。

### 9.1 每个 PR 的通用门禁

- 写任何 Next.js 页面/API 前，先阅读 `node_modules/next/dist/docs/` 中对应当前版本指南。
- `prisma generate`、`prisma validate`、fresh migrations、migration contract tests。
- `check:architecture`、`lint`、`typecheck`、`check:dead-code`。
- 定向 PostgreSQL 单元/集成测试，随后完整 Vitest + coverage 与 browser tests。
- Playwright 相关功能项目和管理端视觉矩阵；每波结束跑完整 116 项基线矩阵。
- production `next build`。
- 可接受红项仅限两条已存档的同签名基线：`notification-cron.spec.ts:137` 的固定逾期天数，以及 `[worker-1024x768] worker-responsive.spec.ts:41` 的 dark-token 过渡帧对比度波动；任何其他失败均阻止合并。

### 9.2 关键验收

- 队列计数、统计卡、筛选结果、合计和导出使用同一服务端谓词；跨页仍严格新单优先。
- 当前筛选合计覆盖全集，不是当前页；人工待定金额排除且数量可见。
- 抽屉只裁决，编辑跳独立页；URL 深链、刷新、前进/后退均可复现。
- 所有写操作服务端鉴权、事务重校验、幂等；批量逐单回执。
- 打印状态只能由版本化 ledger 证明；修改批准必产生新版/重打事实。
- 三段费用快照语义不变；月账单只读 settled snapshot，不调用报价引擎重建历史。
- CONFIRMED/PAID 账单在应用和 direct SQL 两层均不可变。
- 企业微信消息无金额，失败不阻塞业务事务。
- 911×881 demo 视口、仓库现有 6 组管理视口、亮/暗主题均无页面级横向溢出；数据表内部可控横向滚动。

### 9.3 Commit/删除规则

- 每个 PR 按 schema/migration、domain service、read model、UI、tests/docs 拆成可审查逻辑 commit，不使用一次性混合提交。
- 清理改动与功能改动绝不进入同一 commit。
- 本计划不授权删除 legacy 状态、Bill、公开 API、migration、动态 import、注册表、i18n key 或生产分支。
- 若后续出现删除候选，先全仓 `rg` 检查配置、构建脚本、SQL、Prisma schema/migrations 和动态入口，记录实际引用；每一条删除后分别 build/test/typecheck，失败立即回滚该条删除。

## 10. 完成状态与剩余发布步骤

原“输出 PLAN 后停下等待确认”的停止点已由用户明确解除。业务实现、schema、9 个 additive migrations、领域测试与质量门禁均已完成；没有顺手修复或放宽两条既有基线断言。

剩余发布步骤仅为：按逻辑边界拆分 commit、push、创建 PR、合并主分支，以及在主分支执行浏览器验收并启动本地 3000 端口开发服务器。任一不属于上述两条已存档基线签名的 E2E 回归仍须在合并前修复。
