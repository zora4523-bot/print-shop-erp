# REPORT-引擎切换

> 执行基线：`Review@2c74f2c3f65b823b1f77a14a94e13284887033ff`
>
> 用户确认：2026-08-28，采用 `PLAN-引擎切换.md` 第 13 节默认值。
>
> 唯一计价真值：`docs/加工费计费规则.md`，SHA-256 `8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852`。它与 `/Users/zhixing/Downloads/加工费计费规则 (1).md` 逐字节相同。
>
> 最终验收时间：2026-08-29 00:48 CST；最终业务代码检查点：`b19c819`（本报告的文档提交在其后）。

## 1. 结论

代码切换已按功能块执行：销售前台独立报价/询价入口已移除；外部与内部建单、提交、工厂核价、变更申请和详情展示已收敛到同一纯函数计价契约；旧计算器与独立 action 已整块删除；人员匹配、候选推荐、手工排产/改派与抢单运行时已移除；新生产在价格确认后自动物化 `PARTIAL / FULL / PACKING` 工序，其他厂内工艺以无计件进度步骤作为完工闸口。免费重做单也按本次勾选的工艺生成工序，加工工艺留空时只生成入袋工序，不会凭空产生烫金计件。数据库现有 `SCHEDULING` 生命周期状态及页面的“排产中”历史语义没有被改表或破坏。

本报告区分“代码交付”与“生产环境启用”：代码可完成验收，但生产启用仍有两个 fail-closed 阻断项，不得绕过：

1. 三类计件工价与 `effectiveFrom` 未提供，因此只存在 DRAFT/null v1，没有 PUBLISHED 版本；报工计薪按要求拒绝兜底。
2. 本地库 13 张在途 legacy 工单的转换预检为 `0 convertible / 13 blocked`；没有猜测包装组、工艺或混合终态，也没有写转换数据。

另有一项受“规则配置零改动”红线约束的已存配置风险：截至最终验收，当前 PROCESSING v3 + LOGISTICS v2 仍可完整投影；但将于 `2026-08-29T09:59:00.000Z`（上海时间 17:59）生效的 PROCESSING v4 仅有 126 条旧结构规则，新适配器在该时点实测返回 `MISSING_RULE: 已发布加工费价目簿缺少局部烫金空白封单价`。本次未改、未撤销、未重发该价表，需由配置负责人在生效前另行处置。

## 2. 真值文档与已纠正定性

- `40001 → FULL_50000 / 0.1800` 是最新文档的正确边界，不是 fixture 缺陷。当前证据：`lib/price/__tests__/fixtures/create-order-golden-fixtures.ts:146`。
- `7001 → 10000 档 / 1520.00` 是文档第 9 节指定的当前默认，不是 fixture 缺陷。当前证据：`lib/price/__tests__/create-order-quote.test.ts:260`。
- “珠光艳闪 180g”虚构 SKU 已删除；180g 快递用例现使用真值存在的“红卡 180g / 大号封 / 0.1500”。当前 fixture 位于 `create-order-golden-fixtures.ts:281-286`，快递回归位于 `create-order-quote.test.ts:580-585`。
- 专版西封 `+0.0600/个` 已进入快照与独立明细行。快照位于 `create-order-golden-fixtures.ts:350`；`0.2800` 合成单价及 `300.00` 明细回归位于 `create-order-quote.test.ts:292-308`；缺行转人工的反例从 `create-order-quote.test.ts:364` 开始。

## 3. 主要提交

