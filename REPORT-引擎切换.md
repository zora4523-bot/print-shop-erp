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
3. 如需在本环境实际执行 append-only 报工 E2E，需提供独立 `E2E_DATABASE_URL` 并发布可用的三类测试工价；未满足时保持安全跳过。

目前没有剩余的业务口径待拍板；以上均是明确的外部数据、配置或环境动作。

## 14. 专版5万档修复（2026-08-29）

用户后续明确授权对专版5万档进行定向配置修复，因此本节取代原第 13.3 项；授权范围仅为以下价格及保证其持续生效所必需的版本切换：

- `25,001–40,000`：中号组 `0.17`，大号组 `0.19`；
- `≥ 40,001`：中号组 `0.16`，大号组 `0.18`。

执行方式为新版本发布，没有原地改写已发布 v3：

1. 新建 migration `20260829013000_external_processing_five_tier`，从 `cpb_external_processing_rule_v3` 克隆 140 条规则。
2. 在新价簿 `cpb_external_processing_rule_v4_five_tier` 中，将 5 条旧末档收口为 `25,001–40,000`，新增 5 条 `40,001–9,999,999` 规则；最终共 145 条规则、50 条 `CUSTOM_BASE`。
3. 记录最新真值文档 SHA-256 `8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852`。
4. 旧计划版 `cpb_stock_local_foil_bef5f8d170b81d40ad1e338e` 没有任何版本锁或收费引用；迁移将其标记为停用但保留价簿、126 条规则及取代原因，避免它在 `2026-08-29 17:59 CST` 覆盖修复。
5. v3 的 140 条规则和 16 条历史 `OrderPriceVersionLock` 全部保持不变；只将 v3 的半开生效区间截止在新版本生效时刻。

真实已发布快照验证：

| 时点 | 选中加工费版本 | 40,001 个中号 | 40,001 个大号 |
|---|---|---:|---:|
| 迁移后当前时刻 | 修复 v4 | `0.16` / `6400.16` | `0.18` / `7200.18` |
| 原计划切换点 `17:59` | 修复 v4 | `0.16` / `6400.16` | `0.18` / `7200.18` |
| 切换点后 `18:00` | 修复 v4 | `0.16` / `6400.16` | `0.18` / `7200.18` |

新增回归覆盖中/大号的 `40,000`/`40,001`/`100,000` 边界、隔离 PostgreSQL 迁移、历史 v3 不变、真实发布 adapter 投影及原 `17:59` 时间边界。专版配置页已显示“当前 v4”和完整 10 档；新建工单页正常水合与计价，未修改 UI 组件。

修复后门禁：定向 4 文件 `102 / 102`，全量 Vitest `407 files / 4039 tests`，TypeScript、ESLint、Prisma validate/migrate status 全部通过，管理端六个价格业务编辑器 Playwright 用例 `1 / 1` 通过。数据库现为 116 个 migration 全部已应用。

## 15. 配置中心后续审查与修复（2026-08-29）

本轮针对价格配置页、价格版本生命周期和建单收费链继续审查。除第 14 节已经单独授权并发布的专版 5 万档 v4 外，本节所有提交均只改运行时代码、校验、展示和测试；`git diff 77fc2f4^..891c327 -- prisma/schema.prisma prisma/seed.ts prisma/migrations scripts` 结果为空，没有改 schema、seed、migration、脚本或任何已发布价表数据。

### 15.1 审查结论

- “审阅价格版本变更”不是旧配置文件入口。它读取同一套 `CustomerPriceBook` 版本记录和发布快照，用于查看当前、预约、已取消及历史版本。
- 已发布的 CURRENT 版本和等待生效的 SCHEDULED 版本仍然只读，这是防止已发布快照被原地改写的正确约束，不是表格失效。改价仍应创建并编辑 DRAFT，再经审阅发布。
- 原缺陷在于已有 SCHEDULED 版本时只有等待、没有安全撤销或改期出口，导致无法继续发起正确调价。本轮补齐“取消预约”和“调整生效时间”；操作仅对 SCHEDULED 显示，要求原因、L3/三级确认和 `updatedAt` 乐观锁，并在事务内检查历史引用、前后继生效区间及真实引擎投影。已取消版本保留审计证据，不物理删除。
- “报价产品”不是已删除的销售询价功能残留。其运行时实际用途是建单产品目录：为新建工单提供纸张、克重、规格、产品结构和计价组的规范选项，并参与服务端 canonical facts 匹配。因此保留路由和数据模型；导航、页面标题、内部阶梯表单、BOM、分类表以及用户可见校验提示统一改称“建单产品/建单产品目录”。旧称只保留在历史决策记录和“旧字段不得重新出现”的负向测试中。
- “工艺参数”也不是无引用旧页。它是建单工艺目录，仍被内外建单选项、工艺识别、外协标记和历史工单展示读取。因此同样保留并改名为“建单工艺目录”；没有恢复人员匹配、产能排程或旧计薪逻辑。

