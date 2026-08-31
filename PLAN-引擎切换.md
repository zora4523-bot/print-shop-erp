# PLAN-引擎切换（已确认执行）

> 状态：**用户已于 2026-08-28 一次确认，第二阶段已执行；验收证据见 `REPORT-引擎切换.md`**
>
> 审查/修订基线：2026-08-28，`Review@2c74f2c3f65b823b1f77a14a94e13284887033ff`
>
> 审查对象：当前工作树（含未提交改动），不是只看 `HEAD`
>
> 唯一真值版本：`docs/加工费计费规则.md`，由 `/Users/zhixing/Downloads/加工费计费规则 (1).md` 同步；SHA-256 `8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852`（两文件逐字相同）。它取代 repo 旧文档 hash `3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817`。
>
> 本次方案修订只同步上述真值文档并修改本 PLAN；未删除路由、业务代码、测试或数据，未修改任何规则配置。

## 1. 结论先行

1. `/sales/quote` 是独立的销售只读查价页，不是建单必经链，也没有专属 API。它的页面、专属展示组件、只读目录 DAL 与专属测试可以整块删除。
2. 仓库中已经有 `calculateCreateOrderQuote` 纯函数雏形，但**生产零调用**；当前预览、提交、复核和改单仍由旧的款式、包装、物流三条链拼接。它不能直接切流。
3. 当前新引擎测试是 `1 file / 65 tests passed`。按上述最新版真值复核后，`40,001 → 5万档 0.16/0.18` 是正确黄金边界，`7,001 → 1万档` 也是 §9 指定的当前默认，两项旧指控撤销。仍成立的是 fixture 虚构“珠光艳闪 180g SKU”和引擎漏算专版西封 `+0.06/个`；此外 2万/3万等价档被合并，弱化了“配置可改”的区间身份验证。
4. “工艺参数”不应整页删除。`Craft` 仍是工艺字典、外协识别和历史任务关联；应收窄为字典，删除接单岗位、默认机型、熟练工艺等人员匹配职责。
5. 现有计件与目标相反：按“个人 + 机型”找规则，缺陷数和返工数也参与计薪；打包报工反而计件为 0、转时薪。目标应是三种工序统一扫码报工、按工序版本价结算；“缺陷/返工退出计薪”属于薪酬语义变更，已单列第 13 节待拍板，确认前不是既定事实。
6. 内部建单当前仍有“报价产品、自定义纸张/规格/尺寸、人工单价、一次性费用、人工改价说明”等维护面。目标是复用外部结构化建单字段，创建时只保留一个 `manualQuoteReason` 配置外备注；人工单价、一次性费用、定价依据不是消失，而是搬到现有工单详情 `OrderPricingReviewForm` 的工厂确认环节，并补齐 `confirmedFee` 落库。

用户已确认并接受第 13 节列出的默认值。三类工价金额仍可后补，不阻塞代码与测试交付，但没有完整已发布工价时不启用生产工资结算。

## 2. 不可触碰边界

### 2.1 现有规则配置零改动

以下内容原样保留：

- `CustomerPriceBook`、`CustomerPriceRule`、`CustomerChargeCategory` 的 Prisma 模型与数据库结构；
- 所有已发布 PROCESSING / LOGISTICS 价目簿、规则行、版本号、有效期和 source hash；
- 规则配置中心的工作台、分区编辑、发布、版本查看和校验能力；
- `OrderPricingRevision`、`OrderPriceVersionLock` 及其不可变机制；
- `readExternalCreateOrderPriceSnapshot(client, options)` 的函数名、参数和返回的双版本结构；
- `/owner/rules/stock-skus` 等配置中心入口。本任务删除的是销售前台查询入口，不借机删除“报价产品”配置数据。
- 既有 Craft/账号能力、旧工资规则、SystemSetting 等配置表的列、关系和已有行；本期即使停用其 UI/写入口/运行时消费者，也不物理 drop、delete 或改写数据；
- 历史 migration 与现有 seed 中的旧规则原样保留。新计件域只允许 additive migration 和新增 DRAFT seed，不回写任何既有配置表。

执行前后分别导出并比较：

- 两个当前生效价目簿的 `id/code/version/sourceSha256`；
- 已发布规则行按稳定排序生成的内容 hash；
- 上述五个受保护模型的 schema 片段；
- Craft/账号能力/SystemSetting/旧工资规则的 schema 片段、已有行 count/hash，以及 `prisma/seed.ts` 既有规则段 hash；
- 新 migration 不得对任何既有配置表执行 `ALTER/UPDATE/DELETE/INSERT`；只允许 `CREATE` 新计件表/枚举/索引及其必要外键。

新引擎只新增一个**只读适配器**：在同一事务和现有 shared snapshot lock 下，先调用签名不变的 `readExternalCreateOrderPriceSnapshot`，再按返回的两个 book id 读取现有规则行，投影成纯函数快照。不会改表、改行、重发版本或自动修配置。人员匹配相关 schema 字段/旧规则行作为 legacy evidence 惰性保留，但最终生产 bundle 不再读取或写入它们；“保留历史数据”不等于保留旧逻辑双轨。

### 2.2 历史金额零重算

- 历史工单继续依赖已经持久化的 `quotedFee / confirmedFee / settledFee`、legacy aggregate、pricing revision 和各类 snapshot。
- 页面读取可以增加“新旧 snapshot 解析兼容”，但不得调用报价引擎重建历史金额。
- 老 `ProductionTask.pieceworkAmount/salaryRuleSnapshot`、`DailyWorkerSalary/Item`、`HourlyWorkerPayroll` 和已支付记录保留且不重算。
- 为历史读取保留的 decoder / presentation adapter 不算双引擎；它们只能解释已存数据，不能接受业务事实重新计价。

### 2.3 测试纪律

- 功能删除时，随该功能存在的专属测试一并删除，并在报告列清单。
- 共享功能测试只删除已经消失的断言片段，其余断言保留。
- `docs/加工费计费规则.md` 第 8 节 fixture 与真值不一致时，按真值重建 fixture；这属于修复测试输入，不是削弱断言求绿。
- 不修改仍然存在的业务契约来迁就实现；失败即停止切流。

## 3. 引用检索方法与工作树风险

本轮对候选项同时检索：

- 文件路径、模块 basename、每个 export 符号；
- 静态 import、`dynamic import()`、`require()`；
- 路由完整字符串和片段、导航注册、breadcrumb、redirect/rewrite、`revalidatePath`；
- actions、API、tests、Playwright、scripts、seed、migration contract 和文档；
- 忽略 `.git`、`node_modules`、`.next` 构建产物。