| commit | 功能块 |
|---|---|
| `48e14f2` | 锁定最新真值文档 hash 与经确认的执行计划 |
| `834bb05` | 移除销售前台独立报价/询价页与只读目录 DAL |
| `e8fc671` | 详情/列表金额统一选择 `settled → confirmed → quoted → legacy` |
| `b6181e9` | 人工核价录入点收敛到工厂确认 |
| `ae7ca6a` | 同步最新真值，完成第 8 节 fixture 与纯函数契约 |
| `d4a944c` | 新增版本化工序工价、report ledger、settlement 及 DRAFT seed |
| `a928704` | 新增已发布规则只读适配器，不改价表模型/数据 |
| `6f1fdf9` | 内部建单收敛为结构化事实 + 一个配置外备注 |
| `fb72b6d` | 工序物化与扫码报工运行时 |
| `fe6d13c` | 允许显式待定收费行，保留 null 语义 |
| `c57cbde` | 建单预览切换纯函数引擎 |
| `5622f59` | 工厂核价改为 snapshot-only，历史单不重算 |
| `1aee5c5` | 新 report ledger 不可变结算 |
| `869eb3e` | 成本口径按新/legacy generation 互斥读取 |
| `f7f3e99` | 配置发布校验与旧计算器解耦 |
| `f56c5f8` | 外部建单提交切换纯函数引擎 |
| `c53bc4f` | 内部建单提交切换纯函数引擎 |
| `b393125` | 工厂确认补齐待定收费与 `confirmedFee` 闭环 |
| `e72617d` | 结构化制版明细取代聚合行，防止重复收费 |
| `0f3b01e` | 变更申请切换纯函数引擎 |
| `674cf8f` | 移除人员匹配、手工排产、改派、抢单运行时，保留 legacy 兼容 |
| `f8eb0a6` | 删除旧对外/通用计算器与独立 action，不留双轨 |
| `f53c356` | 新增无计件生产进度 ledger，修正新旧 generation 完工判断 |
| `fff0ac0` | 集成无计件进度报工与完工级联 |
| `102390c` | 师傅端收敛为工序/进度报工及新结算门户 |
| `0c8e75a` | 管理端工资入口切换工序结算，旧日薪改为只读档案 |
| `2e13c5a` | 保持新结算表格的无障碍语义 |
| `e421471` | 保持师傅端原有“我的任务”导航契约 |
| `99313c8` | 在工单领域边界增加纯引擎回归 |
| `2606431` | 清理销售文档中已废止的独立报价话术 |
| `df6c403` | 补齐 PostgreSQL 结算 fixture 的真实枚举/列契约 |
| `6f2d173` | 首次工序物化时写入外协需求快照，保住新单完工闸口 |
| `f153bb0` | 将管理后台使用手册迁移到自动工序与扫码报工流程 |
| `d746410` | 免费重做单按本次工艺生成工序，包装数量改为 `ceil` 口径 |
| `5bdd91e` | 纯引擎快照持久化时补齐 legacy `version: 1` 兼容包装 |
| `6f0a331` | 迁移真实建单/通知/客服业绩 E2E，新增工序扫码报工 E2E |
| `1cba5d3` | 历史重做单复用/显式补录包装事实，支持仅入袋且写明零元快照 |
| `e43f0e6` | append-only 报工 E2E 强制使用独立 `E2E_DATABASE_URL` |
| `b19c819` | 补齐工单详情测试的重做包装提示契约 mock |

## 4. 已移除功能与引用证据

从执行基线到当前交付，按下列四个功能块共整删 44 个运行时文件和 38 个专属测试文件。共享流程测试只迁移已消失的输入/断言，没有为求全绿改弱现存契约。

### 4.1 销售前台询价

整删运行时：

- `app/(admin)/sales/quote/page.tsx`
- `app/(admin)/sales/quote/logistics/page.tsx`
- `components/business/price/ExternalSalesPriceBookCatalog.tsx`
- `components/business/price/ExternalSalesQuoteSectionNav.tsx`
- `components/business/price/external-price-display.ts`
- `lib/price/customer-price-book.ts`

整删专属测试：

- `ExternalSalesPriceBookCatalog.test.tsx`
- `ExternalSalesQuoteSectionNav.test.tsx`
- `customer-price-book.test.ts`

同步删除 `sales.quote` 与无实现的 `cs.quote` 菜单、breadcrumb、旧视觉 case 及已消失路径的 revalidate。配置中心的“报价产品”没有删除：它仍是建单纸张/规格结构化选项来源，不是销售询价页。

### 4.2 旧计价链

整删 11 个运行时文件：

- `actions/order-packaging-quote.ts` 及 `.types.ts`
- `actions/order-logistics-quote.ts` 及 `.types.ts`
- `actions/order-quote.ts` 及 `.types.ts`
- `lib/price/external-sales-quote.ts`
- `lib/price/quote-service.ts`
- `lib/price/quote.ts`
- `lib/price/order-packaging-quote.ts`
- `lib/order/create-order-quote-summary.ts`

整删 9 个专属测试：三个旧 action 测试，以及 `external-sales-quote` / `external-sales-processing-rule-v2` / `stock-local-foil-pricing` / `quote-service` / `quote` / `order-packaging-quote` 测试。`order-charge-service.ts` 只删除旧 preview 入口，建单持久化与发货终价能力保留，相关失败关闭测试迁到实际使用的 provisional/finalization 边界。

