# 外部销售前端复审（2026-09-30）

基线 `84532f1a`（UI 整改第二轮之后）。范围：外部销售（`Role.SALES`）登录后能用到的全部前端——工作台 `/workbench`、新建工单 `/orders/new`、我的工单 `/orders`（含预览抽屉）、工单详情与编辑 `/orders/[id]`、`/orders/[id]/edit`、我的账单 `/sales/bills`、改密与外壳导航，以及这些页面调用的全部 Server Action / Route Handler。本轮只审查，**没有改业务代码**。

> **2026-10-01 收入 main 时的修订说明**：
> - 本文结论对应基线 `84532f1a`，是历史审查结果。此后 main 已修复部分条目（例如 N-4 建单页内出口的离开保护、B-2 中的工单列表命名，见 HANDOFF 2026-09-30 条），动手修复前须逐项对照当前 main 复核；§七是当时的建议顺序，不是当前计划。
> - §三 第 2、5 项原写作与字段对照表「既定口径冲突」。复核 [工单编辑字段对照表](../工单编辑-字段对照表.md) 后，所引 F18/F47/F48、F43/L7 并未规定这两项约束，已改写为「现有文档未明确，建议澄清」，问题本身保留。

上一轮外部销售审查见 [2026-09-12 审查](2026-09-12-external-sales-comprehensive-review.md) 与 [修复验收](2026-09-12-external-sales-fix-acceptance.md)；全库 UI 审查见 [2026-09-29](2026-09-29-ui-review.md)。已登记为已修 / 已接受的问题不重复报，除非发现回归或修得不完整。

## 结论

- **P1 2 项**：取消任何真实草稿都 500 并整页报错（数据库约束，管理员同样中招）；iPhone Safari 上滚动工单列表后点名称打不开预览。
- **P2 24 项**，其中 19 项已在浏览器 / 数据库实测复现；**P3 约 40 项**；另有 6 项规则口径需业主拍板（与规则冲突或现有文档未明确，见 §三）。
- 没有发现越权或数据泄露：所有 SALES 可调用的写入口都校验归属，销售投影不含成本、内部说明、客户资料或他人信息（逐入口核对表见 §五）。
- 现有外部销售相关 E2E 全绿（61 项，见 §六），但**都没覆盖到上面的缺陷**——两个 P1 的共同原因是测试夹具与真实数据形状不同（夹具直接插入 `priceRevision = 1` 且带物流收费行的草稿；WebKit 兼容套件不覆盖销售列表滚动）。

## 方法与环境

| 层 | 做法 |
|---|---|
| 代码审查 | 5 个只读子代理按功能块并行（工作台 / 新建工单 / 列表与外壳 / 详情与编辑 / 账单与授权横切），每条发现要求追到被调用函数本体并给 `文件:行号` |
| 运行时复现 | 一次性隔离库 `erp_e2e_salesreview_20260929`（迁移 + 种子 + `test:e2e:prepare`），`next dev` 于 `127.0.0.1:3310`，通知 / CDR mock、后台任务 inline、OSS **未配置**；以 `e2e-sales` 登录，在内置浏览器逐条复现 |
| 移动端 | 375×812 检查四个主页面无横向溢出；L-1 用 Playwright WebKit（iPhone 13 设备描述）脚本复现 |
| 回归 | 先在同库跑现有外部销售相关 E2E，既作回归信号，也造出 16 种状态的测试工单 |

标记：**实测** = 本轮在浏览器 / 数据库复现；**代码** = 调用链已走通，未在浏览器复现（多数因 OSS 未配置或需要管理员配合）。

## 一、P1

### 1. 取消任何真实草稿都失败：500 + 整页「此页面暂时无法加载」【实测】

