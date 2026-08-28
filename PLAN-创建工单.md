# 创建工单（外部销售端）实施计划

> 2026-08-28 最新决策：外部销售建单 UI 固定使用当前 B 版。不实施、不切换任何其他展示版本；数据模型、配置读取、权威计费、统一预览、提交快照与 `PENDING_FACTORY` 全部接入 B 版。

> 状态：已执行完成；2026-08-28 的 B 版保留决策为最新产品真值。  
> 目标页面：外部销售端 `/orders/new`。  
> 目标方案：保留仓库当前 **B 版**界面与交互，把新数据、统一报价和提交链路接入 B；`创建工单-三版设计.html` 只继续作为业务规则与交互取舍参考，不再作为 C 版视觉切换要求。  
> 本计划基于 2026-08-28 当前工作树；工作树已有大量未提交改动，执行时必须按本文的基线与隔离规则保护既有成果。

> 执行进度：PR-0 至 PR-7 已完成；B 版统一报价、严格 payload、草稿事实化、提交端二次缺货复核、`QUOTE_CHANGED` 再确认和首个正式费用 revision 均已落地。管理员端浏览器确认仅渲染 B 版；全量测试、类型检查、Prisma 校验、ESLint、生产构建与建单 Playwright 金路径均已通过。

## 0. 结论与约束优先级

### 0.1 一句话结论

当前外部销售建单已经具备可靠底座：配置价表、服务端重算、加工与物流双版本流、入袋/纸箱/快递费用、正反面颜色、B 版复核层和真实设计图预览。实施顺序为“schema 扩展与兼容 → 统一纯函数引擎 → 配置读取 DTO → B 版接入与交互补强 → 提交时原子锁价 → 删除无消费者的旧预览拼接代码”。

### 0.2 真值优先级

发生冲突时，严格使用以下优先级，不自行重新设计：

1. 本任务中“已锁定的决策”；
2. `加工费计费规则.md`；
3. `工单变更与版本规则.md`、`工单状态机.mermaid`、`工单流程-1-销售建单.mermaid`；
4. 用户最新确认的当前 B 版视觉与交互；
5. 仓库现有行为（作为兼容基线，而非产品真值）。

因此以下参考稿/旧代码行为明确不采用：

- 参考 HTML 删除款式后重新编号；目标必须保留 `fig`，删除不回收编号。
- 参考 HTML 的硬编码纸张、规格、颜色与价表；目标必须读取配置及版本快照。
- 参考 HTML 底部只汇总款式加工费；目标必须同时保留入袋、制版费待定、纸箱、快递与合计。
- 旧代码用 `MANUAL_QUOTE` 当作用户可选计价路线；目标中人工核价是引擎输出状态，不是工艺输入。
- `usesExternalSalesPricing` 不再充当 UI 版本开关；只由 `settlementType` 选择结算与 Rail，展示层固定使用 B 版。

## 1. 规则配置中心菜单审查（独立结论，不纳入本期实现）

### 1.1 为什么出现嵌套

截图中的第二条左栏不是尚未删除的旧版本，而是当前未提交 UI 重构新加入的结构：

- ERP 全局主侧栏仍由 `app/(admin)/layout.tsx` → `lib/navigation/admin-menu.ts` → `lib/navigation/admin-modules.ts` → `RULE_CENTER_SIDEBAR_ITEMS` → `components/business/admin/AppSidebar.tsx` 渲染。
- `/owner/rules/*` 的通用 layout 又无条件加入 `RuleCenterSectionNav`，以 `196px + 内容` 的网格渲染第二条左栏。
- 第二条左栏来自另一套 `RULE_CENTER_SECTION_ITEMS`。它与全局菜单交叉覆盖了客户计价、纸张、报价 SKU 和价格版本，却又遗漏产品结构、真实工艺参数、内部计价、师傅计件和工资提成。
- 参考 `规则配置中心.html` 是一个自带完整页面壳的独立原型；实现时把原型内的侧栏原样放进已有 ERP 壳，没有把它适配为全局主菜单条目。

实现者没有直接替换全局菜单还有一个技术原因：六个价格子页共用 `/owner/rules/customer-pricing?section=...`，而 `getActiveAdminMenuHref()` 和 `AppSidebar` 目前只看 pathname，无法按 query 唯一高亮，于是另建了读取 `useSearchParams()` 的页面内导航。

### 1.2 是否符合编码与产品规范

结论：组件层的可访问性和集中常量做法基本合格，但整体导航架构不合格，且存在实际错误。

- 两套重叠的主导航违反单一入口和单一元数据源原则；`RULE_CENTER_SIDEBAR_ITEMS` 与 `RULE_CENTER_SECTION_ITEMS` 会持续漂移。
- 页面内项目声明了 `requiredPermission`，但 `RuleCenterSectionNav` 未按该字段过滤。
- `isRuleCenterSectionActive()` 对非 customer-pricing 路由直接返回真，导致 `/owner/rules/stock-skus` 和 `/owner/rules/price-versions` 可高亮错误条目。
- 通用 `/owner/rules` layout 在纸张、产品、工资等页面也读取客户价格版本并展示发布动作，造成价格领域逻辑污染整个规则中心。
- 当前测试同时断言两套导航存在，实际把错误结构锁成了“预期行为”；它们不能证明信息架构正确。

### 1.3 正确修复方向

配置中心 UI 在本任务范围外，执行本计划时不改这些文件。后续应单独立项：

1. 让全局 `AppSidebar` 成为唯一主导航；用六个具体价格入口替换笼统的“客户计价”。
2. 给共享菜单元数据加入 query-aware active 规则，并让 sidebar、breadcrumb、移动抽屉和测试共用。
3. 删除 `RuleCenterSectionNav` 及 `RULE_CENTER_SECTION_ITEMS`；页面内部只保留搜索、筛选、版本状态和编辑/审阅/发布动作。
4. 将 `RuleCenterWorkspaceBar` 限定到客户价格/价格版本路由，不再由整个 `/owner/rules` layout 注入。
5. 增加“只有一个主导航”“只有一个 `aria-current`”“非价格页不取价格版本”“桌面无第二个 196px aside”的单元、E2E 与视觉断言。

## 2. 本期范围与完成定义

### 2.1 本期交付