静态 import、动态 import/require、模块路径、action 符号、字符串路由表与测试 mock 终检索均为 0。

### 4.3 人员匹配与手工排产

整删 16 个运行时文件，包括两个 `/foreman/scheduling` 页面、`SchedulingForm`、`PendingSchedulingBoard`、`ReassignTaskForm`、`ClaimTaskButton`、`WorkerTaskBatchList`、`batch-scheduling`、`task-claim`、旧 `actions/production` 和旧 `lib/production`。随功能删除 19 个专属单元/E2E 测试。

保留：Prisma 历史 schema/migration、`ProductionTask`、旧工资/审计快照、历史任务展示、`OutsourceOrder`、工单图片/款式/包装/备注/时间线。`Craft` 页收窄为名称、编码、外协、排序、状态的工艺字典；匹配字段与已有值只作 legacy evidence，未 drop/未改写。

`ProductionTask` 没有新建、分配、改派或抢单写路径。唯一会更新 task 行的兼容路径是取消一张纯 legacy 工单：`lib/order.ts` 只把其尚未开工的 PENDING task 置为 CANCELLED 并清除旧抢单上下文，新 operation/progress 工单走另一分支。管理员仍可处理已存 pending 异议；worker 新建异议的 domain/action/component 因本计划未列入删除清单而保留，但当前历史任务详情未挂载其创建入口。异议写入仅修改相邻异议账本，不改 task，也不参与新工价或人员匹配。

上述是“生产应用运行时”结论。全仓仍有隔离的 load-test/E2E/视觉 fixture 写入 `ProductionTask`，以及永不重写的历史 migration；它们只生成受控测试数据或记录迁移证据，不是线上双轨 consumer。

### 4.4 旧机台计件与日薪写路径

整删 11 个运行时文件：`worker-piecework/page.tsx`、`WorkerPieceworkRulesPage`、`WorkerMachineRuleForm`、`AddSalaryAdjustmentForm`、`MarkPaidForm`、`RecomputeDailyForm`、`daily-salary-summary.ts`、`daily-recompute-impact.ts`、`daily-roster.ts`、`machine-piecework.ts`、`piecework-admin.ts`。`lib/salary/daily.ts` 仅保留历史查询；PACKER 退出考勤时薪聚合，CLEANER/COOK 等非本次范围的时薪工流程原样保留。

随功能删除 7 个专属测试：`piecework-business-language.test.tsx`、`RecomputeDailyForm.test.tsx`、`daily-salary-summary.test.ts`、`daily-recompute-impact.test.ts`、`daily-roster.test.ts`、`machine-piecework.test.ts`、`piecework-admin.test.ts`。

## 5. 新计价契约

- 纯函数输入：规范化工单事实 + PROCESSING/LOGISTICS 双版本价表快照。
- 输出：款级、包装组、订单级明细行，`knownTotal / total`，以及 typed `manualReasons[] / pendingReasons[]`。
- 缺失、空格、重复或冲突规则一律 `MANUAL_PRICING_REQUIRED`；不取旧版、相邻档或默认值。显式 0 元与 null 不同。
- 预览和提交均服务端重建 canonical facts，提交时再计算，客户端金额/版本不可信。
- 新纯引擎快照保留 `schemaVersion: 2` 业务结构，并在持久化 envelope 补齐数据库既有约束要求的 `version: 1`；这是存储兼容字段，不代表回退到旧计算器。
- 工厂核价只读已持久化 snapshot；人工金额与依据在确认环节录入，写 `confirmedFee` 与追加 revision，不覆盖 `quotedFee / settledFee`。
- 内部建单只保留一个配置外备注；不再提供创建时人工单价、一次性费用、人工改价说明、临时选项或动态扩展。
- 历史工单不调引擎；展示选择顺序为 `settledFee → confirmedFee → quotedFee → totalAmount`。

真实当前已发布快照投影成功：PROCESSING v3 + LOGISTICS v2，投影数量为 partial blank 26、full tiers 18、full paper surcharge 6、print 38、order charge 11。

## 6. 黄金用例与回归

`lib/price/__tests__/create-order-quote.test.ts` 实测 `89 / 89` 通过，其中第 8 节唯一 caseId 正好 42 个：

| 组 | 结果 |
|---|---:|
| 局部烫金 | 5 / 5 |
| 专版烫金 | 15 / 15 |
| 彩印 | 3 / 3 |
| 纸箱 | 11 / 11 |
| 快递 | 8 / 8 |