- 外部销售草稿建单时写 `priceRevision: 0`（`lib/order.ts:863`，工作台寄样 / 打样草稿、管理员代存草稿、建单上传失败后留下的草稿都走这里）。
- 约束 `Order_priceRevision_check`（迁移 `20260924110000_remove_customer_service_role` 第 172 行起）只允许 `priceRevision = 0` 时 `status = 'DRAFT'`。
- `cancelOrder`（`lib/order.ts:1659`）经 `transitionWithLog` 只改状态，不动 `priceRevision` → 写库违反约束 → 未知错误按 §15.3 继续抛出 → `CancelOrderForm` 所在页面落入错误边界。
- 实测两次：打样草稿 GD-260930-012（详情页取消）、`/orders/new` 正常创建的普通草稿 GD-260930-014（编辑页取消）。服务端日志 `violates check constraint "Order_priceRevision_check"`，`POST … 500`。
- 影响：销售与管理员都无法取消任何经界面产生的草稿；取消入口只对 DRAFT / PENDING_FACTORY / REJECTED 开放，后两者已提交过、`priceRevision ≥ 1`，所以只有草稿中招。生产库目前工单为空，尚未触发。
- 测试为什么没发现：单测 mock 了数据库；E2E「三个状态真实取消成功」的草稿夹具是直接插入的，`priceRevision = 1`。

### 2. iPhone Safari：滚动列表后点工单名称打不开预览，抛未捕获 SecurityError【实测，WebKit】

- `components/business/order/OrderListNavigationState.tsx:94-96` 在每个滚动帧调用 `history.replaceState`（只按帧合并，不限流、无 try/catch），组件只挂在销售分支（`OrdersListContent.tsx:192`）。
- WebKit 限制 10 秒内最多 100 次 `replaceState` / `pushState`。预览抽屉打开时 `SalesOrdersList.tsx:133` 调 `pushState`，也被拒。
- 复现（Playwright WebKit + iPhone 13 描述，登录 `e2e-sales`，以 60fps 滚动 3 秒后点第一张工单名称）：3 次运行 `replaceState` 共约 180 次调用、81–85 次抛 `SecurityError`，URL 没有 `#wo=`，抽屉未打开，开发态出现错误浮层。Chromium 下不报错，所以桌面测不出。
- 影响：SPEC §2.1 写明销售主要用手机，iOS 上所有浏览器都是 WebKit；滑一两秒后 10 秒内点名称无反应，异常大量进 Sentry。「期间点 Link 导致 Next 路由 pushState 抛错、整页崩溃」为推测，未复现。

## 二、P2

