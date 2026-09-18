---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# 数据库指南

## 2026-09-13 工价后继版本迁移

`20260914000000_piecework_successor_publication` 允许以同一事务发布的连续后继工价关闭旧开放有效期；约束禁止改费率、发布证据、已关闭有效期及既有报工归属时间。延迟约束触发器要求下一版本已经发布且有效期精确衔接。人工建单价和拆址重价复用既有金额、快照及价格修订列，不增加订单字段。迁移与验证见 [修复记录](./docs/管理员建单定价与装盒修复-20260913.md)。

本文描述仓库中的 PostgreSQL / Prisma 契约。Schema 的唯一事实源是
[`prisma/schema.prisma`](./prisma/schema.prisma)，迁移历史的唯一事实源是
[`prisma/migrations/`](./prisma/migrations/)。任何文档里的数字都不能替代目标数据库上的 `prisma migrate status`。

## 包装类型增量（2026-09-13 局部核对）

新增迁移 `20260913140000_order_packaging_types`、`20260913140100_packaging_constraints`、`20260913140200_box_piecework_unit`，不回写历史记录。包装模式扩展为入袋、不包装及两种盒型的常规/混装；`CustomerPriceCalculationType` 和 `PieceworkRateUnit` 增加 `PER_BOX`。

不包装约束：`actualBagCount=0`、`unitPrice=0`、`subtotal=0`，建议小计为 0 或空；其余模式实际包装数量必须为正。常规装盒只含一款，混装至少两款。已有数据库列名 `actualBagCount` / `unitsPerBag` 保留兼容，新类型按袋/盒语义解释。

打包生产工序支持 `PER_BAG` / `PER_BOX`；不包装不物化打包工序。工资规则唯一键变为 `(priceBookId, operationType, unit)`；原发布约束要求三条基础规则；`20260917190000_optional_unified_packing_rates` 将统一工价调整为必需局部、专版两条规则，入袋和装盒各自选填。缺少对应包装工价时暂停该类计件报工，不按零元计算。个人包装工价的入袋必填约束、已发布规则及历史快照保护保持不变。没有装盒工价时不套用入袋工价。客户报价与工资本仍独立。

空盒及装盒费写入新加工费价目版本，不修改已发布规则或旧工单快照。安装步骤见 [包装类型实施记录](./docs/包装类型实施-20260913.md)。

## 技术基线

- PostgreSQL；开发与生产拓扑见 [DEVELOPMENT.md](./DEVELOPMENT.md) 和 [DEPLOYMENT.md](./DEPLOYMENT.md)。
- Prisma 7.7.0，使用 `prisma-client` generator，生成目录为 `generated/prisma/`。
- Prisma CLI 从 [`prisma.config.ts`](./prisma.config.ts) 读取 `DATABASE_URL`。
- 运行时 [`lib/db.ts`](./lib/db.ts) 通过 `@prisma/adapter-pg` 创建 client，并在非生产热更新中复用单例。
- 截至 `last_verified`，仓库有 83 个 migration 目录，最后一项是
  `20260822112100_create_notification_log_query_index`。这是仓库快照，不声明任何生产数据库已应用到该位置。

## 领域模型分组

Schema 中的模型按以下业务域组织；字段、关系、索引和约束仍以 schema 与 migration SQL 为准。

| 领域 | 代表模型 |
|---|---|
| 账号与审计 | `User`、`LoginRateLimitBucket`、`BusinessAuditLog` |
| 客商与主数据 | `Party`、`PartyContact`、`PartyAddress`、`Craft`、`Product`、`ProductCategoryNode` |
| 工单 | `Order`、`OrderItem`、`OrderChangeRequest`、`OrderShipment`、`OrderLog` |
| 设计与导出 | `OrderItemDesign`、`DesignBundle`、`OrderExport` |
| 生产与外协 | `ProductionTask`、`OutsourceOrder`、`OutsourceOrderItemSnapshot`、`OutsourcePayment` |
| 定价 | `PriceTier`、`PriceAdjustment`、`CustomerPriceBook`、`CustomerPriceRule`、`OrderCustomerCharge` |
| BOM、库存与采购 | `BillOfMaterial`、`Material`、`Warehouse`、`MaterialLocationStock`、`MaterialTransaction`、`InventoryCount`、`PurchaseOrder`、`PurchaseReceipt` |
| 薪资与考勤 | `SalaryRule`、`WorkerMachineSalaryRule`、`DailyWorkerSalary`、`SalaryPeriod`、`CustomerServiceCommission`、`HourlyWorkerPayroll`、`Attendance` |
| 账单与成本 | `Bill`、`BillPayment`、`BillItem`、`OrderCostEntry` |
| 通知与任务 | `NotificationChannel`、`NotificationRule`、`NotificationLog`、`BackgroundJob`、`BackgroundJobAttempt`、`BackgroundWorkerHeartbeat` |
| 系统配置 | `Setting`、业务编号序列模型 |

