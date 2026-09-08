# 29ab47e 工单变更审查复核

审查目标：`29ab47e17b2a325d2de1da3e5805fd4887c4eb7e`，相对父提交。

## 独立复现并修复

1. **P1：纯交期审批重算历史金额。** `buildUnchangedPricingPreview` 承诺原价不变，但 `persistApprovedModificationPricingInTx` 无条件汇总款式和附加费。历史明细不足时，3000 元被尝试写成 0 元；内部销售还会尝试扣减客服业绩。修复为只有存在计价事实变化的投影时才重算和写价格，其他变更保留原加工费、总价、费用快照。回归测试先红后绿，覆盖外部销售和内部销售；真实数据库及浏览器确认历史原价保留。

2. **P2：无款式历史工单的交期申请入口缺失。** 编辑页以款式数量大于零作为整个申请区的前置条件，与允许 `items: []` 的交期提案不一致。修复为按授权、状态和待审条件显示申请入口；无款式时只显示交期，隐藏不可用的款式选择和新增操作。浏览器测试在修复前找不到入口，修复后完成提交、审批、落库。

3. **P2：交期刷新不重建申请草稿。** `orderChangeRequestDraftIdentity` 缺少新加的 `promisedDate`，而基本资料更新仅改变 `editVersion`。当前交期刷新后草稿仍保存旧日期和原因。将交期纳入草稿标识；浏览器先复现原交期 9/10、草稿 9/20、当前交期刷新到 9/15 后仍显示 9/20，再验证修复后显示 9/15、清空旧原因并禁用无变化的提交。

## 验证与边界

- 独立工作树只包含目标 HEAD 和本次补丁。
- 全量 Vitest：5471 通过、55 环境跳过（539 文件通过、3 跳过）。
- 表单浏览器测试：19 通过，覆盖六视口、明暗主题、有/无款式、触控尺寸、溢出、axe 与草稿刷新。
- E2E：2 通过；专用数据库、独立 3100 测试服务，正常创建/编辑/交期审批与历史工单审批均完成。
- typecheck 通过；lint 0 错误、2 项既存未使用声明警告。
- 历史测试夹具首次违反报价快照完整性约束，改为合法的无报价快照历史数据。一次导航发生在详情页自动预览尚未完成时，添加等待预览网络完成与导航地址断言后通过。
- 不改已应用迁移、不重写历史报工或工资、不改价目规则；只保存本任务补丁，原有工作区改动保留，不 push。

## Grok 调用与覆盖范围

使用本机 Grok CLI，报告模型为 `grok-4.6-build`，有效审查会话为 `01a07ce2-be6d-7420-af6f-787b95e3c541`。只读 worktree 固定在目标提交，未向 Grok 提供数据库或环境密钥。

长会话读取了全量 diff 与核心调用链，但多次调用超时，未生成完整报告。最终有效报告是对 `change-request.ts`、`OrderChangeRequestForm.tsx` 和编辑页所给源码的定点审查，**不代表 Grok 已完整通过该提交全部 69 个文件**。

Grok 提出的两项界面缺陷均经独立复现成立并修复。它将非计价审批回写金额列为“不记缺陷”；本地以实际输入和先红后绿的回归测试推翻此判断。向 Grok 提供反例后，它撤回原判断并认可修复。Grok 复核定为 P0；因触发依赖历史明细与原金额不一致、且需批准非计价提案，本次独立定级为 P1。批准时递增业务 revision 本身符合流程，不改动该行为。

## Grok 有效报告原文

## 定点对抗审查结论

### 1. 空明细工单无法走「纯交期」修改（与允许 `items=[]` 矛盾）

- **触发**：`order.items.length === 0` 时进入 `app/(admin)/orders/[id]/edit/page.tsx`。
- **后果**：`canModify` 被 `order.items.length > 0` 卡死为 false；不拉目录、不渲染修改申请。纯交期（服务端已允许 `items=[]`）在页面层不可达。
- **反证**：调用方约定允许 `items=[]` 的纯交期；报价片段在无定价变更时仍返回 `promisedDateChange` 且 `items` 可为空。
- **最小修复**：`canModify` 去掉 `items.length > 0`（或：无明细时仅开放交期，不依赖目录）。

### 2. 草稿 identity 不含 `promisedDate`，与「基本信息 CAS、不涨 revision」叠加会脏交期

- **触发**：基本信息改交期走 `editVersion` CAS、**不** `revision++`；修改表单已挂在 `/orders/[id]/edit`（或同 key 软刷新）。`orderChangeRequestDraftIdentity` 只绑 `orderId / expectedRevision / expectedWorkOrderVersion / items / catalogProducts`，`key` 不变。
- **后果**：`dueDate` 的 `useState(promisedDate ?? '')` 不重置。`dueDateChanged = modifyKind === 'DUE_DATE' && (dueDate || null) !== promisedDate` 会在用户未改交期时为 true，把**过期交期**当提案提交；或 UI 显示旧交期、服务端已是新交期。
- **反证**：identity 源码无 `promisedDate`；`OrderChangeRequestDraftForm` 用稳定 `key` + 本地 state。基本信息明确不涨 `revision`，因此 revision 不能当交期失效依据。
- **最小修复**：identity 纳入 `promisedDate`（或 `editVersion`）；或 `dueDate` 随 `promisedDate` 同步，不要只靠 mount 初值。

### 3. 批准路径在 `projected == null` 仍无条件 `revision + 1` 并回写金额（非本批约定缺陷则忽略）

按你给的约定：`pricingChanged=false → projected=null`、批准末尾仍用库内金额持久化。`if (projected)` 跳过纯引擎对账、仍 `processingAmount`/`totalAmount` 回写，与约定一致，**不记缺陷**。
`nextRevision = request.order.revision + 1` 发生在**变更申请批准**，不是基本信息 CAS；与「基本信息不加 revision」不是同一条路径，**不记缺陷**。

---

仅审查：`lib/order/change-request.ts`（约 3665–3687、4981–5050）、`components/business/order/OrderChangeRequestForm.tsx`（约 84–141、475–481、551–562）、`app/(admin)/orders/[id]/edit/page.tsx`（约 58–69）。未跑测试、未读其余调用链。

## 修改与验证入口

- [审批金额持久化](../../lib/order/change-request.ts)
- [交期申请表单](../../components/business/order/OrderChangeRequestForm.tsx)
- [编辑页](../../app/(admin)/orders/[id]/edit/page.tsx)
- [领域回归测试](../../lib/order/__tests__/change-request.test.ts)
- [浏览器回归测试](../../components/business/order/__tests__/OrderChangeForms.browser.spec.tsx)
- [完整审批 E2E](../../tests/e2e/order-create.spec.ts)

## Grok 收到反例后的修正

原判定有误：「无 projected 仍回写金额」与 API.md「纯交期不重新计价」冲突，不能当无害重写。

**反例**：`SUBMITTED`、`items=[]`、无发货/客收；`processingAmount=2800`、`totalAmount=3000`；只改 `promisedDate`。preview：`newTotal=3000`、`delta=0`。批准却用空明细 `orderTotal` + 空客收得到 0，写入 `processingAmount/totalAmount=0`，销售账尝试 −3000（无周期则整单失败）。preview 与持久化不一致。

**优先级**：P0（金额被清零、业绩符号错误）。

**现修复符合契约**：`projected=null` 不汇总、不回写费用、保留原金额与快照；仅 `projected` 有值才重算。纯交期只改交期字段即可。

独立复核：只改交期不应写金额，但仍须保留业务 revision、生产版本、审批记录及审计流程；未照搬“只改交期字段”作为完整持久化方案。