核心命令形态：

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!.next/**' \
  '<路径|符号|路由字符串>' .
```

本计划把删除证据按四类记录在第 4、5、7、9 节：目标本身、全部生产入站、测试/路由/文档字符串入站、迁移后的零引用门禁。第二阶段只整删这些已列目标；若移除调用后新出现某个零引用 helper/type，但本计划没有列明，默认**保留并写入 REPORT 的待拍板残留**，不凭“看起来没用”扩大删除。历史 migration 永不删除，构建产物不算引用证据。

用户已在 `2c74f2c` 建立当前工作树 checkpoint；本次修订开始前工作树干净。当前未提交范围应只有同步后的真值文档和本 PLAN。第二阶段仍须逐文件/逐 hunk 修改与暂存；每个 commit 前检查 `git diff --cached --name-only`，禁止 `git add .`、reset、checkout 覆盖或清理用户文件。

## 4. 移除 A：销售前端报价 / 询价入口

### 4.1 可确定整删的文件

| 删除文件 | 全仓入站引用证据 |
|---|---|
| `app/(admin)/sales/quote/page.tsx` | App Router 页面；业务入口只有 `lib/navigation/admin-modules.ts:390-399`；显式页面 import 只在组合测试 `external-sales-price-book-pages.test.tsx:167,695,700,970`；旧 logistics 页只跳转到它。 |
| `app/(admin)/sales/quote/logistics/page.tsx` | 仅自身 redirect 到 `/sales/quote?section=logistics`，以及组合测试 `:168,1001`；无业务消费者。 |
| `components/business/price/ExternalSalesPriceBookCatalog.tsx` | 唯一生产 import 是销售报价页 `page.tsx:6,63`；其余均为自身测试。 |
| `components/business/price/ExternalSalesQuoteSectionNav.tsx` | 唯一生产 import 是销售报价页 `page.tsx:8-10,59`；虽有 `perspective="admin"` 参数，但管理端没有生产调用。 |
| `components/business/price/external-price-display.ts` | 只被上述 Catalog 组件相对路径 import；内容只是对共享 `lib/price/external-price-display.ts` 的 4 行转导。 |
| `lib/price/customer-price-book.ts` | `getActiveCustomerPriceBookCatalog` 只被销售报价页调用；导出类型只被 Catalog 和测试使用。它是只读展示 DAL，不是受保护的计价快照读取接口。 |
| `components/business/price/__tests__/ExternalSalesPriceBookCatalog.test.tsx` | 只测试随功能删除的 Catalog。 |
| `components/business/price/__tests__/ExternalSalesQuoteSectionNav.test.tsx` | 只测试随功能删除的 section 导航与解析。 |
| `lib/price/__tests__/customer-price-book.test.ts` | 只测试随功能删除的只读目录 DAL。 |

额外检索结论：`app/api/**` 没有对应询价 API；`next.config.ts`、`proxy.ts` 没有该路由的特殊规则；没有动态 import / require。`.next/dev` 的旧 chunk 是忽略的构建产物。

### 4.2 共享文件只删专属片段

| 文件与片段 | 删除依据 | 保留内容 |
|---|---|---|
| `lib/navigation/admin-modules.ts:390-399` | `sales.quote` 是 `/sales/quote` 的唯一菜单注册。 | 销售建单、工单、账单菜单。 |
| `lib/navigation/admin-modules.ts:450-459` | `cs.quote` 只有 `href:'#'` 占位，无页面、API、action；唯一专属断言是 `admin-menu.test.ts:390-393`。确认采用第 13 节默认值后随询价概念移除。 | 客服工单、客户与其他真实菜单。 |
| `actions/customer-price-books.ts:665-674` | `revalidatePriceBookPaths()` 中两个销售查价路径随页面消失。 | 配置中心路径与 `/orders/new` 刷新。 |
| `components/business/admin/AdminBreadcrumb.tsx:45` | `quote: '报价查询'` 只对应这一个 route segment；`app` 下唯一 `quote` 目录即该页面。 | 其他 breadcrumb label。 |
| `app/(admin)/__tests__/external-sales-price-book-pages.test.tsx` | 删除销售页 imports、catalog mock/fixture，以及 canonical quote、unknown section、旧 logistics redirect 三组用例。 | 全部管理端编辑、发布、版本和兼容跳转测试。 |
| `lib/navigation/__tests__/admin-menu.test.ts:367-374` | 删除“销售必须有报价查询”旧契约，并新增“销售菜单不含询价入口”的产品契约。 | 其他角色/菜单契约。 |
| `components/business/admin/__tests__/navigation-prefetch.test.ts:95` | breadcrumb 源码不再要求 `quote` 标签。 | 其余导航预取契约。 |
| `tests/visual/admin-responsive.spec.ts:614-623` | 删除 `sales-processing-price-book` 与 `sales-logistics-price-book` 两个视觉 case。 | 销售建单、列表、详情、账单视觉门禁。 |
| `docs/管理后台使用手册.md:103` | 当前手册仍写销售查价入口。 | 改为“销售直接建单，金额由建单引擎读取当前发布价表”。 |

历史决策 `DECISIONS.md:699,717,723`、`PROGRESS.md:115,128,152` 与 UX 稿不改写，只追加“已被本次决策废止”的记录。

### 4.3 明确保留，避免误删

- `OrderForm → quoteExternalCreateOrderAction → quoteExternalCreateOrder`：这是直接建单链，不是询价页。
- 配置中心 `customer-price-book-admin/workspace/section-workspace`、draft forms、version panel 与发布 actions。
- `lib/price/rule-snapshot-lock.ts`。
- 共享 `lib/price/external-price-display.ts`；只删组件目录下的 4 行转导。
- `app/(admin)/sales/layout.tsx`、`loading.tsx`、`error.tsx`，它们还承载销售账单等页面。
- `order:create` 权限，它也是直接建单权限。
- `/owner/rules/stock-skus` 及其模型/数据，本任务不把配置侧“报价产品”混同于销售查价入口。

配置侧“报价产品”目前仍被 `lib/order/create-order-options.ts:86-170` 作为规格/纸张等结构化建单选项的来源，所以没有“全仓零引用”的整删证据。本期只删除内部建单里的产品先导下拉，不删除 Product/Stock SKU 配置模型、数据或配置页；若后续要把该配置概念完全改名/归并，应另立数据迁移任务，不能夹带在本次引擎切换中。

### 4.4 删除后证据门禁

```bash
rg -n \
  '/sales/quote|sales\.quote|cs\.quote|ExternalSalesPriceBookCatalog|ExternalSalesQuoteSectionNav|getActiveCustomerPriceBookCatalog' \
  app components actions lib next.config.ts proxy.ts
```

生产源码应为零结果；`tests/` 只允许保留“路由/菜单不存在”的负契约，历史 Markdown 只允许出现带“已废止”上下文的记录。构建后 `.next/server/app-paths-manifest.json` 和 `.next/routes-manifest.json` 也不得再出现 `sales/quote`。旧深链不保留 redirect，按“路由整块移除”返回 404。

## 5. 移除 B：旧对外 / 通用计价链（完成迁移后删除）

这些文件目前仍有生产入站，不能提前删。表中列出的是“先迁全部调用、做零引用检索、再整删”的条件删除清单。

| 候选文件 | 当前入站证据 | 前置迁移 / 删除证据 |
|---|---|---|
| `lib/price/external-sales-quote.ts` | 生产入站为 `quote-service.ts` 和 `customer-price-book-draft-validation.ts`，其余为旧算法测试。 | 运行时迁入新引擎；把发布校验仍需的 rule 类型、limits、`validateExternalSalesPriceRules` 原样抽到配置域模块，确认无 calculator 引用后整删。 |
| `lib/order/create-order-quote-summary.ts` | 只被 `create-order-quote-service.ts`、`submit-external-order.ts` 引用。 | 新引擎直接返回 items/order lines、knownTotal、status；两处迁完后整删。 |
| `lib/price/order-packaging-quote.ts` | create service、submit、pricing review、change request 和独立 action。 | 包装组纯计算进入唯一引擎；五类调用全部迁移后整删。 |
| `actions/order-packaging-quote.ts` | action symbol 只在自身和自身测试；现表单测试还明确断言不调用它。 | unified quote action 接管后整删。 |
| `actions/order-packaging-quote.types.ts` | 只被旧 action 和 `OrderForm` 展示类型使用。 | DTO 迁到统一建单报价类型后整删。 |
| `actions/order-logistics-quote.ts`、`actions/order-logistics-quote.types.ts` | action 无生产调用，只有自身与自身测试引用。 | 统一报价已覆盖后整删。 |
| `actions/order-quote.ts` | 唯一生产 import/call 是 `components/business/order/OrderForm.tsx:39,2095`；其余命中为 action 自测和三个 Form mock。 | 内部 Form 改调统一 quote action 后整删，不能留下 internal preview 旧入口。 |
| `actions/order-quote.types.ts` | 只被 `actions/order-quote.ts:3` 引用，并只转包旧 `QuoteResult`。 | action 删除后整删；新 DTO 归统一 create-order quote contract。 |
| `lib/price/quote-service.ts` | 生产调用完整集合：`lib/order/create-order-quote-service.ts:17,133`、`lib/order/submit-external-order.ts:21,534-536`、`lib/order/pricing-review.ts:15,458-482`、`lib/order/change-request.ts:31,1404`、内部 `lib/order.ts:59,523-526`、旧 `actions/order-quote.ts:8,24`。 | preview/submit/review/change/internal create 全部迁到唯一纯引擎后整文件删除；不是只删 external branch。 |
| `lib/price/quote.ts` | `calculateQuote` 只由 `quote-service.ts:25,493` 调用；`QuoteResult` 生产类型入站为 OrderForm、create service、change request、external-sales-quote 与旧 action types。 | 所有消费者改用新 lines/result DTO 后整删；不能以“还需类型”为由留下旧 calculator 文件。 |
| `lib/auth/schemas.ts:1805-1850` 的 `quoteOrderItemsSchema/QuoteOrderItemsInput` | 当前被 `actions/order-quote.ts`、`actions/create-order-quote.ts`、create service、quote service 和 schema 测试使用。 | 结构化事实校验迁入共享新引擎 input schema；删除旧 symbol，但保留 `lib/auth/schemas.ts` 其他校验。 |

`external-order-charges.ts` 是无 IO 的纯物流 helper，可由唯一顶层引擎组合，保留；`external-order-charge-facts.ts` 保留为服务端可信事实适配。`order-charge-service.ts` 还负责发货后的最终费用与持久化，不能整删，只删除/替换旧预估计算入口。

随旧算法删除的测试：

- 整删 `lib/price/__tests__/external-sales-quote.test.ts`；
- 将仍有效的案例移入新 engine/adapter fixture 后，删 `stock-local-foil-pricing.test.ts`、`external-sales-processing-rule-v2.test.ts`、`order-packaging-quote.test.ts`；
- 整删 `actions/__tests__/order-packaging-quote.test.ts`、`actions/__tests__/order-logistics-quote.test.ts`；
- 整删 `actions/__tests__/order-quote.test.ts` 与 `lib/price/__tests__/quote.test.ts`；前者只 import 旧 action，后者只 import/test `calculateQuote`；
- `work-order-core-refactor-acceptance.test.ts:230-264` 只替换两个旧 calculator case，文件其余内容保留；
- `lib/price/__tests__/quote-service.test.ts` 在外部切换时只移走外部分支用例；内部切换并整删 service 后，剩余用例已全部迁成新 fixture，届时整文件删除；
- create service、submit、review、change-request 的功能仍存在，测试必须迁到新输出并增强，不得删除或弱化。

最终检索必须为零：

```bash
rg -n 'calculateExternalSalesQuote|quoteExternalSalesItems|external-sales-quote' app components actions lib tests prisma scripts next.config.ts proxy.ts
rg -n 'quoteOrderPackagingGroups(Action)?|order-packaging-quote' app components actions lib tests prisma scripts next.config.ts proxy.ts
rg -n 'quoteExternalOrderChargesAction|quoteExternalOrderChargesPreview' app components actions lib tests prisma scripts next.config.ts proxy.ts
rg -n 'summarizeExternalCreateOrderQuote|create-order-quote-summary' app components actions lib tests prisma scripts next.config.ts proxy.ts
rg -n 'quoteOrderItemsAction|quoteOrderItems|calculateQuote|actions/order-quote|price/quote-service|price/quote' app components actions lib tests prisma scripts next.config.ts proxy.ts
```

以上命令故意限定源码/测试/配置目录，避免本计划、最终报告与历史决策文字造成假阳性；文档另跑一次并只允许标注“已废止”的审计记录。

## 6. 对外新引擎：契约与切换

### 6.1 唯一运行路径

```text
已发布 PROCESSING + LOGISTICS 价表（只读）
          │ 现有 snapshot reader + 同事务 rule adapter
          ▼
纯函数：工单事实 + 双版本价表快照
          ▼
款/包装组/订单明细 + knownTotal/total + manualReasons[] + pendingReasons[]
          │
          ├─ 建单预览与 quote token
          ├─ 提交时服务端重算并写 quotedFee / revision / version locks
          ├─ 新工单复核与事实变更后的新 revision
          └─ 详情/列表只读持久化快照
```

最终部署只有这一条计算路径；不保留 feature flag、旧 calculator fallback 或按失败切回旧引擎的运行时分支。Git/制品回滚仍可用，但不是双轨。

### 6.2 纯函数输入

- `items`：稳定 item key/fig、`PARTIAL | FULL | PRINT`、纸张、克重、规格、定价组、产品结构、数量、正反面烫金颜色、特殊工艺和彩印叠加烫金事实；
- `packagingGroups`：`groupKey`、`SINGLE_STYLE | MIXED_STYLE`、`[{itemKey, unitsPerBag}]`；
- `shipments`：省份与逐款分配数量；浏览器重量不可信，服务端派生估算或使用履约侧可信实重；
- `isSfCollect`；
- `snapshot`：完整 `{processing, logistics}` 版本证据和由其规则行编译出的只读规则结构。

禁止继续使用当前新类型中的单字符串 `priceVersion`。输出也携带原双版本 bundle，供 token、revision 与两条 `OrderPriceVersionLock` 原样落库。

配置外标志不得信任浏览器直接传入的 `customPaper/paperWeightSource/isResized` boolean；服务端根据规范化事实、目录和价表命中结果派生。

### 6.3 包装组口径

当前新引擎把 `pack + packagingMode` 放在 item 上，无法表达 mixed group，也会把混装重复收费。改为：

- SINGLE group 必须恰好一款；MIXED group 至少两款；
- 复用 `calculatePackagingBagCount`，由 `ceil(itemQty / unitsPerBag)` 推导；mixed 各款推导出的袋数必须一致；
- `actualBagCount` 是纯函数输出，不信任浏览器；提交时按持久化 group lines 重算并断言；
- 未分组或 `unitsPerBag=null` 返回该组 `PENDING/null`，绝不当 0；
- 每包装组只输出一条 BAGGING 明细，包含 `groupKey/itemKeys/bagCount/rate/amount`。

迁移 `20260828101000_create_order_c_backfill:56-73` 已证明多个包装组不能可靠回填成 `OrderItem.pack`，因此不能用 item 字段作为新引擎唯一事实。

### 6.4 `MANUAL_PRICING_REQUIRED` 与显式待定

- 找不到规则行、命中价表空格、重复/冲突行、配置外纸张/规格/工艺：`MANUAL_PRICING_REQUIRED`，该款金额为 null、不参与 knownTotal，不找旧版、邻近档或默认值。
- 制版费与 `>2000` 走物流是文档明示的“已匹配但金额待定”，不是查表失败：保留订单级 `PENDING_AMOUNT/null`，从 knownTotal 排除，并返回 typed `PLATE_AMOUNT_PENDING` / `FREIGHT_QUOTE_PENDING`。
- 预览当前已有 plate pending，但提交没有落 `PLATE_MAKING_FEE / PENDING_AMOUNT / amount=null` 收费行；切换时补齐。
- 0 元是显式已报价；null/空格是未报价。adapter 与快照类型必须保留二者差异。

### 6.5 `docs/加工费计费规则.md` 第 8 节黄金 fixture 门禁

把最新版文档 42 个场景全部变成带 `caseId` 和章节号的数据 fixture：

| 组 | 数量 | 必须覆盖 |
|---|---:|---|
| 局部烫金 | 5 | 999/1000 边界、正 1/2/3 色、正 1 反 1、空白封/机烫/入袋分项。 |
| 专版烫金 | 15 | 基准、触感、浮雕、三色 manual；1/750/751、4500/4501、7500/7501、25000/25001、40000/40001 全部边界。 |
| 彩印 | 3 | 1000 整单价不乘数量、6000 取 5 千档、冰白中号 2000 空格 manual。 |
| 纸箱 | 11 | 500 至 20000 的全部文档值，并补 6 款 ×1000 只按整单 6000 收一次。 |
| 快递 | 8 | 五个区域、180g 向上进位、2001 待定、顺丰到付但纸箱照收。 |

另加结构 fixture：西封加价、双色、激凸、全部纸张加价、彩印单色烫金、空格与 0 元、重复行、mixed group、服务端配置外派生、双版本证据，以及触感纸方形明确无规格、万元封局部烫金、彩印覆膜、150g 莱尼纹重量与公斤进位口径。

现有 fixture/engine 必须修复：

| 现状缺陷 / 覆盖缺口 | 证据 | 修复口径 |
|---|---|---|
| 2万档与3万档被合并 | `create-order-golden-fixtures.ts:22-32` 用一行 `[15001,40000,.17,.19]`；金额暂同所以未算错，但丢失可独立配置的档位身份。 | 拆回 `15001-25000` 与 `25001-40000` 两条 snapshot fixture；保留正确的 `>=40001 → .16/.18`，断言边界按快照而非硬编码。 |
| 虚构“珠光艳闪 180g 大号 0.13” | 最新真值 `:30-43` 只有艳闪 120/160g，180g 只有红卡；fixture `create-order-golden-fixtures.ts:52-65` 却新增艳闪 180g，基础 item `:274-296` 又固定艳闪，物流测试 `create-order-quote.test.ts:409-423` 只改 GSM。 | 删除虚构 SKU；180g 快递用例与加工价解耦，或显式改用真值存在的红卡 180g。REPORT 必须贴出这些 fixture/test 行号和修复 diff。 |
| 漏算专版西封 `+0.06/个` | 最新真值 `:99-109` 明确西封加价；fixture full `create-order-golden-fixtures.ts:72-109`、`types.ts:112-127` 都无该字段，`item-quote.ts:331-381,407-430` 只合成 base/双色/纸张/特效。 | 从现有规则行编译西封加价并新增分项 fixture。REPORT 必须贴出这些 fixture/type/engine 行号和修复 diff。 |
| 缺纸张加价行一律当 0 | `item-quote.ts:336-346`。 | 仅文档明确的 160g 艳闪/红卡基准纸可为显式 0；其他缺行一律 manual。 |
| 彩印单色烫金零覆盖 | fixture 的 `foilPerOrderPrices=[]`。 | 用已发布行构造 fixture，覆盖整单附加价且不乘数量。 |
| 新引擎只在测试运行 | `calculateCreateOrderQuote` 全仓生产零引用。 | 42 个黄金 case 和结构 case 全绿后，按下列调用点一次切完。 |

两项已撤销的误判不再进入修复清单：`create-order-golden-fixtures.ts:22-32`、`create-order-quote.test.ts:230-254` 的 40,001 档符合最新版；`selectors.ts:42-59` 与 `create-order-quote.test.ts:289-311` 的 7,001→1万档符合最新版 §9 的当前默认。后者仍列第 13 节待拍板，但确认前不得改成 5千档。

### 6.6 全部调用点切换

1. **预览**：保留 `quoteExternalCreateOrderAction` 边界；重写 `create-order-quote-service` 为“服务端规范化事实 → snapshot adapter → 唯一纯函数 → token”。
2. **提交**：`finalizeExternalOrderQuoteInTx` 从持久化事实再次调用同一纯函数，写 item/group/charge line snapshot、plate pending、`quotedFee=knownTotal`、completeness、不可变 revision 和 PROCESSING/LOGISTICS 两条 lock；不接受客户端金额或版本。
3. **复核**：删除 `pricing-review.ts:454-477` 的 `quoteHistoricalOrderItems` 静默历史重算。新引擎版本的新工单按已锁快照复核；管理员补人工价时写 `confirmedFee` 和新 revision，不覆盖 quotedFee。若保留“重新报价”，只能作用于 `engineVersion >= cutover` 的新工单，必须显式触发并追加 revision；切换前历史单只能读既有快照或追加人工确认 revision，绝不调用新引擎。
4. **变更申请**：`change-request.ts:753,1404` 的包装/款式旧重算迁到新引擎；只有事实变更获批时才形成新 revision，被动查看不重算。
5. **内部建单**：本计划第 9 节的共享校验与纯函数接管后，再删除旧 internal `calculateQuote/quoteOrderItemsAction` 路径，最终不是“外部新、内部旧”。
6. **详情与列表**：统一阶段金额选择 `settled → confirmed → quoted`；迁移前历史三字段全 null 时只 fallback 到原 `totalAmount` 展示，不计算。销售列表、销售详情、管理员详情全部使用同一 selector。
7. **snapshot 展示**：新 snapshot 带 schema/engine version；`PricingSnapshotBreakdown` 兼容读旧 `components[]` 与新 lines。旧 decoder 只读，不能调用引擎。

当前管理员复核只更新 `totalAmount`、没有写 `confirmedFee`；详情/列表也只读 `totalAmount`。这两项作为现存缺陷修复，并附 fixture/contract test。`settledFee` 仍只由结算事件写，计价引擎绝不改它。

## 7. 移除 C：人员匹配、产能排程与旧计件

### 7.1 工艺参数保留/删除边界

保留 `Craft.id/name/code/isOutsource/sortOrder/isActive`：

- 建单工艺选项在 `lib/craft.ts:44-49,97-117` 读取这些字段；
- 外协覆盖在 `lib/outsource/coverage.ts:53-57,108-113` 读取 `isOutsource`；
- 历史 `ProductionTask.craftId` 仍需关联字典显示名称。

删除或停止写入的每一项及其入站证据：

| 删除项 | 全仓引用证据与处理边界 |
|---|---|
| `Craft.defaultWorkerType/defaultMachineType/inHouseMachineTypes` 的活跃读写 | schema 注释 `prisma/schema.prisma:964-995` 明写“接单岗位/默认机器/混合回厂可选机型/推荐”；生产引用集中在 `lib/production.ts:102-177,234-285,619-765,1031-1074,2365-2838` 的派工、eligible/candidate/load/改派；账号引用集中在 `lib/account.ts:200-254,505-559` 的匹配能力。新工序事实接管后删除 UI、DTO、校验与运行时读写，但按零改动红线保留 schema 字段、已有值和旧 migration。 |
| `WorkerCraftCapability`、`User.machineCapabilities` 的活跃读写面 | `AccountForm.tsx:361-454,535-554`、`lib/account.ts:183-258,323-471,505-559`、`actions/owner-accounts.ts:77-78`、`lib/auth/schemas.ts:151-256,356-418` 只把它们用于候选/熟练工艺/个人机型规则；对应生产消费者均在本节删除。表/列及已有数据惰性保留，不再通过 UI/action 读写；历史 `workerType/machineType` 暂留，不能据此重新计薪。 |
| `CraftForm.tsx:113-155` 的接单岗位/默认机型控件 | 表单提交字段只进入 `actions/owner-crafts.ts` 与 `lib/craft.ts:124-230` 的 assignment normalizer；没有建单、外协或历史展示的独立消费者。 |
| `CraftsTable.tsx:31-57` 的岗位/机器列 | 只展示上述待删字段；保留名称、编码、外协、排序、状态和编辑入口。 |
| `CraftCatalogPages.tsx:76-87` 的“排产共用”职责 | 只是该页说明文案；改为工艺字典用途，不删除页面。 |
| `lib/auth/schemas.ts:485-555` 的 craft assignment 校验与 `lib/craft.ts:124-230` 的 assignment normalizer | 输入/输出仅服务上述匹配字段；缩窄 owner craft action/DTO 后无独立业务消费者。 |

新工序直接由规范化订单事实产生，不再让可编辑 Craft 行决定“派给谁”。页面改名/定位为“工艺字典”，不是价格或人员配置页。

### 7.2 可确定整删的匹配/排产文件

| 删除文件 | 当前职责与全仓入站引用证据 |
|---|---|
| `app/(admin)/foreman/scheduling/page.tsx` | 路由入口只有 `lib/navigation/admin-modules.ts:293-304`、`lib/navigation/admin-menu.ts:212-219`、`components/business/order/OrderListBatchSelection.tsx:274-284`；直接测试 import 只有 `app/(admin)/__tests__/scheduling-handoff.test.tsx:24`。页面只取 pending board。 |
| `app/(admin)/foreman/scheduling/[id]/page.tsx` | 字符串入口只有 `components/business/order/OrderRowActions.tsx:31-39`、`components/business/order/OrderListBatchSelection.tsx:274-284`、`components/business/production/PendingSchedulingBoard.tsx:700`；页面唯一专属组件是 SchedulingForm。 |
| `components/business/production/SchedulingForm.tsx` | 唯一生产 import 是 `scheduling/[id]/page.tsx:10,74`；自身唯一内部依赖是 `scheduling-allocation.ts`；其余为专属测试。 |
| `components/business/production/scheduling-allocation.ts` | 只被 `SchedulingForm.tsx:29` 与 `SchedulingForm.split.test.ts:5` 引用。 |
| `components/business/production/PendingSchedulingBoard.tsx` | 唯一生产 import 是 scheduling page `:5,105`；其余为 handoff mock 与自身测试。 |
| `components/business/production/ReassignTaskForm.tsx` | 唯一生产 import 是订单详情 `app/(admin)/orders/[id]/page.tsx:64,1393`；其余为详情 mock 与自身测试。 |
| `components/business/production/ClaimTaskButton.tsx` | 唯一生产 import 是 `app/(worker)/worker/tasks/page.tsx:6,92`；其余为自身测试。 |
| `components/business/production/WorkerTaskBatchList.tsx` | 唯一生产 import 是 `app/(worker)/worker/tasks/page.tsx:5,43`；其“一键开工/按 plannedQty 完工”绕过逐次扫码，随已分配任务列表删除并重建 worker operation 页面。 |
| `lib/production/batch-scheduling.ts` | 唯一生产 import 是 `actions/production.ts:34` 及对应 action；其余为 action mock 与自身测试。 |
| `lib/production/task-claim.ts` | 生产入站只有 `actions/production.ts:36-40,195+` 与 `lib/production.ts:2250` 的 claimable list；其余为自身测试。 |

共享文件只删匹配片段；这些文件仍有其他职责，不能整删：

- `lib/production.ts`：删除 `scheduleOrder(:182-549)`、assignment eligibility `(:647-765)`、reassign `(:996-1133)`、batch begin/report `(:1744+,1885+)`、board/candidate/scheduling/reassign views `(:2306-2845)`；保留并改写单次扫码的事务锁、数量守卫、状态级联。candidate `:2591-2644` 统计 worker 负载，board `:2455-2490` 因“无匹配师傅”阻断，reassign `:2786-2844` 过滤 eligible worker，都是本次明确废弃的匹配逻辑。
- `actions/production.ts`：删除 schedule/batch/claim/release/reassign/batch-report actions `:45-105,195-270,349+`；保留并改造单个扫码报工 action。
- `components/business/order/OrderRowActions.tsx:21-39` 只删“去排产”；`components/business/order/OrderListBatchSelection.tsx:146-164,236-247,274-284` 只删批量排产；打印、PDF、选择和复制保留。
- `app/(admin)/orders/[id]/page.tsx:63-64,157-166,1393+` 只删 claim/reassign setting 与表单；订单详情保留。
- `lib/navigation/admin-modules.ts:293-304` 删除 scheduling 模块，`lib/navigation/admin-menu.ts:212-219` 替换 quick link；`components/business/admin/AppSidebar.tsx:139`、`actions/order.ts:152,628`、`actions/owner-accounts.ts:193` 中的 scheduling 字符串/revalidate 同步清除。
- 删除 `worker_self_claim_enabled` 的 code-facing setting：生产入站只有 `app/(admin)/orders/[id]/page.tsx:166` 和 `lib/production/task-claim.ts:149-152,449-452`；注册在 `lib/settings/definitions.ts:93-94`、`lib/settings/metadata.ts:41+`，更新特判在 `lib/settings/index.ts:107+`；其余命中为 `actions/__tests__/owner-settings.test.ts`、definitions/index tests 与旧 migration contract。上述 UI/definition/test 片段同步删除，但旧 migration、SystemSetting 行与通用表结构原样保留，不新增清理 migration。
- 账号 schema/action/form 删除 machine capability 与 craft capability 的活跃编辑面；历史工资/任务快照不依赖当前账号能力。

权限单独迁移，不能随字符串误删：`task:claim` 只有将被删除的抢单消费者，因此删除 active checks/菜单，但按配置零改动保留既有 permission code/row；`order:schedule` 仍被 `createReworkOrderAction` 使用（`actions/order.ts:135-153`），先迁到已有的恰当返工/订单管理权限；`task:assign` 还被考勤 action 与菜单使用（`actions/foreman-attendance.ts:20-27,60-67`、`admin-modules.ts:329-340`），先迁到已有 attendance 管理权限。扫码继续使用 report 权限并叠加工序类别授权，不新增人员-工单权限关系。

保留并改造：扫码身份与权限、QR 入口、task/operation 锁、数量上限守卫、状态机、争议、订单完成级联。当前 `begin/report` 在 `lib/production.ts:1291-1325,1475-1478` 强制 `task.workerId===actor.id`；目标是 session reporter + 工序授权，而不是取消鉴权。

### 7.3 旧计件链删除

| 删除项 | 引用证据 / 原因 |
|---|---|
| `lib/salary/machine-piecework.ts` | 只实现机型小单、每下、每板、倍率和每日保底；与工序固定单价不兼容。 |
| `lib/salary/piecework-admin.ts` | 只管理个人 + 机型版本规则。 |
| `components/business/rules/salary/WorkerPieceworkRulesPage.tsx` | 页面文案与数据全部是机型默认和个人覆盖。 |
| `components/business/salary/WorkerMachineRuleForm.tsx` | 只写个人机型规则。 |
| `app/(admin)/owner/rules/worker-piecework/page.tsx` | 旧计件配置入口；新工价 UI 明确不在本期。 |
| `actions/owner-salary.ts:239-278` 的个人机型 rule action/type | 唯一 UI submit 来自 WorkerMachineRuleForm；`actions/__tests__/owner-salary.test.ts` 是测试 mock/断言。文件其他工资 action 保留。 |
| `lib/salary/rules.ts` 的 WORKER_MACHINE / 个人优先取价分支 | 生产调用来自旧 `lib/production.ts` 报工和 `lib/salary/daily.ts` 重算；两者切新 ledger 后无新业务消费者，历史 snapshot 不调用它。其他工资类型读取保留。 |
| `lib/navigation/rule-center.ts:12,233-242` 的 workerPiecework 项及旧 route 字符串 | 生产入口完整集合为 EmployeePayRulesPage、owner salary/daily 页和 `next.config.ts:92` redirect，已在下段逐项列出；其余为 menu/redirect/smoke/visual tests。只删该 item，不删规则中心。 |

整删成立的入站证据：`machine-piecework.ts` 的生产 import 只有 `lib/production.ts:30`、`lib/salary/daily.ts:22`、`lib/salary/rules.ts:3`；`piecework-admin.ts` 只有 `actions/owner-salary.ts:26`、WorkerPieceworkRulesPage 与测试 mock；WorkerPieceworkRulesPage 只有 worker-piecework route 与语言测试；WorkerMachineRuleForm 只有该 Page 与通用表单源码契约测试。worker-piecework route 的入口完整集合是 `lib/navigation/rule-center.ts:12,233-242`、`components/business/rules/salary/EmployeePayRulesPage.tsx:29`、`app/(admin)/owner/salary/page.tsx:35`、`app/(admin)/owner/salary/daily/page.tsx:123` 和 `next.config.ts:92` 的 legacy redirect；其余命中为该功能的 action/测试/E2E/visual。消费者迁移后逐项跑零引用检索再整删。

现有 `lib/production.ts:1420-1424,1562-1608` 按 `completed + defect + rework` 和个人/机型规则计薪；`:1609-1618` 对 PACKER 写 0 并标记 HOURLY。新契约只按本人扫码的**合格完成数**结算，三类工序使用统一 ledger。未来 PACKER 停用 `PACKER_HOURLY`；旧 SalaryRule 行和历史 HourlyWorkerPayroll 只读保留。

`prisma/seed.ts:234-295` 中既有 WORKER_MACHINE、PACKER_HOURLY 和 COOK_SPARE_HOURLY seed 按零改动红线原样保留，但新运行时不读取它们；报告用消费者零引用证明停用，而不是改 seed 假装迁移。`lib/salary/daily.ts:243-499` 当前会按旧 task/rule delete/rebuild 当日明细，切换后禁止对 legacy 工资重算；`lib/cron/tasks.ts` 改聚合新 ledger。`lib/salary/hourly-aggregate.ts:109-117,304-312` 对 cutover 后的新报工排除 PACKER 与兼职打包，避免同一打包既时薪又计件，旧 payroll 行不改。

旧 `ProductionTask`、`DailyWorkerSalary/Item`、`HourlyWorkerPayroll` 保留历史读面；新运行时不得把旧 task 金额和新 report 金额相加。`lib/bill/costing.ts:61-100`、计件导出、worker portal 和 owner salary 汇总按 cutover generation 二选一。`WorkerMachineSalaryRule`/旧机型规则表、行和既有 seed 在本任务中无条件物理保留，只删除 UI/写入口/运行时计算；未来若要清理，必须另立方案和确认，不能借本次 snapshot 核对顺手删除财务证据。

### 7.4 随功能删除的测试清单

以下测试只验证被移除的排产/抢单/个人机型计件功能，随功能整文件删除；右侧是其唯一被测对象/入口证据：

| 删除测试 | 唯一测试对象 / 引用证据 |
|---|---|
| `tests/e2e/batch-scheduling.spec.ts` | 只走 `/foreman/scheduling` 批量派工 fixture/页面。 |
| `app/(admin)/__tests__/scheduling-handoff.test.tsx` | 直接 import scheduling page，并 mock PendingSchedulingBoard/getPendingSchedulingBoard。 |
| `lib/production/__tests__/batch-scheduling.test.ts` | 唯一业务 import 是 `../batch-scheduling`。 |
| `lib/production/__tests__/task-claim.test.ts` | 唯一业务 import 是 `../task-claim`。 |
| `lib/production/__tests__/task-claim-migration-contract.test.ts` | 只验证 self-claim migration/setting；历史 migration 文件保留，但该功能契约消失。 |
| `components/business/production/__tests__/SchedulingForm.split.test.ts` | 只 import `../scheduling-allocation`。 |
| `components/business/production/__tests__/SchedulingForm.a11y.test.tsx` | 只读取/断言 SchedulingForm 源码。 |
| `components/business/production/__tests__/PendingSchedulingBoard.test.tsx` | 只 import/render PendingSchedulingBoard。 |
| `components/business/production/__tests__/ReassignTaskForm.claim-pool.test.tsx` | 只 import/render ReassignTaskForm 的改派/抢单边界。 |
| `components/business/production/__tests__/ClaimTaskButton.contract.test.tsx` | 只 import/render ClaimTaskButton。 |
| `components/business/production/__tests__/WorkerTaskBatchList.test.tsx` | 只 import/render WorkerTaskBatchList 的已分配批量开工/完工。 |
| `lib/salary/__tests__/machine-piecework.test.ts` | 只 import/test `../machine-piecework`。 |
| `lib/salary/__tests__/piecework-admin.test.ts` | 只 import/test `../piecework-admin`。 |
| `components/business/rules/__tests__/piecework-business-language.test.tsx` | 只 import WorkerPieceworkRulesPage，并 mock piecework-admin/WorkerMachineRuleForm。 |

共享流程测试不能整删：`actions/__tests__/production.test.ts`、`lib/__tests__/production.test.ts` 只删除 schedule/claim/reassign/batch describe 并新增 operation/report 测试；`production-flow.spec.ts`、`manual-production-flow.spec.ts` 仍验证生产主流程，只把排产改为自动工序 + 扫码；导航、订单详情、工资、cron、导出、成本、Craft、账号与 schema 测试只替换确已消失的断言。报告将逐文件区分“整删测试”与“保留文件中的契约迁移”。

删除后源码门禁（schema、已有 seed 和历史 migration 因零改动红线不纳入字面量清零）：

```bash
rg -n '/foreman/scheduling|SchedulingForm|PendingSchedulingBoard|ReassignTaskForm|ClaimTaskButton|WorkerTaskBatchList|scheduleOrdersToWorker|worker_self_claim_enabled' app components actions lib next.config.ts
rg -n 'task-claim|batch-scheduling|claimProductionTask|reassignProductionTask|getPendingSchedulingBoard' app components actions lib next.config.ts
rg -n 'machine-piecework|piecework-admin|WorkerPieceworkRulesPage|WorkerMachineRuleForm|/owner/rules/worker-piecework' app components actions lib next.config.ts
rg -n 'machineCapabilities|craftCapabilities|WorkerCraftCapability|defaultWorkerType|defaultMachineType|inHouseMachineTypes' app components actions lib
```

前三条生产源码应为零。第四条若历史只读 adapter 仍需显示 legacy 快照，只允许命中明确隔离的 decoder/presentation 文件；任何建单、候选、派工、报工、取价或工资聚合命中都算失败，并在 REPORT 附逐行 allowlist。`tests/` 与 Markdown 另行检索，只允许新“入口不存在”负契约或带“已废止”的历史审计文字。

## 8. 对内新计件：工序、扫码、工价版本

### 8.1 最小数据结构

新增独立域，不复用或修改受保护的 `CustomerPriceBook`：

- `OperationType = PARTIAL | FULL | PACKING`；
- `PieceworkPriceBook`：version、DRAFT/PUBLISHED 状态、effective time、source/hash、publishedAt；发布后不可变；
- `PieceworkPriceRule`：唯一 key 为 `operationType`，保存 unit 与 nullable amount；PUBLISHED 版本三条必须齐全且金额显式，0 与 null 不同；
- `ProductionOperation`：关联 order 与 `operationType`，保存 planned unit/status，不保存 worker/machine；通过 `ProductionOperationSource` 关联一个或多个来源 item / packaging group，仅用于追溯事实和推导数量，不作为工价键；
- append-only `ProductionReport`：operation、session reporter、reported completed qty、chargeable qty、unit/rate/amount、book id/version/hash、完整 snapshot、reportedAt、idempotency key、`LIVE | LEGACY_IMPORT` 来源；更正只追加 reversal，不原地 edit/delete；
- `PieceworkSettlement/SettlementItem`：按 reporter/date 锁定 report IDs、合计、调整、paid 状态与快照。旧 `DailyWorkerSalaryItem` 强绑 machine/task，不能硬塞 PACKING；若首期暂缓日结 UI，至少仍需一个不会与 legacy 相加的 settlement 边界。

旧 `ProductionTask` 只做历史读取；切换点后的生产与工资只写新 operation/report ledger。非终态旧任务在 migration preflight 中确定性转换，转换成功后旧任务不再可写；完成/已结算旧任务绝不按新工价迁金额。

### 8.2 工序生成与计薪数量

| 订单事实 | 生成工序 | 计薪数量 |
|---|---|---|
| 局部烫金单 | PARTIAL + 每个包装组的 PACKING | 按第 13 节默认值：本人扫码的合格完成个数 × 正反面颜色次数；确认后才采用。 |
| 专版烫金单 | FULL + 每个包装组的 PACKING | 本人扫码的合格完成个数。 |
| 纯彩印 | 仅 PACKING | 包装组实际袋数；不产生 PARTIAL/FULL。 |
| 彩印 + 局部烫金 | PARTIAL + PACKING | 烫金按 PARTIAL，包装按袋。 |
| 彩印 + 专版烫金 | FULL + PACKING | 烫金按 FULL，包装按袋。 |

工序类型从 canonical order facts 派生：`OrderItem.craft` 已有 `PARTIAL/FULL/PRINT`（`prisma/schema.prisma:258-274,446-507`），彩印叠加烫金已有 `hasLocalFoil` 区分局部/专版（`lib/order/external-create-order-command.ts:201-210`）。它们决定 operation type，不查询人员、机型或 Craft assignment 字段。

“关联来源 item”不等于“计件跟订单线走”：工价查询唯一 key 永远是 `operationType`，结算只聚合 operation reports。同一实际生产批次的同类工序可以聚合多个 item source，不强制每个 OrderItem 生成独立计件主体；拆/并 operation 只反映真实扫码批次，不产生人员匹配或不同工价档。

PACKING 是“一包装组一工序”，不是“一款一任务”。`OrderPackagingGroup.actualBagCount` 已存在，`packaging-bag-count.ts:13-101` 已实现 ceil 与 mixed 各款袋数一致校验；混装只付一次，不因款数重复。内部建单也必须形成合法 packaging group，否则无法可靠推导工序数量。

三类之外的粘封、清废、纯外协等仍可保留生产/外协进度，但不进入这张三类工价表，也不通过人员匹配分配；没有文档工价时不猜计件金额。

### 8.3 扫码机制

- 价格已确认后，用一个“投产”动作自动物化工序并进入生产，不展示候选、负载、机型或人员选择；可复用现有状态过渡，但不保留 capacity scheduling UI。
- 任意具备对应固定工序岗位的登录账号可扫该工序 QR；服务端从 session 写 reporterId，客户端不能传 workerId。
- 每次扫码报工追加 `ProductionReport`；同一工序可以由多人分别报工，不把首个扫码人变成“工单匹配关系”。
- 聚合合格完成数控制工序完成；按第 13 节待拍板默认值，缺陷/返工仍记录质量事实但不进入本期计薪；只有本计划获确认后才采用该薪酬口径。
- 报工事务读取当时唯一 PUBLISHED 工价版本，调用无 IO 纯函数 `chargeableQty × rate`，把版本、单位、单价和金额锁进 report snapshot。
- 无已发布规则、重复规则或 amount=null 时 fail closed，不按 0、不找个人覆盖、不找机型默认。
- 工资结算只聚合本人 report ledger：`Σ report.amount`。不再套 `max(计件, 每日保底)`，PACKER 也不再叠加未来时薪。

### 8.4 seed 留位

seed 只创建一个 DRAFT v1 和三条规则：

| operationType | 默认单位 | amount |
|---|---|---|
| PARTIAL | `PER_PASS`（待拍板） | null |
| FULL | `PER_PIECE` | null |
| PACKING | `PER_BAG`（待拍板） | null |

不得用 0 代替待补金额；发布校验拒绝 null。seed 重跑只保证这一个 DRAFT/三条 placeholder 存在，不覆盖后来填入的金额，也绝不自动改成 PUBLISHED。单元/集成测试使用测试专用非零 fixture，不污染 seed。代码、schema、migration、纯函数和测试可完成；正式生产结算必须等三项金额补齐并发布。

### 8.5 无配置 UI 时的一次性 v1 发布闭环

本期明确采用**一次性脚本发布 v1**，不再写“seed/脚本二选一”。现有 `publishCustomerPriceBookDraft`（`lib/price/customer-price-book-admin.ts:2359-2520`）硬编码 CustomerPriceBook/Rule、EXTERNAL_SALES 和外部规则校验，且首版要求已有 current，不能直接复用；只借鉴它的锁、乐观并发、hash 和审计模式。

- 新增独立 `lib/salary/piecework-price-book-admin.ts`，不改 `customer-price-book-admin.ts` 或任何 CustomerPrice* 模型/数据；发布使用 advisory lock、`expectedDraftUpdatedAt`、半开有效期、规范化 rule-set SHA，并与 `BusinessAuditLog(PUBLISH_VERSION)` 同事务。
- 新增版本化 v1 JSON manifest 和 `scripts/publish-piecework-price-book-v1.ts`（含 package script）。manifest 只含三类 operationType/unit/amount、effectiveFrom、source/publishNote；默认 dry-run，只有显式 `--apply` 才写入，并要求一个 active ADMIN 作为 audit actor。
- apply 在一个事务内锁定并重读 canonical DRAFT v1，只允许 amount 从 null 写为 manifest 显式值或与已填值完全一致；校验正好三类、unit 合法、amount 非 null/非负/精度合法、无重复，再计算 manifest/rule-set SHA 并发布首个 v1。
- 相同 manifest 重跑返回 already-published receipt；金额、hash、effectiveFrom 或 draft revision 不同一律 fail closed，不能覆盖已发布版本。
- receipt 输出 book id/version/effectiveFrom、三条 unit/rate、manifestSha、ruleSetSha、auditLogId，完整贴入 REPORT。没有 PUBLISHED 版本前，扫码报工和结算继续 fail closed。
- 新增 `piecework-price-book-admin.test.ts`、migration contract、并发 Postgres publication test、脚本 dry-run/apply/idempotency test 和 seed 双跑 contract；发布前后再核对全部既有对外价表 count/hash 不变。

### 8.6 迁移与原子切换

1. 在目标数据库只读统计 task 状态/工艺/worker、工资 paid/unpaid、包装组覆盖和账号类别；任何无法唯一映射的记录都阻断切换。
2. 新表/枚举先落地；DRAFT placeholder 不自动发布。
3. 已完成或已结算 legacy 工资按旧 snapshot 原样保留；若新统一读面必须看到它们，只生成 `LEGACY_IMPORT` 记录并逐条复制既有金额/版本，禁止套新工价。count、sum、paid 状态必须 100% 对账。
4. 非终态旧 task 按 canonical order facts 合并成无 workerId 的 operation；PARTIAL/FULL 通过 source join 追溯一个或多个 item，PACKING source 只能是 packaging group。缺 group、重复主体、未知工艺一律阻断，不猜映射。
5. QR、report、completion、payroll、bill、详情全部切到新 ledger，再关闭旧 task 写入并删除旧运行时代码；切换使用同一 cutover marker/事务，不能分批让两个账本同时写。

本地库只读预检发现 `114` 个 task（`27 completed / 87 pending`），其中 `86` 个 pending 已预分配；`204` 个活跃 item 中 `184` 个没有 packaging line。该库明显含 E2E fixture，不能代替生产证据，但已经证明“直接删 assignment/task”与“假定每款已有袋数”都不安全；第二阶段必须在实际目标库重跑同一 preflight。

## 9. 简化内部建单的配置外项目

### 9.1 删除/替换清单与证据

`OrderForm.tsx` 当前内部专属区域：

| 片段 | 处理 | 证据 |
|---|---|---|
| `:3305-3405` “报价产品”下拉及选中后自动回填 | 删除 | 外部 B 已直接选工艺/纸张/规格；内部共享同一输入后不再需要 product 先导路由。`Product`/options 仍被 `lib/order/create-order-options.ts:86-170` 使用，因此只删该控件，不删除配置中心 Product 数据。 |
| `:3406-3523` 自定义产品结构、规格、纸张、GSM、宽高 | 删除内部专属动态面 | 配置外统一进入一个备注 + manual；真值明确支持的外部手动克重/改尺寸仍在共享 B 中保留。 |
| `:3558-3655` 重新核价、成交单价、一次性费用、人工改价说明 | 从创建页移到工厂确认 | 现有 `OrderPricingReviewForm.tsx:264-389` 已有客户单价、每款一次性费用、定价依据输入；本期保留并扩展该入口，建单人不再造临时价格。 |
| `:3657-3666` 通用款式备注 | 保留 | 它是生产说明，不与配置外核价原因混用。 |
| `manualQuoteReason` | 改成唯一“配置外项目说明” textarea | 字段已存在；当前 submit 分支 `:1354-1369` 反而清空它，需要修正持久化。 |
| `components/business/order/order-form-gaps.ts:120-180` | 改写 shared validation | 当前强制 product/paper/craft，并以“手填价格 + 原因”解除缺口；目标是内部缺配置 + 非空说明 → manual，外部不能用说明绕过。 |

上述删除不是只看 JSX 文案：三个 UI 块都位于 `!usesExternalSalesPricing` 分支（分流定义在 `OrderForm.tsx:883-913`）。旧内部报价的完整前端出站是 `quoteViews` state `:1005+` → `calculateAndApplyQuote(:2085-2145)` → 自动重算 effect `:2269-2282` / active view `:2570,2648,3124-3129` → `quoteOrderItemsAction`；后端人工兜底是 `lib/order.ts:578-671`。统一引擎接管后删除这些内部旧状态/callback/action 调用与手填金额服务端分支；`OrderForm` 文件、通用表单 state 和 order create action 保留。

相关 shared 类型/字段不能猜删：`productId/productStructure/specification/paperType/paperWeightGsm/dimensions` 还用于外部结构化事实、持久化和历史展示，`unitPrice/fixedFee` 还承载旧快照；只改新建校验/写法。`lib/order/catalog-pricing-facts.ts` 的四个 helper 仍被 `lib/material.ts`、`external-order-b-catalog.ts`、`create-order-options.ts` 和自身测试引用，明确保留。内部 UI 移除后若有局部 helper/state 真正零引用，必须以符号级 `rg` 证据追加到 REPORT，不能顺手删除共享模块。

稿件版本、版组/模具组等真实生产事实保留；专版计价组由结构化规格/价表映射派生，不让配置外自由文本变成动态价目键。

全仓没有发现“临时加选项/动态扩展写库”的现成实现，因此本方案不虚构文件去删；验收改为确保新代码没有新增这类 model/action/API/UI。

对应测试边界：`order-form-gaps.test.ts`、`OrderForm.pricing-routes.test.tsx`、`order-form-local-draft.test.ts`、`OrderForm-logistics-quote.test.ts`、`actions/__tests__/order.test.ts`、`lib/__tests__/order.test.ts`、`tests/e2e/{order-create,manual-production-flow,notification-urgent}.spec.ts` 与 `tests/visual/admin-responsive.spec.ts` 仍覆盖建单主流程，不能整文件删除；只移除旧控件/手填价断言，并新增“一个备注 → manual/null/no fallback”的独立契约 fixture。

### 9.2 内外共享校验

| 场景 | 外部销售 | 内部建单 |
|---|---|---|
| 配置内纸张/规格/工艺 | 同一 schema、同一事实规范化、同一纯引擎。 | 同左。 |
| 真值明确的手动克重/改尺寸/自定义纸张 | 按真值返回 typed manual。 | 同左。 |
| 结构化事实存在，但缺价/空格/规则冲突 | `MANUAL_PRICING_REQUIRED`、amount=null、禁止任何 fallback。 | 同左。 |
| 规则配置完全没有的项目 | 不允许用自由备注伪装成结构化选项，拒绝配置外结构创建。 | `manualQuoteReason` 非空可放行创建为 `MANUAL_PRICING_REQUIRED`；为空拒绝。 |
| 人工金额 | 创建页不填，复核层追加 confirmed revision。 | 同左。 |

### 9.3 `MANUAL_PRICING_REQUIRED` 的工厂确认闭环

不另造一套页面，迁移并补全现有链路：

```text
工单详情 → OrderPricingReviewForm
         → previewOrderPricingReviewAction / finalizeOrderPricingAction
         → 锁定报价快照 + 人工金额/依据
         → confirmedFee + ADMIN_CONFIRMED revision
```

现有能力与缺口证据：

- `app/(admin)/orders/[id]/page.tsx:218-222,512-560` 只给 ADMIN + EXTERNAL_SALES 展示复核入口；`pricing-review.ts:331-343` 也拒绝非 EXTERNAL_SALES，所以内部/工厂直单目前进不去。
- `OrderPricingReviewForm.tsx:264-389` 已给不完整款提供 unitPrice、fixedFee、reason，`:393-497` 提供人工包装价，`:500-618` 提供物流/耗材值；schema 在 `lib/auth/schemas.ts:2645-2701`，权限是 `order:price:confirm`。
- `pricing-review.ts:771-840` 已校验人工款金额、依据并形成行 snapshot，`:1154-1172` 已追加 `ADMIN_CONFIRMED` revision；但 `:1129-1140` 只更新 processing/packaging/total，生产代码没有任何 `confirmedFee:` 写入，因此当前终价后 `confirmedFee` 仍为 null。
- preview/finalize 当前在 `pricing-review.ts:513-664,666+` 调旧引擎按最新规则重算，文案也写“按最新价格重算”；这与历史不重算红线冲突。

目标闭环：

1. 保留并改名/改文案为“工厂核价与确认终价”；扩大到所有使用共享新引擎且收费的 EXTERNAL_SALES、INTERNAL_SALES、FACTORY_DIRECT，NO_CHARGE 不显示。
2. 新引擎切换后的工单只读取创建时锁定的双 priceVersion 和 quoted line snapshots；自动价只读展示，只有 `MANUAL_PRICING_REQUIRED` / typed pending 行录入人工金额与依据。切换前历史单不调用任何引擎。
3. 内部配置外 `manualQuoteReason` 在确认页显示并作为原因上下文，但管理员仍须明确提交终价依据；创建页的通用生产备注不能替代它。
4. finalize 在一个事务内写人工行/包装/物流快照，计算并写 `confirmedFee=整单确认总额`；`quotedFee` 与 `settledFee` 原样不动；追加且只追加一条 `ADMIN_CONFIRMED` revision，记录 confirmer/time 和人工明细。
5. 详情/列表按 `settledFee → confirmedFee → quotedFee → legacy totalAmount` 选择；quoted 显示“估”，没有 confirmedFee 的 manual 单显示“待工厂核价”。

新增/加强测试：创建页不再出现人工金额但确认页仍有三字段；内部/工厂直单可见、NO_CHARGE 不可见；非管理员拒绝；金额精度/范围/必填依据；stale revision 与并发只允许一次成功；事务失败全回滚；明确断言 confirmedFee 写入且 quotedFee/settledFee 未覆盖；revision snapshot 含金额、依据、操作者；切换前历史预览/详情不调用引擎。

## 10. 历史十单验收

切换前冻结 10 个唯一外部订单 ID，互斥取样：

- 2 张完整自动报价；
- 2 张含 manual 或 pending；
- 2 张管理员已确认；
- 2 张已发货/已完成；
- 1 张顺丰到付；
- 1 张 mixed packaging、多款或多地址。

验收必须取得 **10 个唯一、切换前已存在的真实工单**。某个优先分层不足时，从其他历史类别补足到 10，并在报告披露覆盖缺口；历史总数不足 10 则阻断切流，不能用新造 fixture 或少量样本降级验收。

切换前后对同一 ID 捕获并比较：

- Order：三段 fee、completeness、processing/packaging/total legacy aggregates、pricing status/revision；
- items：quotedAmount、disposition、unit/fixed/subtotal、pricingSnapshot hash；
- packaging groups/lines；
- customer charges：amount/status/businessKey/snapshot hash；
- pricing revisions 与双 version locks；
- 销售列表、销售详情、管理员详情实际金额文本和“估/待定/已确认”标签。

验收要求：数据库值与 hash 完全不变，三个页面金额逐字符不变，抽查脚本不 import/call 任何报价函数，也不执行 UPDATE。历史三段字段都为空时仍以已有 `totalAmount` 兼容展示，这只是读旧快照，不是重算。

## 11. 执行顺序与独立 commit

执行前先完整阅读本仓库 `node_modules/next/dist/docs/` 中与 App Router、Server Actions、redirect/revalidation 相关的当前版本文档，再动 Next.js 代码。

建议最终 commit 序列：

1. `refactor(sales): remove standalone quote inquiry feature`
   - 第 4 节完整删除；独立可回滚。
2. `test+feat(pricing): align section-8 fixtures and pure quote contract`
   - 对齐 42 个 fixture、双版本、包装组、西封和 no-fallback；尚不部署切流。
3. `refactor(pricing): add read-only published-rule snapshot adapter`
   - 不改配置模型/数据/reader 签名。
4. `refactor(order): switch preview and submit to the pure engine`
   - 落 quotedFee、lines、plate pending、revision、双 lock。
5. `refactor(order): switch review and change requests without historical reprice`
   - 写 confirmedFee；旧单只读 snapshot。
6. `refactor(order): unify internal create and configuration-outside manual flow`
   - 删除内部专属产品/动态/手填价面，完成内外共用。
7. `refactor(pricing): delete all superseded quote calculators and actions`
   - 此时做最终零引用检索；最终制品无双轨。
8. `feat(piecework): add versioned operation rates and immutable report ledger`
   - 新表、纯函数、发布门禁与 DRAFT seed 留位；同时交付独立发布服务、版本化 v1 manifest、默认 dry-run/显式 `--apply` 的一次性发布脚本及其幂等/并发测试，尚不切旧生产流。
9. `refactor(production): migrate active work to operation-based reporting`
   - 跑 preflight、确定性迁移非终态任务、自动物化工序，切 QR/扫码/完成级联。
10. `refactor(production): remove personnel scheduling and claiming`
    - 删除候选、负载、派工、改派、抢单及专属测试；权限先迁剩余消费者。
11. `refactor(payroll): settle immutable operation reports`
    - 工资、成本、导出和 portal 二选一读取新/legacy ledger，PACKER 停止未来时薪。
12. `refactor(piecework): remove machine and personal-rate runtime`
    - 删除旧 UI/算法/写入口，历史工资与付款证据只读。
13. `refactor(crafts): narrow craft configuration to a dictionary`
    - 删除匹配字段/能力的 UI、DTO、校验和运行时消费者；schema 与已有配置数据惰性保留，字典、外协与历史关联不变。
14. `docs(audit): publish engine-switch verification report`
    - 生成 `REPORT-引擎切换.md`，记录所有命令、结果、删除与抽查。

中间 commit 只存在于开发分支，不单独部署；第 7 步完成前不发布计价切换。若当前脏工作树导致某个共享文件无法安全分 hunk，立即停止并报告冲突，不覆盖用户改动。

## 12. 验证门禁与停止条件

### 12.1 每个功能块

- 专属 vitest；
- 对应 navigation/route/action/contract tests；
- `pnpm typecheck`；
- `pnpm lint`；
- 相关 Playwright（销售建单/详情、内部 manual、生产扫码/工资）；
- 删除块的全仓零引用检索。

### 12.2 切流前总门禁

- `docs/加工费计费规则.md` 第 8 节 42 个 fixture 全绿，结构补充 fixture 全绿；
- adapter 对当前已发布规则的行数、区间、rule code/source hash 投影一致；
- 同一 canonical facts 的 preview、submit 重算和 token 完全一致；
- 没有未列明的分币差异、manual/pending 分类变化或邻近档 fallback；
- 10 张历史单数据库与三个页面显示完全不变；
- 全部既有配置 schema/行/legacy seed 段、已发布价表与版本快照前后 hash 完全一致；新 migration 只有 additive 新计件域；
- 新旧计价入口最终 `rg` 零残留；
- 新工资结算只查 `ProductionReport`，不与旧 `ProductionTask.pieceworkAmount` 相加；
- 全量 vitest、typecheck、lint、build 通过；相关 e2e 通过。

任一项失败即停止，不通过改旧断言、填 0、取邻近档或回退旧引擎绕过。

## 13. 待拍板（本次一次确认覆盖）

| 项 | 证据与影响 | 默认值 |
|---|---|---|
| 打包计件单位 | `actualBagCount` 已由包装组推导；按 item 会让 mixed 重复付费。 | **PER_BAG，按袋；混装不另分档，一包装组只付一次。** |
| PARTIAL 工价单位 | 数据待补写的是“元/次或元/个”；外部真值已经把局部烫金定义为正反面颜色总过版次数。 | **PER_PASS；师傅报合格成品个数，系统乘过版次数，师傅不手算。** |
| 客服侧 `cs.quote` 占位菜单 | `admin-modules.ts:450-459` 仅有 `href:'#'` placeholder；无页面、API、action，唯一专属断言在 `admin-menu.test.ts:390-393`。它不属于严格 SALES 路由，但同样表达“询价”。 | **一并移除。** |
| 同一账号是否可跨 PARTIAL / FULL | 当前 `WorkerType + machineType` 是单一身份；多值 `machineCapabilities/craftCapabilities` 只服务将删除的推荐匹配。业务文字没有说明一人兼任两类。 | **每账号一个主工序：HAND_PRESS→PARTIAL、WINDMILL→FULL、PACKER→PACKING；保留 workerType/machineType 作历史兼容与迁移来源。若以后确有跨类人员，再加只用于扫码鉴权的 `UserOperationPermission`，绝不用于候选/负载/派工。** |
| 三类之外的工艺是否仍作为完工步骤 | seed 仍有 GLUING/CLEANING/UV 等真实生产步骤，但本次只定义三类计件，不能把它们静默映射到 FULL/PACKING。 | **保留为无计件、无人员匹配的生产/外协进度步骤；若原流程要求扫码，继续作为完工闸口，但不生成 PieceworkReport 金额。** |
| 缺陷/返工是否计薪 | 旧实现 `lib/production.ts:1420-1424,1583-1597` 按 `completed+defect+rework` 计薪，`lib/__tests__/production.test.ts:1971-1979` 固化 4900+50+50=5000；这是既有薪酬语义，不能随引擎切换静默改变。 | **本期只按本人扫码的合格 `completedQty` 计件；defect/rework 继续记录质量事实但不进入本期工价，另立薪酬规则。历史工资快照不重算。** |
| 彩印 7001～7999 档位 | 最新真值 §3 的区间文字没有完全闭合，§9 明确“现按 1万档实现”；当前 `selectors.ts:42-59` 与测试 `:289-311` 正是此行为。 | **本期维持 7001～7999 → 1万档；不把现有正确 fixture 改成 5千档。区间仍由价表 snapshot 提供，未来配置发布可改。** |
| 万元封局部烫金 | 真值 §9 只记录旧表 0.38/0.42，但当前规格列表未纳入，结构支持范围不明确。 | **本期不扩展结构化选项；若输入/历史事实出现则 `MANUAL_PRICING_REQUIRED`，不复活旧表 fallback。历史单仍只读已有快照。** |
| 彩印覆膜加价 | 真值 §3/§9 明确触感膜、新光膜、雷射金额待定。 | **选择这些膜时该款 `MANUAL_PRICING_REQUIRED`；标准铜版纸默认覆亚膜不额外收费。** |
| 150g 莱尼纹单重 | 真值 §6.1 当前表值为 6g，§9 说明按比例会是 5.625g。 | **沿用文档当前可执行值 6g；不在引擎自行按比例换算。** |

以下已由最新版文档和代码证据消歧，不上榜：专版 40000/40001 边界；触感纸无方形规格；公斤重量一律向上进位；plate 与 >2000 物流的显式 pending；Craft 字典保留；多人扫码用 append-only report；旧历史金额不重算。

## 14. 数据待补但不阻塞开发

- PARTIAL：元 / 次；
- FULL：元 / 个；
- PACKING：元 / 袋。

代码完成时 DRAFT seed 三项 amount 都为 null。提供金额后，由 `scripts/publish-piecework-price-book-v1.ts --apply` 按已审阅的版本化 manifest 一次性发布 v1，并把 receipt 收进 REPORT；没有发布版本前工资报工/结算 fail closed，不会把 null 当 0。

## 15. 风险与回滚

| 风险 | 控制 |
|---|---|
| checkpoint 后本次真值文档与 PLAN 修订可能和第二阶段改动交叉 | 当前未提交范围必须保持仅这两份文档；第二阶段逐 hunk 编辑/暂存，每 commit 检查 staged diff，禁止 reset/覆盖。若出现其他用户改动，先隔离并报告。 |
| 配置行能发布但无法投影为文档结构 | adapter fail closed 并报告 rule id/code；不改配置、不找旧版。 |
| 新纯函数 fixture 先前自证不足 | 42 个 case ID 与已锁 hash 的最新版文档逐条对照，增加 adapter row fixture 和 no-fallback 契约；撤销的两项不得误改。 |
| mixed packaging 被重复计费/计件 | 报价与生产都以 packaging group 为主体；同一算法推导 bag count。 |
| 复核打开页面就重算历史 | 删除 `quoteHistoricalOrderItems`；历史读面测试禁止 quote import/call。 |
| 三段费用展示漂移 | 单一阶段金额 selector；十单三页面逐字符对照。 |
| 个人派工删除后越权报工 | 不按 workerId 匹配，但仍做 session 身份、固定工序岗位授权、事务锁和数量守卫。 |
| 新旧工资重复 | cutover 标记后二选一 ledger；旧记录只读，聚合 SQL 有互斥 contract test。 |
| 旧 pending task 已预分配、内部款缺 packaging group | 目标库先跑阻断式 preflight；无法唯一迁移就停，不删除 assignment、不猜袋数。 |
| 停用 claim/schedule/assign 逻辑时误伤返工或考勤 | 先把 `order:schedule`、`task:assign` 的剩余消费者迁到已有恰当权限并过权限矩阵；legacy permission code/row 保留，不做配置数据清理。 |
| 工价金额尚未提供 | DRAFT/null，不发布、不按 0；开发测试用隔离 fixture。 |
| 删除旧链后紧急回退 | 回滚到上一应用制品或 revert 独立 commit；不删除/覆盖 pricing revision 和工资 snapshot。受影响新单只能追加纠正 revision，不能改历史。 |

## 16. 第二阶段报告模板

确认并执行后生成 `REPORT-引擎切换.md`，至少包含：

1. 每个 commit hash 与功能块；
2. 已删除文件/共享片段/测试清单，以及最终零引用命令输出；
3. 全部既有配置 schema/行/legacy seed 段、已发布规则 hash、双 priceVersion 前后对比，以及 additive migration 审计；
4. `docs/加工费计费规则.md` 第 8 节 42 个 case 逐项结果和结构补充 fixture 结果；其中“虚构珠光艳闪 180g SKU”和“漏专版西封 +0.06/个”必须逐项贴出原 fixture/type/engine 的具体文件行号、修复 diff 和回归结果；
5. 旧实现与真值不一致的修复清单，并明确记录已撤销的两项旧误判：`40001 → 5万档` 与 `7001 → 1万档` 不得列为缺陷；
6. preview / submit / review / change / detail 的切换证据；
7. 10 张历史单逐单数据库与页面金额对照；
8. 新工序生成、纯彩印 only-PACKING、多人扫码、三类计件结果；
9. seed 留位、仍待提供的三项金额，以及一次性 v1 发布脚本的 dry-run/apply/idempotency 结果与完整 publication receipt；
10. 缺陷/返工计薪、PARTIAL 单位、PACKING 单位等本计划待拍板项采用的最终值；
11. 若执行中新出现未列明的疑似孤儿，附检索证据、默认保留并列残留，不擅自扩大删除。