| # | 问题 | 证据 | 验证 |
|---|---|---|---|
| W-1 | 寄样品勾「顺丰到付」后切到「打样」，看不见的勾选随打样单一起保存；详情、打印单都显示顺丰到付 | `SampleOrderForm.tsx:138` 不分类型写 `isSfCollect`，复选框只在寄样渲染（`:467`）；切换类型不清（`WorkbenchCalculator.tsx:155`）；违反《寄样与打样开发任务》「类型切换时清除不适用的计费输入」 | 实测：GD-260930-012 `isSfCollect = t`，详情页头「顺丰到付」 |
| W-2 | 工作台保存样品草稿后从侧栏离开，回来整个计算器锁在旧草稿；草稿已在别处提交 / 取消时，提交报「工单状态不能从 CANCELLED 直接切到 PENDING_FACTORY」 | `useSampleWorkbenchDraft.ts:40,72-80`；报错来自 `status-machine.ts:10`，`transitionWithLog` 先判状态后判归属（`lib/order.ts:1342-1343`），`actions/order.ts:237,274` 原样返回；详情页双标签提交 / 取消同样外显枚举 | 实测 |
| W-3 | 「查看已保存工单」/ 提交后，上一单的类型、收件人、电话、地址、到付被立刻写回 sessionStorage，下次进工作台自动恢复，再保存会建第二张单 | `useSampleWorkbenchDraft.ts:90-116`：`clearSampleDraft` 只清 draft，持久化 effect 随即重写 | 实测：跳转后 sessionStorage 仍含 `purpose: PROOF` 与完整收件信息，回到工作台已恢复 |
| W-4 | 打样草稿上传设计图后始终显示「设计文件（0）/ 暂无设计图」，传过的看不到也删不掉 | `SampleOrderForm.tsx:321-327` 写死 `designs={[]}` | 代码（OSS 未配置无法上传） |
| N-1 | 额外地址分货为 0 / 主地址被分空时，真正的错误不可见，摘要只说「请等待最新费用报价完成」 | `OrderForm.tsx:3084-3086` 读 `.itemQuantities.message`，实际错误挂在 `.root`；摘要（`:2522-2553`）不收 `additionalShipments.*`；分配为 0 时不发报价（`:1920-1922`） | 实测：分配 0 → 只有「请等待…」且输入框无 `aria-invalid`；改成 500 后该提示消失 |
| N-2 | 复核弹窗在草稿已创建后困住用户：「返回修改」和 Esc 都无效，也没有打开草稿的入口 | `OrderForm.tsx:3355-3359,3403-3405`；「打开草稿」只在 `intent==='draft'` 渲染，销售不能存草稿 | 实测：设计图上传失败后弹窗只能「继续完成」 |
| N-3 | 报价变化后复核弹窗合计是新价，逐款金额和费用明细仍是旧价 | `OrderForm.tsx:3375-3381,2437-2440,1996` | 代码 |
| N-4 | 建单页站内导航不拦截，已选设计图 / CDR 点链接即丢，上传中也能离开 | `use-order-form-leave-guard.ts:18-31` 只监听 `beforeunload`；对照编辑页有 `SalesOrderEditGuard` | 实测 |
| N-5 | 销售端静默恢复本地草稿时不提示「图片和 CDR 未保存」，却显示「草稿已保存 HH:mm:ss」 | `OrderForm.tsx:940-966,3112-3116`；附件提示只对管理员渲染（`:2695`） | 实测 |
| N-6 | 往主收货地址框粘贴会清空已填的收件人和电话 | `OrderForm.tsx:3272-3277` 无条件 `setValue`；已有的 `applyParsedReceiverFact`（`receiver-address-paste.ts:138-151`）只用在额外地址 | 实测：粘贴「A座1001」后收件人、电话被清空 |
| N-8 | 提交成功页把「待工厂核价」染红，状态词另立本地表 | `OrderSubmissionSuccess.tsx:53-55` 用 destructive；`OrderForm.tsx:2620-2622` 本地「待处理」≠ 销售词表「待工厂处理」；#2 整改未覆盖此处 | 代码 |
| N-9 | 多地址分货输入框标签只有「#序号 设计款名」，同一设计款多个规格分不清 | `OrderForm.tsx:3067-3068`；包装区用「设计款 N · 规格」（`:2467`） | 代码 |
| N-10 | 快递费依据的省份由浏览器提供，服务端不与地址核对 | `lib/order.ts:780,793`；`submit-external-order.ts:497-499`；对照同处刻意丢弃浏览器重量 | 代码（可能；需确认发货时是否纠正） |
| D-1 | 草稿上「标记顺丰到付」必失败：「快递/耗材收费明细不完整，无法切换顺丰到付标识」 | 草稿不生成收费行（`lib/order.ts:823-828`），切换要求每地址 2 行（`:3060-3062`）；`add-shipment.ts` 有草稿分支、这里没有 | 实测：工作台寄样草稿 GD-260930-013 |
| D-2 | 样品 / 打样工单的「申请修改」照样提供改款式、增加款式，提交必被拒 | `SalesOrderDetailView.tsx:75-101` 未传 purpose；`change-request.ts:554` 拒绝 | 实测：「样品工单的款式需重新建单…」 |
| D-3 | 编辑页取消弹窗填了原因后，「保留工单」/ Esc 被拦，叠出第二层「请先保存当前修改」 | `SalesOrderEditGuard.tsx:37-40,74-75,130` 命中 `alert-dialog-cancel` | 实测 |
| D-4 | 草稿金额三处口径不一：列表「—」、预览分项有金额合计「—」、详情「待工厂核价」+ 带「估」分项 | `sales-list-presentation.ts:83-87`；`amount-presentation.ts:40` 只在 `amount === null` 走草稿分支，而 `sales-detail-query.ts:356` 恒非 null | 实测（寄样草稿） |
| D-5 | 已取消工单仍显示原报价与「待发货」，与「待工厂处理直接取消零费用」矛盾；生产中取消结算后分项与合计对不上 | 直接取消不动费用（`lib/order.ts:1362-1375`）；详情合计回落 `confirmedFee/quotedFee`（`sales-detail-query.ts:311-356`）；规则见《工单变更与版本规则》§1 | 实测：已取消单列表与详情均「¥130.00估」、地址「待发货」 |
| L-2 | 列表行与预览抽屉不显示驳回 / 暂停原因，卡片按钮却叫「查看原因」（09-12 第 5 项只修了详情） | `sales-list-query.ts:154-226` 未查决定；抽屉只有通用文案（`sales-list-presentation.ts:62-63`） | 实测 |
| L-3 | 销售搜索栏漏了两项已标「已修」的整改：仍是原生 GET 整页刷新（#41）、「搜索」仍是实心主按钮与「新建工单」并存（#36） | `SalesOrderListFilters.tsx:112,154` | 实测（手机上同屏三个实心主按钮） |
| B-1 | 我的账单点「清除筛选」/ 后退后，下拉仍显示旧状态，再点「筛选」又带回旧条件 | `sales/bills/page.tsx:29-33` 非受控 `defaultValue` + Link 软导航不重挂载；`owner/agent-bills` 等同写法 | 实测 |
| B-2 | 名称不同源（ui-规范 §8.3，#29 标已修）：销售侧栏「我的工单 / 我的账单」，title / H1 / 面包屑却是「工单列表」「我的对客应付账单」；账单详情面包屑末段为「详情」，返回链接「返回我的对客应付账单」；「对客」是工厂视角 | `admin-modules.ts:409,421`；`orders/page.tsx:15,29`；`AdminBreadcrumb.tsx` `'/orders'`；`sales/bills/page.tsx:12,21`；`[id]/page.tsx:18,27`；视觉测试把现状锁住（`admin-responsive.spec.ts:1070`） | 实测 |
| X-2 | 列表行与预览抽屉仍显示旧纸张名（如「珠光艳闪」），同一张单详情是「艳红珠光纸 160g」，违反 DECISIONS 2026-09-23 | `sales-list-query.ts:564,690` 的 `formatPaper` 未用 `paperDisplayLabel`；详情查询已用（`sales-detail-query.ts:2,456`） | 实测 |
| N-7 | 销售建单没有「急单 / 承诺交期」；提交后若自动进入待下发生产，就再也不能标急单 | `OrderForm.tsx:2720-2721` 对销售不传 `orderExtras`；CONFIRMED 属 SHIPPING_ONLY（`editable-fields.ts:51-58`）；SPEC §2.2「标记急单 销售 ✓」、§3.1「是否急单」 | 实测；是否有意需业主确认（见 §三） |