结构补充回归同时通过：西封、双色、浮雕/激凸、全部纸张加价、彩印单色烫金、空格/0 元、重复行、mixed packaging、双版本证据、触感纸方形/万元封 no-fallback、彩印覆膜转人工、150g 莱尼纹 6g/个。

额外联调测试：纯引擎、发布规则适配器、事实适配、展示、内外建单服务共 `9 files / 143 tests passed`；旧计算链删除相关保留流程回归共 `11 files / 139 tests passed`。

## 7. 新生产与计件口径

- `PARTIAL`：局部烫金，`PER_PASS`，合格完成数 × 正反面颜色过版数。
- `FULL`：专版烫金，`PER_PIECE`，合格完成个数。
- `PACKING`：所有订单线的包装组，`PER_BAG`，mixed 每包装组只计一次。纯彩印只生成 PACKING，不生成烫金计件。
- 三类工价唯一 key 是 operation type，不是人、机器、工单线或 Craft 匹配字段。
- 报工数来自 session 中本人账号；同一工序允许多人分次报工，不建立人员-工单匹配。
- 缺陷数与返工数保留质量事实，本期工资只使用合格 `completedQty`。
- GLUING/CLEANING/EMBOSS/BUMP 及其他 active in-house 工艺生成无单价/无金额/无价目簿的进度步骤，扫码记录以 append-only report 追加；外协仍走 `OutsourceOrder`。完工级联对新 generation 只检查 operation + progress + outsource，不读 legacy task。
- 工序首次物化同时从当时 Craft 事实写入 `Order.requiresOutsource` 不可重算快照；后续改工艺字典不会改写已投产工单，外协覆盖与完工闸口保持原契约。
- 免费重做单按本次实际勾选的工艺物化工序；未勾选烫金工艺时不生成 PARTIAL/FULL，只生成 PACKING/无计件进度。客户费用明确保存为 `confirmedFee = 0.00`、`quotedFee = null`、`settledFee = null`，而非用 null 冒充免费或让旧金额参与展示。
- 包装数量统一使用向上取整，例如 `1001 个 ÷ 100 个/袋 = 11 袋`。历史源单每个所选款恰好命中 1 个 canonical 包装组时严格复用；命中 0 个时先复用源明细已存 `pack`，连该事实也缺失才要求管理员显式补录；命中多个组则 fail-closed。快照/审计分别记录 `SOURCE_GROUP / SOURCE_ITEM_PACK / ADMIN_INPUT` 以及成员、每袋数和袋数，不覆写源单，也不允许客户端覆盖既有 canonical 事实。
- 新工序与 legacy 工资/成本只能 generation 二选一，不相加。

## 8. DRAFT seed 与发布闭环

当前数据库仅有一个计件价目簿 `cmtcv2zkt0000ye0rxb46fjtf`：v1 / DRAFT，三条规则是：

| operation | unit | amount |
|---|---|---:|
| PARTIAL | PER_PASS | null |
| FULL | PER_PIECE | null |
| PACKING | PER_BAG | null |

`pnpm piecework:publish-v1` 默认 dry-run 的实际结果：

- `readyToPublish: false`，`ruleSetSha256: null`；
- source SHA `9237dbbbb6ec92f9ccb8559888b030168964032a7fa9a7b6f1e81292f17d3810`；
- manifest SHA `b502450e477d5279ff65930bdb666c9e4de13a951dcb79ea7c63898f9190086c`；
- 缺失 `effectiveFrom`、PARTIAL/FULL/PACKING 三个 amount。

因为金额未提供，本次没有运行 `--apply`，没有 publication receipt，也没有以0元代替缺价。金额到位后由一次性脚本发布 v1，同 manifest 重跑幂等，不同金额/时间/hash 拒绝覆盖。

## 9. 配置零改动核对

7 个受保护 Prisma 模型片段的当前 SHA-256 与执行前一致：