- 外部销售端保留 B 版建单，继续支持新增、复制、删除、单款切换和稳定 `fig`。
- 所有纸张、克重、规格、烫金颜色和价表选项来自配置读取层；缺货纸张置灰且服务端二次拦截。
- 纯函数计费引擎统一返回款级明细、订单级明细、已知合计、人工核价原因和价格版本。
- 外部 Rail 完整展示款式加工费、入袋、制版费“待定”、纸箱、快递、已知合计；存在待核价款时明确标注“不含待核价款”。
- 三段提交：校验并跳转到款式 → 复核层 → 服务端原子锁价并写入 `PENDING_FACTORY`。
- 提交时写 `quotedFee` 和加工/物流双价表版本快照；`confirmedFee`、`settledFee` 独立保留。
- 保留现有真实设计图预览、CDR 可选、地址串解析、删除后的包装/物流同步、物流重量策略和抗异步竞态保护。
- 删除本轮曾新增但已无消费者的备选 UI 代码，以及 B 版不再调用的三路外部预览拼接；保留 B 版及内部/管理员能力。

### 2.2 明确不做

- 工单列表、明细抽屉、变更申请、工单 PDF、配置中心 UI、工厂端流程。
- 不实现制烫金版费金额；只保留结构和“待定”展示。
- 不实现 `confirmedFee`、`settledFee` 的业务写入流程，只建立独立字段和不可相互覆盖的契约。
- 不在本期彻底删除所有历史状态值；只让新建单相关路径使用 `DRAFT → PENDING_FACTORY`，并为历史消费者保留兼容窗口。

## 3. 目标架构与不可破坏的现有能力

### 3.1 分层

```text
配置读取（DB，IO）
  ├─ 纸张/克重/缺货、规格、颜色
  └─ PROCESSING + LOGISTICS 两条版本化价表快照
                 │
                 ▼
纯函数订单报价（无 IO）
  ├─ 款级：材料/基础加工 + 工艺 + 入袋
  ├─ 订单级：纸箱 + 快递 + 制版费待定
  └─ 结果：逐行金额、已知合计、manual reasons[]、priceVersion
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
预览 action             提交 transaction
不落财务事实             重读+锁版本+重算+快照+PENDING_FACTORY
```

### 3.2 计费函数契约

新建 `lib/order/create-order-pricing/types.ts`，固定以下公共契约；UI、preview action 和提交服务都只能依赖它：

- `CreateOrderPricingInput`：订单事实、`items[]`、包装/地址/物流事实、价表快照。
- `CreateOrderStyleInput`：`fig`、`craft`、`paperType`、`weight`、规格/毫米尺寸、数量、`frontColors[]`、`backColors[]`、膜/浮雕、`pack`。
- `ManualPricingReasonCode`：稳定枚举；至少包含缺价、彩印档空、专版三色、万元封专版、手输克重、改尺寸、自定义纸张、自定义规则组合等原因。
- `StyleQuoteResult`：`PRICED | MANUAL_PRICING_REQUIRED`、款级明细行、款级已知小计、原因数组。
- `OrderChargeResult`：纸箱、快递、制版费待定；只能整单计算一次。
- `CreateOrderPricingResult`：所有款结果、订单级结果、`knownTotal`、`hasManualPricing`、`totalSemantics: COMPLETE | EXCLUDES_MANUAL_ITEMS`、`priceVersion`。

实现上必须保留三个明确边界：

- `quoteStyleCharges()` 与 `quoteOrderCharges()` 分开；顶层函数只编排，禁止把两层合并。
- `selectPerPieceTier()` 与 `selectPrintPerOrderTotal()` 分开；禁止单价制和 `PER_ORDER` 共用取价函数。
- `Decimal`/定点金额贯穿引擎；禁止用 JS `number` 完成金额乘加后再四舍五入。

### 3.3 必须复用或保持的现有链路

- `CustomerPriceBookPurpose.PROCESSING` 与 `LOGISTICS` 两条版本流继续独立锁定，不能压成一个版本号或一张价表。
- 服务端必须继续忽略浏览器传来的最终金额并权威重算。
- `quoteFactsKey(item, orderItemCount)` 的“事实键 + 订单款数”语义必须保留，用于作废迟到的报价响应。
- 物流仍使用现有自动计重策略；多款总重量、向上取整、顺丰到付、纸箱仍计费等行为不得退化。
- 删除款式时必须同步删除/重算包装组与附加物流事实，立即失效旧报价。
- 真实设计图 blob/上传后预览必须保留；复制款式时保留 CDR、清空设计图，删除后不得残留预览。
- 外部 Rail 必须完整保留款式费、入袋、制版费待定、纸箱、快递和合计，不能退化为只显示加工费。

## 4. 差距分析

### 4.1 Prisma 与持久化字段