### 15.2 已修复清单与独立提交

| 提交 | 修复内容 | 结果 |
|---|---|---|
| `77fc2f4` | 物流草稿校验与真实发布适配器对齐 | 中通省份、纸箱计费模式、阶梯起点/连续性和 5000 上界按实际规则校验；当前物流 v3 的 11 条规则可通过 |
| `17f38f9` | 发布前接入真实建单引擎投影 | PROCESSING/LOGISTICS 候选版本会与其生效时点的另一价簿组成完整快照并投影；失败在任何写入前阻断，不再只做结构校验 |
| `6e53518` | 制版费待核价生产阻断 | 内外建单统一写入 canonical 待核价收费项；总价保持 null、已知合计保留，工厂确认金额前不激活生产，确认后同事务写 `confirmedFee` 并激活 |
| `c1a6dac` | 澄清产品/工艺目录真实职责 | 保留所有有效 consumer，只改业务命名和说明；导航、metadata、页面与测试同步 |
| `0cc6c97` | 多价簿区块保存原子化 | 一个 action、一次鉴权、一个事务和一把写锁；全部价簿预检后才写，任一本失败则整组零写入 |
| `a43ddc6` | 补出彩印 3 万档编辑列 | 彩印矩阵新增 `Q30000 / 3万` 列，已有 3 万档规则不再只能通过底层数据存在而在 UI 隐身；仍只允许在 DRAFT 中编辑 |
| `89c896e` | 预约价簿取消/改期闭环 | 支持 SCHEDULED 安全取消和改期，保留 CANCELLED/RESCHEDULED 原因、时间和审计；检查直接收费、规则来源和工单版本锁引用，并校验受影响时间边界 |
| `3973286` | 物流极端金额上限校验与运行时取整一致 | 最大重量下的续重次数改用与真实收费相同的 `ceil`，补充一个旧 `floor` 会错误放行、运行时会超限的区分性边界测试 |
| `891c327` | 统一建单产品术语 | 清除当前运行时“报价产品/报价 SKU”旧称，保留所有实体、路由、`productId` 和匹配逻辑；同步更新文案契约、E2E/视觉定位，不削弱“旧产品下拉不得出现”的负向断言 |

第 14 节的 `0f3b935` 已按用户确认把专版 5 万以上发布为：中号组 `0.16`、大号组 `0.18`；当前及原预约切换时点的真实投影均固定命中新 v4，不会再被旧计划版本覆盖。

### 15.3 UI 与版本语义

- 价格格子能否编辑由价簿状态决定：DRAFT 可点格子修改，CURRENT/SCHEDULED/HISTORICAL/CANCELLED 只读。继续保留这条边界，避免修改已被工单锁定的价格快照。
- 若页面存在预约版本，应先在版本页改期或取消；取消后才可按正常流程新建下一版草稿。系统不会把预约版降级成可编辑草稿，也不会原地覆盖。
- 空白格继续表示“转人工”，与 `0` 元严格区分；本轮没有把不存在的组合自动补成 0，也没有增加配置外动态选项。
- 当前数据库在第 14 节修复后没有仍待生效的错误预约版本，因此最终只读环境没有执行取消/改期写操作；条件展示和事务行为由组件、action、域层及 PostgreSQL 投影测试覆盖。

### 15.4 最终验证

| 门禁 | 结果 |
|---|---|
| 全量 Vitest | `407 files passed / 4064 tests passed` |
| TypeScript | `pnpm typecheck` 通过 |
| ESLint / whitespace | `pnpm lint`、`git diff --check` 通过 |
| 生产构建 | `pnpm build` 通过，60 个静态页面生成完成；建单、价格配置、价格版本、产品目录和工艺目录路由均在产物中 |
| Prisma | schema validate 通过；116 个 migration 全部已应用 |
| 受保护配置边界 | 本轮 9 个提交对 schema、seed、migration、scripts 的路径 diff 为 0；本次最终只读审计没有执行价表或历史工单数据写入 |
| 开发服务 | `http://localhost:3000/login` 返回 200；受保护管理页未带登录态访问时按预期 307 跳转登录 |

最终尝试复核当前应用内浏览器登录态页面时，被宿主的 localhost 浏览器 URL 安全策略拒绝；没有绕过该策略，也没有为了制造截图而修改数据。相关 UI 由全量组件测试、既有价格编辑器 Playwright 回归和生产构建覆盖。该限制属于本次验证环境，不是应用返回的页面错误。

### 15.5 保留边界