| 模型 | SHA-256 |
|---|---|
| CustomerPriceBook | `e2f444af34957445f69dff6e3c21cec81f1c65eb55327c8b3ff588953950c2b1` |
| OrderPriceVersionLock | `a43ef9896b2207b11a597e6addb56b32822998e1771b9891446232ad93a3e02e` |
| CustomerChargeCategory | `c7349c7c1162ac5c6799dfdf52aeb8f545576ec5ccebf815415a2bf995e259d6` |
| CustomerPriceRule | `12945d23d60e65711049999752d78a1b7b35086f2259f5629ee9b8c2ae9b49a7` |
| Craft | `82e7f2dbdb725cedf71aaf8100872e22c0c6725931908c6e129b63756565f02b` |
| SalaryRule | `a05f84053ab4c2ad3875989bc6a4e972822b8f56be3f2de8a849960490ab7031` |
| Setting | `c8e98e8bd02a8a153ac9d6aca0d2c1b3b167a61629e87ca4d68ffbb3a835d704` |

受保护数据库行也逐类与 baseline 一致：

| 数据 | count | SHA-256 |
|---|---:|---|
| price books | 10 | `80360937e9d1cd2b171ee28612482bba336c46548b6d8d324d9ebe6d2219ad0a` |
| price rules | 939 | `c21ab994a7622cebebdfcf4af8859f862dd8c23f05298e14decdf746980bd242` |
| charge categories | 14 | `73a9d1fd68b1523bcb84efbdbbf922dbffb4014311ceee363ad70464155e52b1` |
| crafts | 18 | `ac3acfc8d37506125264d95ce7452cc7d0be09791b803768e6dc06230c759ec1` |
| salary rules | 12 | `9a3592ddb9ebb403319747508cfeb868d40c481e8b7e96b137b71bff626d42f1` |
| settings | 5 | `ce49415dbb89f3f0d0e74fa305399d54409b53654459b1e0bead35ae3424b49f` |

`prisma/seed.ts` 整文件 hash 因追加新 DRAFT 计件 seed 从 `53c9e42...` 变为 `cb678a02...`；`git diff 2c74f2c -- prisma/seed.ts` 显示只新增 placeholder import/调用/包装函数，原有配置中心 seed 段未改写。三个新 migration 只创建新计件/生产进度表与必要的订单收费 null 能力，未对 CustomerPrice*、Craft、SalaryRule、Setting 执行 DML。

## 10. 历史 10 单抽查

固定执行前 10 个 order id，再次只读查询，并实际调用当前 `selectOrderCustomerFee`：

| 工单 | 状态 | total / processing / packaging | quoted / confirmed / settled | 当前展示 |
|---|---|---|---|---|
| GD-260827-023 | FINISHED | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-019 | FINISHED | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-015 | FINISHED | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-014 | DRAFT | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-013 | DRAFT | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-011 | FINISHED | 183 / 180 / 10 | null / null / null | 183.00 LEGACY |
| GD-260827-001 | SUBMITTED | 406.3 / 360 / 20 | null / null / null | 406.30 LEGACY |
| GD-260825-001 | FINISHED | 1000 / 1000 / 0 | null / null / null | 1000.00 LEGACY |
| GD-260824-030 | FINISHED | 1000 / 1000 / 0 | null / null / null | 1000.00 LEGACY |
| GD-260824-029 | DRAFT | 1000 / 1000 / 0 | null / null / null | 1000.00 LEGACY |

上述字段与执行前基线逐项一致，展示选择均为 legacy `totalAmount`，没有调用计价引擎。

## 11. legacy 转换预检

只读 `preflightLegacyOperationConversion` 结果：

- scanned orders 13；active tasks 87；assigned active tasks 86；
- convertible 0；blocked 13；
- `NO_PACKAGING_GROUPS` 13 次；
- `PACKAGING_QUANTITY_MISMATCH` 32 次；
- `UNKNOWN_CRAFT` 2 次；
- `MIXED_LEGACY_TERMINAL_STATE` 4 次。

因此本次没有修改这些 legacy task/assignment，也没有伪造包装组或工艺映射。在任何生产环境发布前，必须对目标库重跑预检并清零阻断项。

## 12. 最终验证

### 12.1 自动化门禁

| 门禁 | 最终结果 |
|---|---|
| 全量 Vitest | `405 files passed / 4028 tests passed` |
| 第 8 节黄金用例 | `89 / 89`，其中 42 个唯一 caseId 全部通过 |
| Next 类型生成 / TypeScript | `pnpm exec next typegen`、`pnpm typecheck` 均通过 |
| ESLint / diff whitespace | `pnpm lint`、`git diff --check` 均通过 |
| 生产构建 | `pnpm build` 通过，生成 60 个静态页面；构建路由清单没有 `/sales/quote` |
| Prisma | `pnpm exec prisma validate` 通过；115 个 migration 全部已应用 |
| 关键 Playwright | 建单、紧急通知、客服业绩 3 项通过；append-only 报工 1 项按隔离策略跳过 |
| 销售响应式/无障碍 | `admin-1280x800` 目标用例 1 项通过 |