## 三、需业主拍板（代码与规则口径冲突或现有文档未明确，不能由 AI 定）

1. **排产后销售能否直接改收货信息 / 备注 / 包装要求**（D-6 / A-2）：SPEC §2.2 权限矩阵写「修改工单（排产后）销售 —」；§3.6 与《工单变更与版本规则》§1 允许已确认后直改收货信息和备注，且未区分角色。现代码允许（`editable-fields.ts:51-58`、`lib/order.ts:2700-2705`，只用 `order:create` 把关）。规则 §1 写的「轻变更直改后通知工厂」也没有实现。
2. **生产中直接改款式名称 / 款式备注 / 包装组名称是否应升 `workOrderVersion`**（D-7）：现代码直改不升版本，已打印的纸质工单会与系统名称不一致，而扫码页不会提示作废。现有文档未明确，建议澄清：字段对照表 F18/F47/F48 只写文字编辑不改目录、数量、费用或审批状态并受 L4 约束，没有涉及版本；《工单变更与版本规则》§1 对生产中状态的「直接改」只列收货信息，§3 只把升版本绑定在变更申请批准上，也没有规定直改文字时如何处理。
3. **销售建单不提供急单 / 交期**（N-7）：3f64bba5（08-27 重建外部销售建单）起即如此，SPEC 与使用手册 §4.1 仍写可填。
4. **草稿可提交修改申请**：代码对 DRAFT / PENDING_FACTORY / REJECTED 开放修改申请（`ORDER_MODIFIABLE_STATUSES`），SPEC §3.6 也提到草稿申请；但《工单变更与版本规则》状态表写草稿「直接改、无变更申请」。草稿上出现「管理员批准后才会更新」对销售是困惑的。
5. **销售详情是否展示「稿件版本」**（D-14）：现销售详情展示该字段（`sales-detail-query.ts:477`），单测也断言可见。现有文档未明确，建议澄清：字段对照表 F43/L7 只规定销售建单不展示、编辑页不向销售开放（保持原角色边界、不扩权），没有规定详情只读展示。
6. **被拒申请的「需关注」如何消除**（L-7 第 4 点）：目前只有再提一次申请才能退出需关注，没有「知道了」。