## 数据类型与历史正确性

- 金额、单价、比例、库存和工时使用带明确 scale 的 `Decimal`。应用层不得先转为 JavaScript `number` 再做最终财务计算。
- 业务日期可能使用 `@db.Date`，事件时间使用 `DateTime`。涉及“今天、昨天、上月”的逻辑使用上海业务日历 helper，不依赖主机时区。
- 设计文件大小和导出字节数使用 `BigInt`；序列化到 JSON 前必须显式转换。
- 可变规则对应的历史记录保存 JSON 快照，例如工单定价、生产计件和薪资规则。修改规则不得回写已生成的历史快照。
- 状态字段、唯一索引、幂等键、账本和审计字段共同构成业务正确性；不能把数据库约束当作可选性能优化。

## 本地初始化

只对新建、专用的开发数据库执行：

```bash
cp .env.example .env
# 在 .env 中设置指向开发库的 DATABASE_URL；不要复用生产连接串。
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm db:seed
```

Seed 行为由 [`prisma/seed.ts`](./prisma/seed.ts) 定义：

- 空库且没有活跃管理员时，使用 `SEED_ADMIN_USERNAME`；
- 配置 `SEED_ADMIN_PASSWORD` 时使用该密码；未配置时打印一次性随机密码；
- 已存在活跃管理员时不会静默创建第二位管理员；
- 非管理员用户名冲突时拒绝静默提权；
- 不要把 seed 输出写入共享日志，首次登录后更换初始密码。

Seed 不是通用发布后修复脚本。生产首次部署后的变更走 migration 或经过审查的运维步骤。

### 工作台与响应式测试数据隔离

以下行为于 2026-09-07 针对测试 helper 核对，不改变正式 seed 或数据库迁移规则。