| 目标 | 当前状态 | 迁移/废弃动作 |
|---|---|---|
| `craft: PARTIAL \| FULL \| PRINT` | `OrderItem.pricingRoute` 使用 `STOCK_BLANK/CUSTOM_SINGLE_FLAT_FOIL/COLOR_PRINT/MANUAL_QUOTE` | 新增 `OrderCraft` 和 `OrderItem.craft`；前三项回填为 PARTIAL/FULL/PRINT。`MANUAL_QUOTE` 不映射成工艺，按快照/工艺事实尽力回填，无法判断则留空并列入迁移报告。新命令不再接收 `MANUAL_QUOTE`；`pricingRoute` 只作旧价表兼容，最后废弃。 |
| `paperType + weight` | `OrderItem.paperType + paperWeightGsm`；`Product.paperType` 常把纸名和克重混在字符串里 | 应用字段改为 `weight`；数据库先保留原列并用 Prisma `@map("paperWeightGsm")`，避免复制数据。`Product` 新增明确 `paperMaterialId` 与 `weight`，一次性解析可识别存量，无法解析的产品进入缺口报告，不猜默认值。 |
| `frontColors[]/backColors[]` | 已有 `frontFoilColors/backFoilColors`，但仍双写 `foilColors/isDoubleSided/isDoubleColor` | 将应用层字段统一为 `frontColors/backColors`，用 `@map` 保留现有物理列；色数、面数、过版次数全部推导。验证所有历史行的聚合字段可由两数组复现后，删除旧三字段。 |
| `packRaw` + 款式 `pack` | `Order.packageRequirement` 是模糊原话；每包数量藏在 `OrderPackagingGroupLine.unitsPerBag` | `packRaw` 通过 `@map("packageRequirement")` 接管原列；`OrderItem` 新增 nullable `pack`。单一明确包装行回填 `pack`；同一款多组且数值冲突则留空并输出审计清单。包装组继续作为订单级组合快照，由 `pack` 派生，不让两处都成为用户可编辑真值。 |
| 稳定递增 `fig` | `OrderItem.sequence` 同时当排序号，UI 删除后按数组下标重排 | 新增 `OrderItem.fig` 和 `Order.nextItemFig`；回填 `fig=sequence`、`nextItemFig=max(fig)+1`，建立 `@@unique([orderId, fig])`。未落库表单也保存同一 next counter；删除不修改其他 fig。`sequence` 在兼容期只表示旧展示顺序，最终由 `fig` 替代。 |
| 缺货运营态 | `Material` 有库存与 `isActive`，无显式 `outOfStock`；Product 未关联纸张主数据 | `Material` 增加 `outOfStock @default(false)`；`Product.paperMaterialId` 关联 PAPER 物料。选项 DTO 从物料读取缺货态；提交事务再次读取，防止页面打开后状态变化。 |
| 价表版本锁 | `CustomerPriceBook` 已有 version，现有 `OrderPricingRevision.snapshot` 可保存事实，但 Order 无明确锁 | 新增 `OrderPriceVersionLock`，按 `pricingRevisionId + purpose` 唯一保存 PROCESSING/LOGISTICS 的 priceBook id、version、source hash；Order 保存指向提交报价 revision 的引用。应用层统一暴露 `{ processing, logistics }` 形式的 `priceVersion`，不合并双流。版本锁与 revision 一样禁止 update/delete，只能追加新 revision。 |
| 三段费用 | 只有 `processingAmount/packagingAmount/totalAmount` 和 pricing status | Order 新增 nullable `quotedFee/confirmedFee/settledFee` 与 `quotedFeeCompleteness`。本期只在正式提交写 `quotedFee`；其余保持 null。旧聚合金额暂作兼容投影，待列表/账单迁移后再删。 |
| 人工核价持久化 | `OrderItem.unitPrice/fixedFee/subtotal` 非空且默认 0，容易把未知价显示成 ¥0 | 新增 `quoteDisposition`、nullable `quotedAmount`，原因 code 数组写入不可变 pricing snapshot；人工款 `quotedAmount=null`。旧金额列仅对已自动报价款做兼容投影。 |
| 制版费“待定” | `OrderCustomerCharge.amount` 非空，状态只有 ESTIMATED/FINAL/WAIVED | 增加 `PENDING_AMOUNT`（或等价判别状态）并允许 amount nullable；制版明细以 pending 行入 snapshot/charge，不用 0 元占位。 |
| 提交状态 | 旧 8 态，提交为 `SUBMITTED` | 扩展到状态机真值并保留旧值兼容；本期新外部单只走 `DRAFT → PENDING_FACTORY`。消费者在过渡期同时识别 `SUBMITTED/PENDING_FACTORY`，完成回填后再移除旧值，避免波及范围外工厂端。 |

### 4.2 配置与选项读取

| 目标 | 当前状态 | 动作 |
|---|---|---|
| 纸张与缺货 | `listActivePaperOrderOptions()` 存在但建单页未调用；无 outOfStock | 建立外部建单专用 `listExternalCreateOrderOptions()`，一次返回规范化纸张、克重、规格、颜色及当前版本摘要。 |
| 规格（含西封中号/大号） | 当前主要从 BASE 报价 SKU/Product specification 推导 | 继续由有效 Product/SKU 配置提供，但 DTO 输出稳定 `specCode/label/widthMm/heightMm/productStructure`；禁止组件解析显示字符串。迁移数据补齐两种西封规格。 |
| 烫金颜色 | `ExternalSalesOrderFormB.tsx` 内硬编码颜色 | 从激活的 FOIL 物料读取；Material 补 displayColor/sortOrder（或等价展示元数据），DTO 提供稳定 code、label、色板 token、sortOrder。组件只渲染 DTO。覆膜等可选工艺同样从 Craft/工艺配置读取。 |
| 可选项与可自动报价解耦 | 当前 `listCurrentExternalSalesProductOrderOptions()` 只返回被当前 BASE 规则引用的 Product，缺价组合会从 UI 消失 | catalog 返回所有有效业务选项；是否能自动计价由引擎决定。合法但缺价的组合必须可录入并返回 `MANUAL_PRICING_REQUIRED`，不能靠隐藏选项逃避缺口。 |
| 纸张/规格/价表缺口 | 现有数据有历史字符串和不完整组合 | 读取层 fail closed：缺项产生配置缺口或人工核价原因，不回退当前纸、最近克重或最近档。 |
| 价表快照 | processing、packaging、logistics 由多个 service/action 分别读取 | 引入一个快照加载器，在同一 read lock/事务边界内读取 PROCESSING 和 LOGISTICS；预览与提交向同一个纯函数传入同形快照。 |

### 4.3 计费引擎

| 目标 | 当前状态 | 动作 |
|---|---|---|
| 单一纯函数订单报价 | 已有纯函数，但款式、包装、物流由 `calculateExternalSalesQuote`、`calculateOrderPackagingGroupsQuote`、`calculateExternalOrderCharges` 分散拼接 | 保留已验证算法，提取成 `quoteStyleCharges/quoteOrderCharges/quoteCreateOrder` 三层；旧函数先做薄适配，再在切流后删除。 |
| 人工核价款不计入已知合计 | 当前某款不完整时可能使整单 total 为空/null | 逐款返回状态；人工款金额为 null，已知款继续相加，Rail 明示“不含待核价款”。 |
| 专版 5 万档 |规则文档仍把该处列为未确定 | 按本任务锁定值加入 `>=40001`：对应 0.16/0.18；不采用文档旧疑问。 |
| 制版费 | 无确定金额 | 订单级明细固定返回 `PENDING`，显示“待定”，金额 null，不阻塞提交、不偷偷按 0 展示。 |
| 空 pack | 旧包装结构容易把缺失值归零 | `pack=null` 时包数、入袋金额显示 `—`；提交校验定位该款。引擎不得将其当 0 袋或 0 元。 |

### 4.4 UI 与交互