## 四、P3（规范与小的不一致）

| 块 | 问题（证据） |
|---|---|
| 工作台 | W-5 刷新后首次提交必提示「费用已更新」但实际未变（`SampleOrderForm.tsx:103,235`）；W-6 入口「创建工单」应为「新建工单」，样品「保存工单」与主建单「保存草稿」叫法不一；W-7 「保存工单」禁用无原因、提交中文案挂在次按钮、「查看已保存工单」上传中也能点；W-8 样品表单必填无 `RequiredMark`、错误不定位字段、「请填写款式名」与标签「样品名称」不一；W-9 建单时快递费恒待核价却提示销售「补齐计费重量」、「最小包装」与最小档重复；W-10 加价比例填错显示「待核价」；W-11 目录不可用提示「先查看销售资料」但无此分区、每张纸卡固定「交期请确认」 |
| 新建工单 | N-11 界面允许 50 个规格、报价与建单 schema 只收 20 个；N-12 主路径不用 `PageHeader`、无返回入口；N-13 单张提交后批量栏仍「已完成 0 / 1 张」与「工单均已保存」并存（实测）；N-14 额外地址「收货人 / 联系电话」与主地址「收件人 / 收货电话」不一、无必填标记、向销售暴露「快递代码」、按钮「删除地址」应为「移除」（实测）；N-15 成功页说「可从详情查看」却无「查看工单」；N-16 本地草稿时间未指定上海时区、「包装费 ¥0.00」手写、复核弹窗数量用「件」（实测）；N-17 向销售外显「加工 v12 / 物流 v3」，草稿保存失败用 muted 小字；N-18 同一设计款每个规格各传一遍同一批文件；N-19 移除首张工单不清其本地草稿；N-21 「外部销售应付工厂」页头与费用栏重复 |
| 列表 / 外壳 | L-6 预览费用列出已免除的 ¥0.00 行、多地址物流行无「地址 N」前缀；L-7 已发货 / 已取消单永久挂「申请被拒」、兜底文案两套、STALE 申请静默消失；L-8 搜索实际匹配收件电话 / 运单号，却搜不到工单名拼音；L-9 旧管理员参数被静默丢弃却红字报「保存视图不合法」（实测）；L-10 预览加载失败直接显示「Failed to fetch」；L-11 同卡「价格待管理员确认」与「待工厂核价」并存，列表 `v2` 与详情「第 N 版」；L-12 无结果态按钮「查看全部工单」应为「清除筛选」，清除搜索 X 无 `scroll={false}`；L-13 销售访问 `/orders/production` 看到「安排生产师傅」外壳（实测，无数据泄露）；L-16 侧栏分组名与首项同为「工作台」；L-17 `type="search"` 可能出现两个清除按钮（未截图确认） |
| 详情 / 编辑 | D-8 提交 / 撤回 / 取消 / 修改 / 取消申请的成功回执渲染在会卸载的分支里，提交申请后页面无任何回执（实测；状态变化仍可见）；X-3 「最近申请」只显示类型与原因，不显示申请的内容（新交期、新数量），销售无法核对自己申请了什么（实测）；D-9 编辑页三个返回入口（页头「返回工单列表」、「返回工单」、表单「取消」），急单开关出现两次，面包屑末段为「工单详情」而非「编辑」；D-10 驳回原因「受影响款式」可能为空且不跳转；D-11 申请表单向销售外显「历史报工和工资保留」，自动失效的审核说明含原始状态枚举（`change-request.ts:5784`）；D-13 删除设计文件无确认、无回执 |
| 账单 | B-3 账单明细「版本」是纸质工单版本，与详情「第 N 版」不是同一计数；B-4 状态用付款视角「待支付 / 已结清」，详情却是「收款记录 / 收款时间」，使用手册写的费用拆分页面没有；B-5 未筛选时空态也说「当前筛选条件下暂无账单」（实测）；B-6 金额列缺 `tabular-nums`、表头未对齐、负数未用 `formatMoneyDelta`、月份输入未用 `Input` 原子件、草稿提示手写警示框；B-7 不支持 `type="month"` 的浏览器周期筛选被静默丢弃 |
| 横切规范 | 权限字典不是唯一来源：`order:update:pre-schedule`、`order:mark-urgent` 无引用，多数写 action 只用 `order:create` 把关，真正限制散在 lib 与 handler 的角色判断（`edit-item-remark.ts:21`、`edit-sales-text.ts:19`、`create-order-quote.ts:51`、`actions/order.ts:106,264`、`api/orders/sales/[orderNo]/handler.ts:25`；§4.6）；未知错误被吞成笼统提示（`actions/workbench.ts:184-188`、`create-order-quote.ts:153-160`、`actions/order.ts:573-577`；§15.3），「请检查价目配置」对销售不可执行；`'use server'` 模块导出类型 / 非 `MutationResult` 返回（`design-upload.ts:60`、`order-sales-text.ts:5`、`account.ts:10`、`auth.ts:12`；§15.3）；销售接口 ADMIN 调用返回 401 而非 403、错误响应无 `no-store`；`orders/page.tsx:24` 用角色字面量决定「新建工单」；使用手册 §4.1「销售操作步骤」与现界面多处不符（「计算并应用建议价」「填写计费重量」「草稿阶段进详情上传」等） |