append-only 报工 E2E 只允许连接显式提供、且与普通 `DATABASE_URL` 实际主机/端口/库名不同的 `E2E_DATABASE_URL`，隔离模式默认使用 3100 端口且不复用普通开发服务。本机未提供独立 E2E PostgreSQL，所以该用例在打开数据库及写 fixture 前主动跳过；普通数据库的 production fixture 前后均为 `orders=0 / operations=0 / reports=0`。这不是功能断言跳过，而是防止测试污染真实/共享数据的安全门禁。

全量 Vitest 的第一次运行发现工单详情测试 mock 缺少新增的历史包装提示导出，修复 mock 契约后重新执行全量测试并取得上述最终结果；没有删除断言或降低断言强度。

### 12.2 缺陷修复清单

- 纠正 180g 虚构 SKU 与专版西封纸张加价遗漏，并以黄金 fixture 固化。
- 补齐纯引擎快照的既有数据库 envelope 版本字段，真实持久化不再触发约束失败。
- 把人工核价金额与说明的录入点落在工厂确认，待核价单可以形成 `confirmedFee`，建单表单不再承担人工改价。
- 修正包装袋数为 `ceil`，并覆盖 `1001 / 100 = 11` 的边界。
- 免费重做单改为真实生成工序；支持不选加工工艺的“仅入袋”重做，保留历史源单包装事实并显式写零元客户快照。
- 首次工序物化写入外协需求快照，避免工艺字典后续变化改变在制单完工闸口。
- append-only 报工 E2E 与普通数据库、普通开发服务彻底隔离，避免受控测试数据进入共享库。

### 12.3 UI 与现有流程抽查

- `/orders/new` 正常水合；报价产品、创建时人工单价/一次性费用/人工改价说明均已退出，配置外备注仍在，PARTIAL/FULL/PRINT 建单入口可用。
- `/owner/rules/crafts`、`/owner/salary/piecework` 与历史工单 `GD-260827-023` 均可正常打开；该历史单展示金额仍为 `183.00`。
- 关键销售响应式/无障碍用例通过。完整管理端视觉矩阵还会报告两个任务前已存在的非阻断 UI 债务：销售工单列表的 React list-key warning，以及产品结构配置页个别禁用标签/红色编辑链接对比度不足；本次没有借引擎切换改动这些无关 UI。

### 12.4 删除与数据不变性终检

- 销售报价精确路由、旧计算器模块/符号、人员匹配运行时、旧计薪写路径的静态/动态/字符串引用终检均为 0；`.next` route manifest 也没有 `sales/quote`。
- 7 个受保护 Prisma 模型片段、6 类现有配置数据的 count/hash 均与基线一致，详见第 9 节。
- 历史 10 单金额逐项未变，详见第 10 节；legacy 转换没有执行任何写入，详见第 11 节。

## 13. 已采用的默认值与残留

用户一次确认后已采用：PACKING 按袋、PARTIAL 按过版次数、单账号主工序授权、三类外工艺保留无计件进度、缺陷/返工不进本期计薪、7001–7999 暂按 1 万档、万元封局部烫金转人工、彩印非默认覆膜转人工、150g 莱尼纹按文档 6g/个。

仍需外部数据/配置动作，不是代码待拍板：

1. 提供 PARTIAL 元/次、FULL 元/个、PACKING 元/袋三个金额与 v1 `effectiveFrom`，审阅 manifest 后运行一次 `pnpm piecework:publish-v1 -- --apply`。
2. 清理目标库 legacy preflight 阻断项；阻断清零后仍需另行设计、审阅并执行转换事务，再关闭 legacy 取消/异议兼容面。本制品只包含只读 preflight，不伪称已有转换执行器。
3. 在 `2026-08-29 17:59 CST` 前由配置负责人修复或取消 PROCESSING v4。本任务不越过“现有规则配置零改动”红线。
4. 如需在本环境实际执行 append-only 报工 E2E，需提供独立 `E2E_DATABASE_URL` 并发布可用的三类测试工价；未满足时保持安全跳过。

目前没有剩余的业务口径待拍板；以上均是明确的外部数据、配置或环境动作。