如需在已有空工单链接中演示完整编辑界面，可按
[本地补全步骤](./DEVELOPMENT.md#补齐工作台演示工单) 单独运行测试补全脚本。
脚本在取得工单锁后重新校验归属及全部业务关联，先保存主记录备份，再原子补入明细和报价；
任一款计价不完整或金额/分货不守恒会整批回滚。它不修改已有价格历史、账号、已完成工单或正式 seed，
已补齐工单也不会再次覆盖。备份用于核对原始资料；已有不可变报价不能通过删除快照回退，应保留测试审计记录。

- [`seedDashboardSnapshot`](./tests/e2e/_helpers.ts) 每次运行生成独立的 `e2e-dash-<runId>` 命名空间，只追加本轮测试所需的数据。销售与客服 fixture 从角色匹配的 `e2e-*` 来源账号创建独立、停用的用户；不能借此克隆真实账号或产生可登录的新账号。
- 工作台 fixture 的用户、工单、账单、外协、周期和可选图表数据在同一事务中写入；任一步失败则整体回滚。重试创建新的命名空间，不删除或重写既有工单、账本、工资支付、价格快照或共享账号的历史记录。
- 测试应在完整关注列表中按本轮返回的记录 ID 查找，必要时翻页；不能为了使待办总数或第一屏顺序固定而清空历史数据。追加的数据随专用、可丢弃测试数据库的生命周期管理，不把该 helper 当作共享开发库的数据清理工具。
- [`worker-ui-fixture.ts`](./tests/visual/worker-ui-fixture.ts) 为每个视口命名空间创建独立、停用的客服用户，避免争用同一客服只能有一个进行中周期的约束。客服展示周期使用 `2098-01-01` 至 `2098-04-30`，工单展示交期使用 `2099-12-31`，使展示 fixture 不进入当前临近结算、过期结算或交期提醒窗口。
- 响应式 fixture 的工资日期也放在 2098 年。客服展示业绩使用期初金额，不伪造业绩事件账本；重建时只按该命名空间的明确 ID 清理自有数据，不按共享用户或全表删除。若自有记录出现新的账本引用，应检查引用与测试生命周期，不绕过外键约束。

工作台追加隔离与事务失败回滚由
[`dashboard-fixture-isolation.test.ts`](./tests/regression/dashboard-fixture-isolation.test.ts)
守卫。以上规则只描述这两类 fixture，不授权其他测试 helper 清理共享历史数据。

## 创建迁移

```bash
pnpm db:migrate -- --name <descriptive_name>
pnpm exec prisma generate
pnpm exec prisma migrate status
```

提交前必须审查生成 SQL：

- 是否持有长时间表锁；
- 是否为 `NOT NULL`、唯一约束或类型转换提供了可证明的数据前置条件；
- 数据回填是否确定、可审计且不会猜测业务语义；
- migration 是事务内原子操作，还是可能留下中间对象；
- `CREATE INDEX CONCURRENTLY` 失败后是否可能留下 `INVALID` 索引；
- Prisma schema 与数据库触发器、视图、表达式索引等手写 SQL 是否保持一致。

不要编辑已被共享环境应用的历史 migration。修复使用新的前向 migration。

## Fresh database 验证

发布候选必须在 DBA 明确提供的全新、空白、可丢弃数据库上验证完整迁移链。先人工确认连接目标；不要把 drop/reset 命令写入通用脚本。

```bash
DATABASE_URL="$FRESH_DATABASE_URL" pnpm exec prisma migrate deploy
DATABASE_URL="$FRESH_DATABASE_URL" pnpm exec prisma migrate status
DATABASE_URL="$FRESH_DATABASE_URL" pnpm db:seed
```

仓库还提供一个不会创建或删除数据库的完整迁移链门禁。它会先拒绝非空库，再运行
`migrate deploy` / `migrate status` 并检查关键版本后置条件：

```bash
FRESH_DATABASE_URL="$FRESH_DATABASE_URL" \
FRESH_DATABASE_CONFIRM_DATABASE="<database-name>" \
pnpm test:migrations:fresh
```

该命令不会自动 seed、drop 或 reset；数据库生命周期仍由 DBA 在命令外管理。

随后运行与本次 migration 相关的写路径、约束和 E2E。仓库 migration 数量会增长，门禁应通过目录和 `migrate status` 动态确认，不把某个旧数字长期复制在多份文档中。

## 扩展与降级

迁移使用或探测的扩展包括 PostgreSQL contrib 与 Pigsty 可选扩展。实际可用性必须在目标数据库检查：

| 类别 | 示例 | 行为 |
|---|---|---|
| 基础/强依赖 | `citext`、`pg_trgm`、`btree_gist`、`ltree` | migration 直接创建或使用；缺失可能阻断迁移 |
| 可选增强 | `pg_bigm`、`pg_pinyin`、`pg_ivm`、`pg_partman`、`pg_jsonschema` | migration 在不可用时采用已编码的降级或 readiness 状态 |
| 可观测/安全准备 | `pg_stat_statements`、`pgaudit`、`anon`、`index_advisor` | 按可用性与 runbook 激活，不等于仓库声明生产已启用 |

数据库 HTTP 调度用的 `pg_cron + pg_net` 已退役；当前调度事实见
[`deploy/crontab.example`](./deploy/crontab.example)。Pigsty 扩展激活见
[`docs/pigsty-production-activation-runbook.md`](./docs/pigsty-production-activation-runbook.md)。

## 生产迁移与恢复

- 生产只运行 `pnpm exec prisma migrate deploy`，不运行 `migrate dev`、`db push` 或 `migrate reset`。
- 发布前完成备份就绪检查、批次前置检查和 fresh DB 验证。
- 进入迁移停机窗口后发生失败，保持 Web 与 worker 停止，按 migration 类型诊断并做前向修复。
- 不允许只 checkout 旧代码后连接已迁移数据库继续写。
- 只有经过批准、与旧代码版本匹配的整库备份恢复，才构成真正的数据库回退。

详细步骤不要从本文拼接执行，统一使用 [DEPLOYMENT.md](./DEPLOYMENT.md) 指向的部署 runbook。

## 安全检查

- `.env` 不进 Git；输出或截图中隐藏连接串和密码。
- 开发、E2E、fresh DB 和生产使用不同数据库身份与连接串。
- 运行迁移、seed、Studio 或测试前先确认 `DATABASE_URL` 的 host、database 和 user。
- 不把生产数据复制到本地；需要诊断时使用最小、脱敏、经授权的数据集。
- 不向 UI 返回内部数据库错误、约束名或 SQL。

## 常用诊断

```bash
pnpm exec prisma validate
pnpm exec prisma migrate status
pnpm exec prisma generate
pnpm db:studio
```

错误处理见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。


## 2026-09-08：工单改版生产承接量

迁移 `20260908003000_order_version_carryover` 为 `ProductionOperation` 增加
`carriedCompletedQty`（合格件/袋数）、`carriedWorkOrderProgressQty`（工单独立件数），
为 `ProductionProgressStep` 增加 `carriedCompletedQty`。历史行默认 0，历史报工、工资和结算不回填、不改写。

承接量仅在生成新版工序时保存，上代承接量加上上代实际新增报工形成新基数；不生成虚构报工。
字段受非负、计划上限与不可更新触发器保护；工单件数触发器将当前版本的承接量加入累计上限。
业务事务仍持有工单 advisory lock，并核对来源映射和分款减量歧义。

已应用迁移保持原样。此次 `migrate dev --create-only` 的 shadow replay 被历史并发索引迁移阻断，
因此使用 HEAD schema 到当前 schema 的 `prisma migrate diff --script` 生成加列 SQL，再加入约束。
随后在专用库、本地开发库部署，并在新建空库通过完整 `verify-fresh-migrations.mjs` 检查。
已部署 SQL 原文含一个末尾空行，`git diff --check` 会提示 `new blank line at EOF`；为保持已应用迁移的校验和，不再改写该文件。其余任务文件通过格式检查。

### 发货登记与面单（2026-09-11）

前向迁移 `20260911110000_shipment_registration` 为 `OrderShipment` 新增 `carrierName` 和 `registrationVersion`；新增 `OrderShipmentLabel` 保存归一化 JPEG 字节、地址关联、登记人及时间。单图上限 512 KiB（应用与数据库 CHECK 双重限制），替换追加新记录，不覆盖旧图片。选择数据库私有存储是为了让小型面单凭证和业务提交原子落库，避免上传成功但登记失败的孤儿文件；备份容量需包含图片历史，长期大批量使用时可迁移到受控对象存储。

该迁移仅新增列和表，无历史状态或金额回填。已在本地开发库应用；独立 `erp_shipping_verify_20260911` 空库完整验证 141 个迁移及后置条件。`migrate dev --create-only` 遇到既有并发索引不能在 shadow 事务运行，因此使用 Prisma schema diff 生成新增 SQL、审查后 migrate deploy；没有修改既有迁移。

## 手工出入库请求幂等（2026-09-11 局部核对）

前向迁移 `20260911040000_manual_material_request_idempotency` 为 `MaterialTransaction` 添加可空的唯一 `idempotencyKey` 和 `requestFingerprint`。旧流水不回填、不改写；没有这对字段的采购、调拨、盘点流水继续由各自单据的幂等规则管理。数据库要求新请求键与 64 位摘要成对存在，唯一索引作为最终去重约束。

手工表单携带服务端生成的请求键，仅在成功响应后换新键；网络失败重试沿用原键。服务在事务内先锁请求、核对操作者与规范化业务内容的摘要，再锁定物料和库位更新库存、写流水及通知 outbox。同键同内容返回首次流水，不再更新余额或发送预警；同键不同内容拒绝。上线前必须先应用前向迁移，不能只部署新的 Prisma Client。

已发时薪再次提交同一“已发”状态时保留原 `paidAt` 和 `updatedAt`，不能把重试时间写成首次发放时间。验证与候选状态见 [整改执行记录](./docs/audits/2026-09-11-remediation-validation.md)。

## 2026-09-15 样品用途与整单价

新增前向迁移：

1. `20260915120000_sample_order_purpose`：增加 Order.purpose（STANDARD / SAMPLE_SHIPMENT / PROOF）、pricingMode（ITEMIZED / MANUAL_TOTAL）、samplePackagingRuleCode，以及 purpose/createdAt 索引。旧行默认 STANDARD + ITEMIZED；CHECK 强制 PROOF 对应 MANUAL_TOTAL，其余用途对应 ITEMIZED。
2. `20260915121000_sample_draft_revision`：扩展 Order_priceRevision_check，允许各创建角色的样品草稿在未报价时 priceRevision=0；仍要求 DRAFT 且没有报价修订引用。保留已应用迁移原文。

寄样加工行零金额；运费与包装复用 OrderCustomerCharge 的逐地址键及物流价目锁。打样只用 `ORDER:PROOF:TOTAL` 的 SAMPLE_FEE 行作为总应收，未核价 amount=null；管理员确认后由原价格修订/审计/台账事务同步 totalAmount、confirmedFee，settledFee 仍在结算时写入。没有平行的人工总价列。

报价冻结在既有 OrderPricingRevision 与 OrderPriceVersionLock。已报价/确认工单不会因发布规则而自动变价。样品用途不可通过现有编辑命令改写，历史普通单不重新计算。

本轮已验证原本地开发库升级及独立空库 148 项完整迁移链。生产发布仍须执行既有迁移发布步骤，本次未部署。

## 2026-09-16 计件工价草稿编辑

迁移 `20260916190000_piecework_draft_metadata` 调整
`PieceworkPriceBook_publication_shape_check`，允许草稿存储拟生效时间与调整说明。
不增加列、不回填价格、不修改已发布数据；既有发布证据要求、已发布工价保护和后续版本约束保持生效。
此 ALTER TABLE 需要短时表锁，按正式发布窗口执行。

草稿规则保存与发布使用同一个 advisory lock；保存同时推进父版本 `updatedAt`，
并追加审计。空拟生效时间在发布锁内使用数据库时钟确定，不预设为零价。
新 seed 不再生成机型计价与包装时薪旧规则，但保留历史记录及历史查询依赖。

### 2026-09-16：局部工序计薪次数

前向迁移 `20260916153000_operation_payroll_pass_count` 增加
`ProductionOperation.payrollPassCount`（可空正整数，限局部工序）与 `payrollRevision`。
空值保留按颜色数的原行为；不回填、不更新历史报工，不改变来源数量与生产计划。
报工 `snapshot.payroll` 保存实际次数和修订号；改版新工序重新使用默认次数。

### 个人计件工价作用域（2026-09-17）

迁移 `20260916200000_personal_piecework_rates` 给 `PieceworkPriceBook` 增加可空 `workerId` 外键及 `useUnifiedRates`。空账号表示统一工价；账号版本可为个人价格或无明细的统一模式。全局版本号保持唯一，各作用域生效区间互斥；关闭区间要求同作用域后继版本。发布触发器核验账号有效、岗位与单位完整。报工触发器独立检查实际报工人的有效个人模式与所用价格簿。原已发布不可变、冲正和历史保护继续生效。
迁移 `20260917001000_personal_piecework_draft_scope` 将原全局单草稿索引改为每作用域单草稿。两条均为前向迁移，旧记录保留统一作用域，不回写工资、不自动发布任何正式价格。
`ProductionReport.snapshot.payroll` 新增 `rateSource/policyBookId/policyBookVersion/rateWorkerId`，旧快照缺这些字段时解释为统一工价。

### 2026-09-17 分档工资与人工核定账本

增量迁移 `20260917010000_foil_wage_rule_components`、`20260917011000_foil_wage_ledger`、`20260917012000_foil_wage_fixed_rounding`：

- `PieceworkPriceRule.smallOrderAmount/setupAmount` 为成对可空的金额；历史规则保持 NULL，不重新解释历史工资。PACKING 不使用烫金包干字段。
- `ProductionReport.wageSupplement` 是保持原 rate／chargeableQty 快照的计价差额，总额约束为 `round(chargeableQty × rate, 2) + wageSupplement`。数据库重新验证分档、倍率与首次固定费，不能任意填差额绕过自动计价。
- `ADJUSTMENT` 仅以有效原报工为锚点，由有效管理员追加，零产量、同一未结算工作日，保留原工价身份和调整原因。原记录不可修改，已结算工资不能更改。
- `ProductionOperation.payrollReviewRequired` 标识多人接手、合并款式颜色数不一致、继承进度或计价条件变化；人工核定后解除结算阻挡。分档报工冲正也需要复核。

### 2026-09-18：建单设计分组

前向迁移 `20260918120000_order_design_groups` 仅为 `OrderItem` 增加 nullable `designGroupKey TEXT`，无数据删除或历史回填。标识只在所属工单内分组，不是跨工单外键；金额、文件、生产任务和工资仍绑定独立 `OrderItem.id`。发布应用前须先应用迁移并生成 Prisma Client，旧应用兼容空字段。

### 2026-09-18：创建请求重试核对

复用 `OrderLog.changedFields` JSON，在首条 `CREATE` 日志内写入 `createRequest: { version: 1, fingerprint: SHA256 }`，随工单创建事务原子保存。指纹取首次创建请求而非之后可修改的工单状态；普通工单、寄样、打样使用相同重试校验。无需新增迁移；已有日志不回填，缺指纹的历史重试要求打开原工单人工核对。业务展示忽略无 `before/after` 的元数据。

### 2026-09-18 新版报工异议

新增前向迁移 `20260918060000_production_report_disputes`：创建 `ProductionReportDispute`，关联不可变的 `ProductionReport`；报工的 reporterId 即发起人所有权依据，回复人关联 User。保留旧 `ProductionTaskDispute` 及历史消费方。

- 部分唯一索引保证每条报工最多一个 PENDING；事务锁串行化提交与回复。
- CHECK 限制说明长度、状态与回复字段的一致性；触发器禁止删除、修改原始问题与关联，以及再次修改已处理记录。
- 无历史数据回填，无计价、工资或报工账本更新。上线需先应用该迁移，再切换应用版本。