| 目标 | 当前状态 | 动作 |
|---|---|---|
| B 版保留与接线 | `OrderFormB` 是当前获批展示层，但控制器仍集中在 `OrderForm.tsx`，且曾并行拼接三路报价 | 保持 B 版布局与控件不变；将外部预览收敛为一个全订单 action，并在后续可维护性重构中只拆业务控制器，不改版式。 |
| 稳定 fig | 当前 UI 以数组 index/sequence 展示并在删除后重排 | reducer 维护 `nextFig`，本地草稿保存它；复制/新增只递增，删除不回收。 |
| 校验跳转 | 已有 form errors，但不是完整的款式错误导航 | 生成按 fig 分组的错误摘要；点击展开对应卡片、滚动并聚焦第一个无效控件。 |
| 复核层 | B 版已有中文数量、毫米尺寸、否定项、图片预览等部分能力 | 继续复用 B 版；补“未改过默认值”追踪和待核价熄灭；不增加“我已确认”复选框。 |
| 离开保护 | 未发现完整 `beforeunload` 链路 | 只在相对初始快照发生有效修改且未成功提交时启用 browser beforeunload + 应用内导航确认；保存成功/提交成功解除。 |
| 地址解析 | 已存在 | 抽成纯函数并补号码、空格、换行及非标准文本 fixture；允许用户逐字段修正。 |
| 外部完整费用 | B Rail 已覆盖款式、入袋、版费待定、纸箱、快递、总额 | 保持 B Rail 并直接消费统一报价；用回归测试锁住两款合计 ¥566.30、上海 12kg 快递 ¥41.30，以及复制/删除后同步恢复包装、物流和总额。 |

### 4.5 API 与提交

当前关键缺陷：外部路径在创建 `DRAFT` 时已锁价并写 `OrderPricingRevision`，随后才上传文件并调用 `submitOrder`；`submitOrder` 只把 DRAFT 改成 SUBMITTED，不重新读取价表和重算。因此复核到确认之间若版本发布或缺货态改变，正式工单可能锁到旧事实。

目标流程：

1. `保存草稿`：只保存业务事实和已上传文件引用，不形成 `quotedFee`，允许继续编辑。
2. `预览报价`：读取当前双价表快照并调用纯函数；返回 `quoteToken`（facts hash + 两个版本 + 结果 hash），不落财务事实。
3. `打开复核层`：展示预览结果、中文数量、毫米、默认值提示、显式否定项、图片/CDR状态。
4. `确认提交`：一个数据库事务内锁定当前 PROCESSING/LOGISTICS 版本，重读纸张缺货态，重新校验并运行相同纯函数。
5. 若重算结果与 `quoteToken` 不同，返回 `QUOTE_CHANGED` 和新复核结果，不落 `PENDING_FACTORY`，由 UI 重新展示差异。
6. 一致时追加不可变 `OrderPricingRevision`，写 `quotedFee`、版本锁、`submittedAt`、`PENDING_FACTORY` 和日志/outbox；提交 action 使用 idempotency key，重复请求返回同一结果。

外部销售必须使用专用 command schema，只接收业务事实和 `clientSubmissionId`，明确拒绝客户端传入 unitPrice、fixedFee、subtotal、quotedFee、priceVersion 或任何确认金额。错误响应统一为 `issues: { path, fig, code, message }[]`；不能只返回依赖数组下标的 fieldErrors，否则删除/复制后无法可靠定位卡片。通用 admin/internal command 暂留兼容，不能与外部事实 schema 混成一个宽松输入。

## 5. Prisma 迁移与存量回填方案

### 5.1 迁移顺序

#### M1：只扩展、可回滚