## 五、检查过、未发现问题

- **越权**：列表、计数、需关注、预览接口都带 `getOrderScopeFilter`；他人单号 404 不区分存在与否；详情 / 编辑只用销售投影（显式 select 白名单）。所有 SALES 可调用写入口在工单锁内校验提交人 / 申请人与版本：建单（拒绝 `externalSalesUserId`、价格、运费等服务端字段）、提交（报价令牌服务端重算）、取消（`editVersion`）、编辑、急单、到付、改名 / 备注、新增地址（预览令牌）、修改 / 取消申请与撤回、设计图签发 / 登记 / 删除（`objectKey` 前缀）。打印 / PDF 对销售返回 404，与无入口一致；CDR 下载令牌不依赖会话。账单列表、详情、页标题都限 `agentUserId = actor.id`，不选取 `customerRefSnapshot`。
- **重复提交与草稿隔离**：`clientSubmissionId` 事务内幂等并校验指纹；本地 / 会话存储键带 `user.id` 与结算口径。
- **计数口径**：16 种状态分类不重叠、合计等于「全部」；「需关注」计数与筛选同条件；非法 `page / view / scroll / q` 有兜底。
- **登录 / 改密 / 登出**：`from` 做开放跳转防护，销售落在 `/orders`；改密零 JS 可提交。
- **移动端**：`/orders`、`/orders/new`、`/workbench`、详情页在 375 宽无横向溢出，详情页按钮触控尺寸达标。

逐入口授权核对表（子代理产出，已抽查）：