- 当前/已发布价格只读仍是预期行为；若直接允许点击修改，反而会破坏 `priceVersion` 快照语义。
- 产品目录和工艺目录均有活跃建单 consumer，不能按“旧报价页”整删；本轮全仓引用审查后明确保留。
- 本轮没有恢复销售询价入口、旧报价引擎、人员-工单匹配、产能排程或配置外动态扩展，也没有改变历史工单金额展示顺序。

## 16. 价格工作台交互精简（2026-08-29）

提交 `d8ecd01` 按后续审查结论精简价格配置页，仅修改展示、调价入口及其测试；没有修改配置中心数据模型、已发布价表、`priceVersion` 快照、计价引擎、工单 UI、schema、seed、migration 或脚本，也没有提交任何调价表单。

### 16.1 已修复

- CURRENT 正常态不再重复显示大块“价格状态 / 当前生效 / 发起调价”卡片；当前版本仍由顶部版本条显示，调价入口移到业务标题右侧。
- 当前生效价由伪输入框改为普通只读文本；`0`、空格“— 转人工”和末档 `∞` 的显示语义保持不变。只有 DRAFT 中真正可编辑的字段才渲染数字输入框。
- 无草稿时不再显示不可点击的灰色“发布”占位；存在草稿时原审阅、校验和发布入口保持不变。
- DRAFT 仍显示版本、未发布数量、原因、保存时间、审阅和发布工作条；SCHEDULED 与 UNAVAILABLE 仍显示紧凑且明确的阻断原因，没有把异常状态误装成 CURRENT。
- 包装与快递页将两个来源明确拆成“调整物流费”和“调整入袋费”，URL 使用 `start=1&purpose=logistics|processing`，一次只允许打开指定来源。
- 调价创建表单改为 portal dialog，避免与已有草稿保存表单嵌套，也避免另一来源已有草稿时表单落在长表底部。弹窗打开后焦点自动进入“调价原因”，背景不可编辑；关闭后清理 query 并回到只读页。
- 两个来源同时有草稿时，状态区域使用不同的可访问名称；标题入口使用 `aria-expanded`、`aria-controls` 和 dialog 语义，触控高度统一为 44px。

### 16.2 验证

| 门禁 | 结果 |
|---|---|
| 定向组件与页面测试 | 6 个文件、59 项通过，覆盖 CURRENT/DRAFT/SCHEDULED/UNAVAILABLE、双来源 query、只读值、弹窗表单及无嵌套表单 |
| 全量 Vitest | `408 files passed / 4071 tests passed` |
| TypeScript / ESLint / whitespace | `pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过 |
| 生产构建 | `pnpm build` 通过，60 个静态页面生成完成 |
| Prisma | schema validate 通过；116 个 migration 全部已应用 |
| 浏览器验收 | CURRENT 无重复状态卡、无数字输入框及无效发布占位；物流/入袋双入口可见，一次只打开一个对应弹窗；焦点、关闭与 URL 恢复正常 |
| 开发服务 | 最终已重新启动在 `http://localhost:3000`，`/login` 返回 200 |

最终受保护路径检查对 `prisma/schema.prisma`、`prisma/seed.ts`、`prisma/migrations`、`scripts`、工单页面及建单/计价模块均无差异。本轮浏览器操作只打开和关闭调价界面，没有填写或提交数据。

## 17. 调价输入状态告警修复（2026-08-29）

用户提供的控制台信息为 Base UI `FieldControl` 的非受控 `defaultValue` 变化告警，不是调价事务失败。实际页面已显示调价草稿 v5、1 处未发布改动，且“珠光闪红 160g · 大号封”的 `0.8` 仍在，说明创建草稿与价格保存均已成功。

### 17.1 根因与修复

- 草稿数字格是非受控 Base UI Input。用户修改价格后，Server Action 重新校验页面；同一行列位置的客户端实例被复用，但服务端传回的 `defaultValue` 已从旧值变为新值，Base UI 因此正确报警，而 DOM 还可能停在旧默认值。
- 数字格现在按“字段 id + 已持久化值”设置稳定 key。保存成功且值真正变化时，只重挂发生变化的那一格；其他未保存输入不会被清空，校验失败时也保留用户尝试值。
- 创建草稿成功后，服务端重新校验可能先于弹窗内的成功 effect 卸载表单，使 URL 残留 `start=1&purpose=...`。现在对“query 要求开弹窗、但该来源已有草稿/不可创建”的状态进行客户端地址收敛，不重开表单，也不改动价格数据。

### 17.2 回归门禁

| 门禁 | 结果 |
|---|---|
| 新增 Chromium 生命周期回归 | `1 / 1` 通过；同一价格格从 `0.12` 重渲染为 `0.13`，最终 DOM 值为 `0.13`，Base UI 告警为 0 |
| 定向组件/页面测试 | 3 个文件、20 项通过，含已失效弹窗 query 收敛 |
| 全量 Vitest | `408 files passed / 4072 tests passed` |
| TypeScript / ESLint / whitespace | `pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过 |
| 生产构建 | `pnpm build` 通过，60 个静态页面生成完成 |
| 真实开发页冷加载 | 残留地址自动收敛为 `?section=blank`；草稿 v5 和 `0.8` 仍正常显示；控制台 `error/warn = 0` |
| 开发服务 | `http://localhost:3000/login` 返回 200 |