文件：

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_create_order_c_expand/migration.sql`

动作：

- 新增 `OrderCraft` 与 canonical 状态值，但暂不删除旧 enum 值。
- 新增 nullable `OrderItem.craft/fig/pack/quotedAmount`、`quoteDisposition`，以及 `Order.nextItemFig`。
- 新增 `Product.paperMaterialId/weight`、`Material.outOfStock/displayColor/sortOrder`。
- 新增 `Order.quotedFee/confirmedFee/settledFee/quotedFeeCompleteness/quotedPricingRevisionId/clientSubmissionId`；`clientSubmissionId` 建唯一索引。
- 新增 `OrderPriceVersionLock`，每个 pricing revision 对 PROCESSING/LOGISTICS 各一行；新增 immutable trigger/权限约束。
- 扩展订单收费行以表达 amount=null 的 `PENDING_AMOUNT` 制版费。
- 通过 Prisma `@map` 将应用层 `packRaw/weight/frontColors/backColors` 对应到旧物理列，减少搬运与停机窗口。
- 只建允许 null 的索引，不立即加 `NOT NULL` 或删除列。

回滚点 R1：回滚应用后可直接 drop 新增列/索引；旧字段和旧状态仍完整。

#### M2：确定性回填与审计

文件：

- `prisma/migrations/<timestamp>_create_order_c_backfill/migration.sql`
- `scripts/audit-external-create-order-migration.ts`
- `lib/order/__tests__/external-create-order-migration-contract.test.ts`

回填规则：

- `fig = sequence`，`nextItemFig=max(fig)+1`；重复或空值直接终止迁移，不自动改号。
- `STOCK_BLANK → PARTIAL`、`CUSTOM_SINGLE_FLAT_FOIL → FULL`、`COLOR_PRINT → PRINT`；`MANUAL_QUOTE` 只在快照能唯一还原时回填，否则保持 null 并输出 order/item id。
- `pack` 仅从唯一且一致的 `unitsPerBag` 回填；冲突包装组不猜值。
- Product 的纸名、克重只解析已知可逆格式；不能唯一解析的写入审计报告并阻止该 SKU 作为自动价选项，不覆盖原字符串。
- 历史 `SUBMITTED` 在所有读取方已支持双读后才回填为 `PENDING_FACTORY`；其他旧生产状态本期不重写。
- `quotedFee` 优先取最新不可变 pricing revision 的已知总额，其次取能证明为正式报价的 `totalAmount`；无法证明则 null。
- `confirmedFee` 只对已有明确工厂/管理员确认审计证据的行回填；不能仅凭“已进入生产”猜测。
- `settledFee` 只对已有结算账单事实的行回填；不能把 `FINISHED` 自动等同于已结算。
- 版本锁从历史 snapshot 读取；缺少版本证据的记录标记 `LEGACY_UNVERSIONED`，禁止绑定“当前版本”伪造历史。

回滚点 R2：所有回填只写新列；回滚应用不读取它们。审计脚本先以 dry-run 输出计数和样本，数量不符即停。

#### M3：双写切流与约束

文件：

- `prisma/migrations/<timestamp>_create_order_c_constraints/migration.sql`
- `lib/order/create-order-migration-compat.ts`

动作：

- 新建单写 canonical 字段，并在兼容期投影旧字段给范围外读取方；fig 由 reducer/订单 counter 单调分配，数据库唯一约束处理并发冲突。
- 在回填通过后建立 `@@unique([orderId, fig])`、正数检查（`fig > 0`、`pack > 0`、`weight > 0`）。
- 外部销售新单要求 craft/fig；历史不完整行不强行补假数据。
- 所有读取方切到 canonical adapter 后停止写 `foilColors/isDoubleSided/isDoubleColor`、旧报价 route 及模糊 package 字段。

回滚点 R3：先切回兼容读写，再撤约束；不得在同一发布中 drop 旧列。

#### M4：延后清理

完成至少一个稳定发布周期、审计差异为 0 后再执行：

- 删除 `foilColors/isDoubleSided/isDoubleColor`。
- 删除外部新建单对 `pricingRoute` 的写依赖；是否物理 drop 等配置中心价表也迁到 craft 后再决定。
- 删除被 `fig` 完全替代的 `sequence` 写依赖。
- 删除旧金额投影前必须先迁移列表、账单、PDF；因这些在本期范围外，物理 drop 不在本期完成定义内。

### 5.2 迁移验收查询

- 每个订单 `count(fig) = count(distinct fig)`，且所有新外部单 fig > 0。
- `frontColors/backColors` 能重建的聚合颜色、面数、次数与旧字段一致；差异必须逐单列出。
- 新建外部单 100% 有 processing 与 logistics 版本锁（顺丰到付也保留 logistics 版本证据）。
- `quotedFee` 等于 pricing revision 的 `knownTotal`；存在人工核价时 snapshot 标记 excludes-manual。
- 没有任何 `LEGACY_UNVERSIONED` 行被伪装成当前价表版本。

## 6. 可独立合并的 PR 序列

### PR-0：基线、契约与防回归护栏

依赖：无。可与 PR-1 的迁移 SQL设计并行，但必须先合并测试契约。

目标：冻结现有可靠行为和目标输入/输出，不改变生产逻辑。

改动面：

- 新增 `docs/contracts/external-create-order.md`：字段、状态、manual reason、双版本和费用语义。
- 新增 `lib/price/__tests__/fixtures/create-order-golden.ts`。
- 新增 `lib/order/__tests__/external-create-order-contract.test.ts`。
- 新增/补强只读回归测试：`components/business/order/__tests__/OrderForm.external-fee-regression.test.tsx`、`components/business/order/__tests__/OrderForm-quote-race.test.tsx`。

先行测试：

- 运行当前全量 unit/integration、typecheck、Prisma validate、ESLint、build，并把失败基线记录到 PR 描述。
- 先写失败的外部建单契约测试，不修改既有测试期望来“适配”新行为。

验收标准：

- 黄金 fixture 能被旧测试工具读取但尚未要求旧引擎全部通过。
- ¥566.30、上海 12kg ¥41.30、外部完整 Rail、删除后包装/物流/合计恢复、真实预览、`quoteFactsKey(orderItemCount)` 均有明确回归断言。
- 若基线已有失败，PR 清楚区分“进入前失败”和“本 PR 新失败”。

### PR-1：Schema 扩展、兼容适配与回填工具

依赖：PR-0。与 PR-2 纯引擎主体可在冻结类型后并行。

目标：建立展示层无关的外部建单 canonical 数据模型，不破坏存量和范围外消费者；已生成 migration 中的 `create_order_c` 仅是历史文件名，不代表 UI 版本。

改动面：

- `prisma/schema.prisma`
- 三个 expand/backfill/constraints migration 文件（M1-M3）
- `scripts/audit-external-create-order-migration.ts`
- `lib/order/create-order-migration-compat.ts`
- `lib/order/pricing-route.ts`（只加兼容映射）
- 新增 `lib/auth/external-create-order-schema.ts`（严格 canonical command）；`lib/auth/schemas.ts` 保留旧 admin/internal 兼容并停止扩宽外部输入
- `generated/prisma/*`（由项目既有生成命令更新）
- 所有因 Prisma 字段别名而需要的机械读取适配；不得趁机重构列表/详情/PDF功能。

先行测试：

- migration contract：空库、代表性旧库、冲突包装、MANUAL_QUOTE 无法还原、无版本历史。
- schema tests：禁止输入 colorCount/sideCount；禁止新命令输入 MANUAL_QUOTE；验证 full/print 的正反面组合约束。
- security tests：客户端注入价格、费用、状态或 priceVersion 必须被拒绝；issues 必须携带稳定 fig。

验收标准：

- Prisma validate、generate、typecheck 全过。
- M1/M2 可对生产快照 dry-run，所有模糊数据只报告、不猜值。
- 旧代码仍能读取旧工单；新 canonical DTO 不暴露 colorCount/sideCount。
- rollback R1/R2 经本地备份恢复演练通过。

### PR-2：统一纯函数计费引擎与黄金 fixture

依赖：PR-0 的契约；可与 PR-1、PR-3 的读取实现并行，最终 rebase 到 canonical 类型。

目标：把规则文档变成一个无 IO、可复现、两层严格分离的订单报价引擎。

改动面：

- 新增 `lib/order/create-order-pricing/types.ts`
- 新增 `lib/order/create-order-pricing/manual-reasons.ts`
- 新增 `lib/order/create-order-pricing/per-piece-tier.ts`
- 新增 `lib/order/create-order-pricing/print-per-order-tier.ts`
- 新增 `lib/order/create-order-pricing/style-charges.ts`
- 新增 `lib/order/create-order-pricing/order-charges.ts`
- 新增 `lib/order/create-order-pricing/quote-create-order.ts`
- 复用/迁移 `lib/price/external-sales-quote.ts`、`order-packaging-quote.ts`、`external-order-charges.ts` 的已验证算法；旧导出先变成 adapter。
- 新增 `lib/order/create-order-pricing/__tests__/golden.test.ts`、`invariants.test.ts`。

先行测试：第 7 节所有 fixture 先红后绿；另加 property/invariant 测试。

验收标准：

- 引擎模块无 `db`、server action、Date.now、fetch 或环境变量依赖；同输入必得同输出。
- 款级与订单级函数在类型和测试上分离；纸箱/快递在多款订单只出现一次。
- PER_ORDER 彩印测试能证明没有乘数量；单价档和总价档没有共享 selector。
- 所有缺价均 fail closed，manual 款无金额且不进入 knownTotal。
- 5 万档按本任务锁定值通过边界测试。

### PR-3：配置选项与价表快照读取层

依赖：PR-1 schema；可与 PR-2、PR-4 组件骨架并行。

目标：让 B 版不再硬编码业务选项，并为预览/提交提供相同快照形状。

改动面：

- 新增 `lib/order/create-order-options.ts`
- 新增 `lib/order/create-order-price-snapshot.ts`
- 更新 `lib/product.ts`、纸张 Material 查询和 price-book 查询
- 更新 `app/(admin)/orders/new/page.tsx`：传 `settlementType` 和 `CreateOrderOptions`，不再传布尔 UI 版本开关。
- 新增 `lib/order/__tests__/create-order-options.test.ts`、`create-order-price-snapshot.test.ts`。

先行测试：

- 空配置、停用项、缺货、重复 code、无法解析纸重、版本切换、PROCESSING/LOGISTICS 不同版本。
- 明确断言选项输出含西封中号/大号，且 UI 所需颜色均来自 FOIL 配置。

验收标准：

- 组件代码中不再出现纸张/规格/颜色业务常量或价格数字。
- 缺货纸张在 DTO 中有 `outOfStock=true`，但历史已选值仍能只读展示。
- 快照同时且独立包含 processing/logistics id+version；任一缺失均拒绝自动报价，不回退旧/current nearby。

### PR-4：B 版保留、复核层与离开保护补强

依赖：PR-0 契约；使用稳定 DTO mock 可与 PR-2/3 后半段并行，合并前接真实类型。

目标：不改变 B 版信息架构和视觉，补齐稳定 fig、错误定位、复核事实和离开保护，并接收配置 DTO。

改动面：

- 更新 `components/business/order/OrderForm.tsx` 与 `order-form-b/ExternalSalesOrderFormB.tsx`，保持 B 版布局。
- 更新 `ExternalSalesOrderFormRail.tsx`，支持已知合计与“不含待核价款”。
- 保留 `OrderSubmissionReviewDialog`、真实设计图与 B 版色板控件；补齐配置 DTO 输入。
- 使用 `order-form-local-draft.ts`、`use-order-form-leave-guard.ts` 和稳定 `fig`，不新增 C 版 reducer/presentation。
- 删除本轮无消费者的 `order-form-c/*` 与对应测试。

先行测试：

- reducer：新增/复制/删除后 fig 单调且不复用；本地草稿恢复 nextFig。
- B 版款式条件矩阵：PARTIAL/FULL/PRINT、彩印叠局部/专版、反面限制、pack 空态。
- 错误摘要点击后切换到对应稳定 fig、scroll、focus。
- 复核层中文数量、毫米尺寸、默认未改提示、否定项、CDR 未上传提示、真实图片。
- beforeunload 只在 dirty 时启用，提交/保存后解除。

验收标准：

- 外部销售始终呈现当前 B 版；不存在 B/C 版本选择器或 `usesExternalSalesPricing` 展示开关。
- 无“我已确认”复选框。
- 人工款金额熄灭/划掉，显示“待工厂核价”；合计标“不含待核价款”。
- Rail 仍完整显示入袋、制版待定、纸箱、快递与合计。
- 393px 至桌面无横向溢出，键盘可完成主要操作，错误焦点可见。

### PR-5：统一预览 action 与异步竞态保护

依赖：PR-2、PR-3、PR-4。

目标：让页面预览只调用一个订单报价接口，保留并加强 stale response 防护。

改动面：

- 新增 `actions/create-order-quote.ts`
- 新增 `lib/order/create-order-quote-service.ts`
- 更新 `OrderForm.tsx`，B 版外部路径只调用统一预览 action。
- 旧 `actions/order-quote.ts` 只保留给内部报价消费者；B 版外部路径不再调用独立包装/物流预览 action。
- 新增 `actions/__tests__/create-order-quote.test.ts`、UI delayed-response tests。

先行测试：

- 人为延迟旧请求：改数量、增删/复制款式、改地址后，旧响应不得覆盖新状态。
- facts key 必须包含 `orderItemCount`、包装与物流重量事实以及价格版本。
- manual + priced 混合订单返回 partial known total。

验收标准：

- 一次预览响应含全部款级和订单级费用及双版本。
- 网络竞态测试稳定通过，不靠 sleep 或脆弱时间假设。
- 外部 UI 不信任/提交客户端金额，只保留展示结果与 quoteToken。

### PR-6：提交事务、费用快照与 PENDING_FACTORY

依赖：PR-1、PR-2、PR-3、PR-5。

目标：在最终确认时原子重算和落库，消除草稿创建与提交之间的价格漂移。

改动面：

- 更新 `actions/order.ts`
- 重构 `lib/order.ts` 的外部创建/提交分支，或抽出 `lib/order/submit-external-order.ts`
- 更新 `lib/order/status-machine.ts`
- 更新相关事件/outbox payload，使业务事件仍可叫 `ORDER_SUBMITTED`，但状态值为 `PENDING_FACTORY`。
- 更新 create/submit schema 与权限检查。
- 新增 transaction、idempotency、price-version-race、out-of-stock-race tests。

先行测试：

- 价表在复核后发布新版本：第一次确认返回 QUOTE_CHANGED 且不提交；再次确认锁新版本。
- 提交并发双击只产生一条正式 revision、一次状态迁移和一组事件。
- 文件上传未完成/引用不存在时不进入 PENDING_FACTORY。
- 服务端篡改客户端金额不影响最终 quotedFee。

验收标准：

- 正式订单状态为 PENDING_FACTORY，`submittedAt`、quotedFee、pricing revision、processing/logistics 版本在同一事务提交。
- `confirmedFee/settledFee` 未被写入或由 quotedFee 覆盖。
- manual 订单 snapshot 保留原因和 excluded-manual 语义。
- 任一步失败均保持 DRAFT，可安全重试；无半提交财务事实。

### PR-7：B 版固化、备选 UI 残留清理与端到端验收

依赖：PR-4、PR-5、PR-6。

目标：外部销售固定进入 B 版，删除无消费者的备选 presentation 和重复三路预览 adapter，同时保证管理员/内部建单不退化。

改动面：

- `app/(admin)/orders/new/page.tsx`
- `components/business/order/OrderForm.tsx`
- 保留 `components/business/order/order-form-b/ExternalSalesOrderFormB.tsx` 与 B Rail。
- 删除 `components/business/order/order-form-c/*` 及无消费者导出。
- 删除 B 外部路径不再使用的旧包装/物流预览拼接与请求 gate；保留历史订单读取兼容和业务断言。
- 新增/更新 `tests/e2e/order-create-b.spec.ts` 与视觉截图用例。

先行测试：

- dependency scan：`rg` 确认待删除导出无消费者。
- 外部 SALES、CUSTOMER_SERVICE、ADMIN/内部结算分别跑新建页，验证按 settlementType 进入正确 UI 与费用 Rail。
- 全量现有测试先跑；任何失败先判断是否破坏既有行为，禁止直接改期望让其变绿。

验收标准：

- 外部销售页面中只存在 B 版表单，不存在备选版本残留、双版本入口或死代码。
- 管理员/内部路径仍正常，且外部计费不会被误用于内部结算。
- 全量 unit/integration、typecheck、Prisma validate、ESLint 0 warning、build、Playwright 通过。
- 浏览器按桌面和移动尺寸人工验收并截图；视觉基线只有在确认截图正确后更新。

## 7. 测试策略

### 7.1 黄金 fixture 映射

统一 fixture 文件只保存业务输入、价表快照和预期明细；不同测试不得各自抄一套数字。

| Fixture ID | 文档第 8 节用例 | 核心断言 |
|---|---|---|
| `LF-999-F1` | 局部，999，正面 1 色 | 空白封 129.87、机烫 40、入袋 10；次数=1。 |
| `LF-1000-F1` | 局部，1000，正面 1 色 | 空白封 130、机烫 40、入袋 10。 |
| `LF-1000-F2` | 局部，1000，正面 2 色 | 机烫 80；按两次，不按一个正面。 |
| `LF-1000-F1B1` | 局部，1000，正反各 1 色 | 机烫 80；同色跨两面也算两次。 |
| `LF-1000-F3` | 局部，1000，正面 3 色 | 机烫 120。 |
| `FF-5000-PEARL` | 专版，大号、珠光 160g、单色 | 单价 0.22。 |
| `FF-5000-SOFT` | 专版，触感膜 | 单价 0.32。 |
| `FF-5000-PEARL-RELIEF` | 专版，珠光 + 浮雕 | 单价 0.27 + 固定 90，分两行。 |
| `FF-THREE-COLORS` | 专版三色 | MANUAL_PRICING_REQUIRED，无金额、不进合计。 |
| `FF-BOUNDARIES` | 1、750、751、4500、4501、7500、7501、25000、25001 | 分别命中精确实际数量档，禁止四舍五入到近档。 |
| `FF-50000-BOUNDARY` | 本任务补充边界 40000/40001 | 40000 仍为上一档；40001 命中 0.16/0.18。 |
| `CP-1000-COATED-LARGE` | 彩印，铜版 200g，大号，1000 | 整单 310，不能乘数量。 |
| `CP-6000-COATED-LARGE` | 彩印，6000 | 按 5000 档，整单 870。 |
| `CP-MISSING-TIER` | 彩印，冰白 160g，中号，2000 | MANUAL_PRICING_REQUIRED，无最近档兜底。 |
| `CT-BOXES` | 500/1000/2000/3000/5000/5001/6000/8000/10000/12000/20000 | 箱数依次为 1/3/5/7/8/9/11/15/16/21/32，且订单级只算一次。 |
| `SH-2000-160` | 2000 个、160g=12kg | 广东 19.30、上海 41.30、云南 52.30、甘肃 126.60、新疆 128.60。 |
| `SH-2000-180-SH` | 2000 个、180g=13.5kg | 计费重向上取 14kg，上海 48.30。 |
| `SH-2001` | 2001 个 | 物流转人工/待核，不得沿用 2000 个结果。 |
| `SH-SF-COLLECT` | 顺丰到付 | 快递金额 0，但纸箱仍计算并展示。 |
| `PK-NO-PACK` | 本任务锁定的 pack 空值 | 包数和入袋金额为 null/`—`，不能等于 0；提交错误定位到该款。 |
| `ORDER-MIXED-MANUAL` | 一款自动 + 一款 manual | knownTotal 只含自动款与可确定订单费，totalSemantics=EXCLUDES_MANUAL_ITEMS。 |
| `ORDER-SIX-STYLES` | 6 款 × 1000 | 纸箱为整单 6000 的 11 箱，不是逐款 3 箱再相加。 |

除黄金 fixture 外必须补这些不变量：

- 前后颜色数组长度之和就是印刷次数；不得读取持久化 colorCount/sideCount。
- FULL 只能正面；PRINT+FULL 只能单面；PRINT+PARTIAL 可有反面。
- 自定义纸张、手输克重、改毫米尺寸、万元封专版、空白封组合缺价全部 fail closed。
- 复制/删除任意序列后 fig 唯一且严格递增；可用 property-based 生成操作序列。
- 对同一 snapshot 和 input 重复执行结果 byte-for-byte 等价（时间字段在引擎外注入）。

### 7.2 Playwright 关键路径

新建或更新 `tests/e2e/order-create-b.spec.ts`，至少覆盖：

1. 三款校验失败 → 顶部错误摘要 → 点击第二款错误 → 自动展开、滚动、聚焦。
2. 复核层展示中文数量、毫米规格、未改默认提示、明确“不烫反面/无浮雕/未上传 CDR”，且无确认勾选框。
3. 一款人工核价、一款自动价：人工金额熄灭/划掉，订单合计显示“不含待核价款”。
4. 修改后离开触发保护；未修改、保存成功或提交成功不触发。
5. 复制后删除款式：fig 不回收，包装/计重/快递/总额同步重算，迟到响应不回写。
6. 真实设计图即时预览；复制后图片清空、CDR 保留；删除后 blob 预览释放。
7. 缺货纸张置灰；页面打开后变缺货时，提交由服务端拦截并回到对应款。
8. 两款回归合计 ¥566.30，上海 12kg 快递 ¥41.30；Rail 同时出现加工、入袋、版费待定、纸箱、快递、合计。
9. 价表发布发生在复核与确认之间：出现报价变化复核，不生成半提交订单；再次确认后快照版本正确。
10. 最终状态 PENDING_FACTORY，刷新后报价与版本快照可复现。

### 7.3 既有测试处理原则

- 每个 PR 开始和结束都跑同一组基线命令并保存结果。
- 不因新实现而批量更新旧 snapshot/期望。旧测试失败先回答：是产品真值改变、兼容 adapter 漏失，还是测试本身把已废弃 B 布局当业务行为。
- 不因底层统一报价而改写 B 版视觉断言；价格、权限、状态、文件、物流、金额、审计等业务断言必须保留或增强。
- 若当前脏工作树进入前就有失败，必须在 PR 描述列出，不得把它归因于本任务，也不得顺手修改无关文件。

## 8. 风险清单与探测方法

| 风险 | 探测方法 | 防护/处置 |
|---|---|---|
| 共享脏工作树覆盖其他任务 | 每个 PR 前 `git status --short`、目标文件 diff、责任文件清单；对重叠文件先 rebase/diff | 独立分支/工作树；只提交本 PR 文件；不 reset、不覆盖未知改动。 |
| 状态枚举改动波及工厂端 | `rg` 所有 OrderStatus 比较、switch、查询过滤和事件；运行状态机/排产/通知全套测试 | 先加值和双读，后回填；本期不删旧值。 |
| 新旧字段双真值漂移 | 迁移审计比较 colors、fig、pack、金额；DB consistency 查询 | canonical 单写 + 旧投影；达到零差异才删旧字段。 |
| 复核与提交间价表漂移 | 并发测试在两步间发布新版本 | 提交事务重新锁双版本和重算；不一致返回 QUOTE_CHANGED。 |
| PROCESSING/LOGISTICS 被误合并 | snapshot schema/test 明确两组 id+version；顺丰到付也检查 logistics 证据 | `priceVersion` 是双成员值对象，不使用单一裸整数。 |
| 异步旧报价覆盖新事实 | fake deferred promise 测试数量、款数、地址、pack 连续变化 | request sequence + facts hash + orderItemCount；响应落地前再次比较。 |
| manual partial total 被当完整总额 | 组件/快照/提交测试检查 totalSemantics | 不能只存一个数字；必须随金额存 COMPLETE/EXCLUDES_MANUAL_ITEMS。 |
| fig 删除后复用 | reducer property test + E2E add/delete/copy | 保存 `nextFig=max+1`，从不使用数组 length。 |
| 缺货态过期 | 页面打开后改 DB 状态的提交测试 | UI 置灰只是提示；提交事务权威重读。 |
| 文件上传与提交半成功 | 缺失 file id、上传失败、重复提交测试 | 草稿先保存；只有所有引用有效后进入原子 finalize；idempotency key。 |
| 金额浮点误差/边界错档 | 所有边界黄金 fixture + Decimal 精确比较 | 全程 Decimal；selector 明确闭开区间。 |
| 配置缺口被默认值掩盖 | 空配置、重复配置、自定义项、未知组合测试 | fail closed + reason；禁止 nearest/current fallback。 |
| 5 万档与文档旧“待定”冲突 | 40000/40001 fixture | 本任务锁定值优先，并在 snapshot 记录规则版本。 |
| 清理 C 残留误删 B 共享能力 | 删除前 `rg` 依赖图，确认 B/shared 消费关系并跑内部/admin 回归 | 只删除无消费者的 C 文件与旧三路外部预览代码，B 组件保留。 |
| localStorage 旧草稿无法读取 | 草稿 schema version fixture | 增加版本迁移；无法安全迁移时提示丢弃，不静默错填。 |
| B 版接入新报价后键盘/移动端退化 | 393/768/1440 视口、axe、Tab 流和 focus visible 测试 | 保持原 B 控件语义、错误关联和 sticky rail 响应式行为。 |

## 9. 待拍板问题

无。

以下看似存在歧义的事项已能由锁定决策、输入文件和现有代码自行确定，不再打断执行：

- 5 万档采用本任务明确的 `>=40001`、0.16/0.18。
- 制烫金版费保持“待定”，不按 0 元伪装已报价。
- 设计图沿用现有外部建单必填校验；CDR 仅复核提示、非必填。
- `priceVersion` 保留现有加工/物流双流，以结构化值对象表达，不合并成一个整数。
- 多地址/附加物流等 B 版现有高级能力不删除；主收件地址与附加项继续使用现有渐进展开。
- 管理员/内部结算继续使用自身计价 Rail；外部 B 版展示不等于所有角色共用外部计价策略。

## 10. 执行门禁与最终验收

确认本计划后，按 PR-0 → PR-7 自主执行；只有发现无法按上述默认值安全处理的数据破坏风险，或必须执行不可逆生产数据操作时才中断。

每个 PR 的共同门禁：

1. 先行测试先写并证明能捕获旧缺陷。
2. 相关测试、全量测试、typecheck、Prisma validate、ESLint、build 按风险逐级运行。
3. 不修改无关工作树，不通过删除业务断言让测试变绿。
4. 数据迁移有 dry-run 计数、冲突清单和回滚演练。
5. 最终浏览器验收同时覆盖外部销售 B 版、管理员/内部路径和移动端。

本期“完成”必须同时满足：

- 外部销售 `/orders/new` 只呈现当前 B 版表单。
- schema、命令、纯函数、复核和快照对 craft/paperType+weight/frontColors/backColors/packRaw+pack/fig 的语义一致。
- 所有黄金用例通过，manual 款 fail closed，订单级费用不重复。
- 正式提交原子写入 PENDING_FACTORY、quotedFee 和双 priceVersion；无复核后价格漂移。
- 外部完整费用、真实设计图、删除同步、quoteFactsKey 与物流重量策略均有回归证明。
- 备选 UI 残留、硬编码外部颜色/选项、重复外部 quote 拼接和无消费者导出已移除；B 版、历史读取与内部/管理员能力不受损。