| 入口 | 权限 | 归属 / 状态 / 版本 | 结论 |
|---|---|---|---|
| createOrderAction | order:create | 提交人为本人；SALES 传服务端字段被拒 | 通过 |
| submitOrderAction / cancelOrderAction | order:create / order:cancel | 提交人 + 报价令牌 / editVersion | 先判状态后判归属（W-2），取消草稿 P1 |
| updateOrderAction / setOrderUrgentAction / setOrderSfCollectAction | order:create | 范围过滤 + 提交人 + editVersion | 通过；口径见 §三-1 |
| editSalesTextAction / editItemRemarkAction | order:create | lib 分别限 SALES / ADMIN | 通过（散落角色判断） |
| addOrderShipmentAction | order:create | 提交人（加锁后校验）+ 四个版本 + 预览令牌 | 通过 |
| create / withdrawOrderChangeRequestAction | order:change:request | 提交人 / 申请人 + revision | 通过 |
| sign / record / deleteDesign | design:upload | 提交人 + 草稿或驳回 + 无待审申请 + 锁内复核 | 通过 |
| 报价类 action | order:create | 只读 | 通过（吞错见 §四） |
| 管理员编辑 / 其余 ADMIN / WORKER action | 各自专属 key | — | SALES 被拒 |
| GET /api/orders/sales/[orderNo] | order:view:self | 按提交人过滤、字段白名单 | 通过 |
| /api/orders/[id]/pdf、/print/orders/[id]、/wo/[orderNo] | 会话 + 打印 / 工单范围 | 对 SALES 返回 404 / 范围过滤 | 通过 |

## 六、现有测试结果（同一隔离库，开发配置，chromium 单 worker）

- 第一轮：`auth`、`bill-flow`、`order-create`、`order-delete-navigation`、`order-external-sales-association`、`order-multiple-addresses` 及 `sales-functional-review` 前 7 项，23 项全部通过；随后后台进程被中断（exit 144，非测试失败）。
- 第二轮：`sales-functional-review`（全部）、`workbench`、`sample-orders`，38 项全部通过。
- 子代理另跑 `lib/workbench`（44 项）、`sales-list-query` 与销售接口路由测试（15 项）、账单查询两份（18 项），全部通过。

## 七、建议修复顺序

1. **P1-1 取消草稿**：取消时让草稿满足约束（例如同事务把 `priceRevision` 置 1，或放宽约束允许 `priceRevision = 0` 的 CANCELLED 草稿——需评估对账 / 报价链路），并补一条**经界面真实建草稿再取消**的 E2E，而不是插入夹具。
2. **P1-2 iOS 滚动**：滚动状态改为节流写入（如 `scrollend` / 停止滚动后 250 ms 一次）并给 `replaceState` / `pushState` 加 try/catch；把销售列表滚动 + 打开预览加进 `playwright.compat.config.ts` 的 `ios-webkit`。
3. **流程卡死类**：N-1、N-2、D-1、D-2、D-3、W-2、W-3（都是「点了失败 / 退不出去 / 重复建单」）。
4. **信息口径类**：D-4、D-5、L-2、X-2、B-2、N-8、W-1。
5. §三的 6 项先请业主拍板，再改代码或规则文档；同时更新使用手册 §4.1。
6. 每修一类，按 [2026-09-29 UI 审查](2026-09-29-ui-review.md) 的 L6「裁决与回流」转门禁：夹具生成改走真实 action；`Order` 状态写入加「约束兼容」单测（对真实库跑 `*.postgres.test.ts`）。

## 证据与环境

- 隔离库 `erp_e2e_salesreview_20260929` 保留（含本轮复现用的 GD-260930-012 ~ 014）；审查结束后可 `DROP DATABASE`。其中 GD-260930-012 为模拟「别处已取消」手工改过状态（`priceRevision = 1, status = CANCELLED`），不是业务写入。
- WebKit 复现脚本与 E2E 日志在会话临时目录，未入库。
- 未覆盖：真实 OSS 上传 / 下载（本环境未配置 OSS）、生产构建下的时序、管理员驳回 / 核价等跨角色全流程、1920 / 768 等中间视口与暗色。