本轮未提交价格表单，未修改已发布价表、`priceVersion` 快照、计价引擎、工单 UI、Prisma schema/seed/migration 或历史工单。

## 18. 价格版本发布流程精简与安全修复（2026-08-29）

提交 `53a1d4f` 根据价格版本页审查结果完成修复。价格格保存仍只写 DRAFT；本轮没有把已发布版本改成可编辑，也没有改变 `CustomerPriceBook` 数据模型、半开生效窗口、`priceVersion` 锁或历史工单金额快照。

### 18.1 已修复

- 普通发布改为默认“立即生效”。浏览器不再强制选择分钟级时间；服务端在取得价格写锁后采样同一个 canonical instant，并用于当前版本选择、候选投影、旧版 `effectiveTo`、新版 `effectiveFrom`、发布 workflow 和审计。预约生效仍作为折叠的可选高级操作兼容。
- 创建草稿时的调价原因成为默认发布说明；管理员只在需要时补充第二段说明。发布界面合并为一次影响审阅和一个明确提交按钮，移除“进入确认 → checkbox → 再确认”的重复门槛。
- 预览与最终发布都使用规范化规则集 SHA-256 阻止零差异版本；预览的 PASS 现在包含真实建单双价簿候选投影，最终事务在任何版本窗口写入前重复投影。
- 发布摘要分别展示“业务收费项目数、变更规则数、全表校验规则数”，不再把不同口径拼成 `1 / 145`；生效方式会真实显示“立即生效”或具体预约时间。
- 删除旧工作台 `?item=...#selected-charge-detail` 深链。发布差异和校验问题使用持久化规则身份映射到 `blank / machine / tiers / adds / print / ship`，目标页只接受安全规则 ID，并只在该 ID 能解析到真实草稿输入时滚动聚焦；未知规则不猜板块、不生成误导链接。
- 价格版本页不再显示指向自身的顶部“审阅/发布”按钮；选中草稿时完整历史默认折叠。历史按价目谱系分组和排序，但不向业务页面暴露内部 code。
- 修复旧计划状态：带 `superseded*` 证据的旧 v4，以及停用且生效时刻仍在未来的旧 v2，均显示为 `CANCELLED / 已取消`，不再冒充普通历史生效版本。
- 顶部版本摘要随价格工作区 URL 变化重新读取，发布后不会继续保留陈旧的“草稿 v5”客户端状态。

### 18.2 验证

| 门禁 | 结果 |
|---|---|
| 后端独立安全复核 | 锁后时钟、零差异 hash、读锁先于候选投影、预约兼容及旧计划状态全部通过；后端定向 `84 / 84` |
| 定向发布/页面回归 | 8 个文件、`145 / 145` 通过 |
| 全量 Vitest | `409 files passed / 4094 tests passed` |
| Chromium 组件回归 | `1 / 1` 通过 |
| TypeScript / ESLint / whitespace | `pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过 |
| 生产构建 | `pnpm build` 通过，60 个静态页面生成完成；价格版本、客户计价和新建工单路由均在产物中 |
| Prisma | schema validate 通过；116 个 migration 全部已应用 |
| 真实发布页只读验收 | 当前 v5 为 1 个收费项目 / 1 条规则、145 条全表规则校验通过；默认立即生效，预约时间和补充说明均非必填；控制台 `error/warn = 0` |
| 深链与历史验收 | “珠光闪红 160g · 大号封”返回 `section=blank` 并聚焦真实 `0.13` 输入；旧 v2/v4 均显示“已取消”；页面未显示内部 code |
| 工单 UI 只读验收 | `/orders/new` 正常显示工单、工艺、材料、数量与包装、文件、收货、费用等主要区域；控制台 `error/warn = 0` |
| 开发服务 | `http://localhost:3000/login` 返回 200 |

### 18.3 保留边界

- 当前浏览器中的 v5 草稿仍保留用户录入的 `0.8`，本轮没有点击“确认并立即发布”、没有填写预约时间，也没有提交、放弃或改写任何价表数据。
- `git diff 53a1d4f^..53a1d4f -- prisma/schema.prisma prisma/seed.ts prisma/migrations scripts app/'(admin)'/orders components/business/order lib/order.ts lib/order` 为空；工单 UI、建单计价引擎、schema、seed、migration、脚本和已发布价表零改动。
- 预约、取消、改期和历史状态仍保持底层兼容；精简发生在默认交互和安全门禁，不删除版本证据。
