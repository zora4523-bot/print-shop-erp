---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# 数据库指南

## 2026-09-28 生产事实核对与历史恢复

本轮新增 `20260928130000_production_fact_review`、`20260928131000_production_fact_guard_hardening`、`20260928132000_production_recovery_resolution`、`20260928133000_production_inclusion_evidence`，完整迁移链为 179 项。守卫及同日同人后续事实关联各自使用前向迁移；不改已应用 SQL。

`ProductionFactReview` 与 ProductionJob 一对一，保存原任务修订、核对期间、理由、证据、创建及处理人/时间和乐观修订。OPEN/CONFLICT 表示事实未决，阻止区间内人员日结及依赖新版继续计产；UNPRODUCED 只在与当前任务修订一致时代表已核实未产；RESOLVED 表示事实核清；WAGES_DUE 是已结算原日的未付义务；DISMISSED 仅据证关闭义务，不撤销生产。迁移为旧版/关闭工单上未明的任务建立 OPEN，不猜生产量、不改旧工资。

锁顺序保持工单→排序人员身份→工价共享锁→日期/人员日。直接 SQL 同样保护原归属、申请原量/原日、逐修订的未生产驳回证据和旧版义务；已结算日的完成事实即使没有普通工资行也不可更正。延迟约束要求该类完成有原已结算工资或持久待补义务。已应用约束及工资流水不回退删除。

恢复操作、备份和整批停写切换要求见 [生产恢复手册](docs/生产事实恢复手册.md)。本节仅描述本轮变更，不更新其他章节的历史验证日期。

## 2026-09-28 单负责人生产账本

本任务追加 `20260928120000`、`20260928121000`、`20260928122000`、`20260928123000` 四个前向迁移，完整链增至 **175 项**。没有修改既有 171 项迁移。`Order.simpleProduction` 默认为 false；已有生产、包装、工资和物流均保持原状，新排单发布才切换。关联新流程的重做单在物化时继承策略。

新增表：`ProductionDispatchBatch` 保存请求哈希/操作者/结果；`ProductionJob` 保存版本、单一负责人、任务来源、物理生产快照、数量申请、实际完成与来源；`ProductionWage` 是按任务/受益人/实际工作日唯一的净金额投影（NULL 表示待补价）；`ProductionWageEntry` 是不可改删的差额流水。`PieceworkSettlement` 关联新工资事实，旧报告关系保留。

任务与对应工序/进度的 orderId、workOrderVersion 一致，排除 PACKING；任务来源键与目标唯一。完成事实禁止普通改写，任务禁止删除；只有对应原因审计、同一负责人和未结算零净额条件齐全时允许误登记重新开放。工资身份、已结算记录和流水不可改删；延迟约束核对净额与流水合计。零余额历史仍保留，更正后新日期工资另立记录。

应用按工单排序锁→工资身份排序锁→工价共享锁（自动计价）→工作日/人员日锁，沿用既有结算协调键。数量待审批阻止对应工作日结算，NULL 待补价参与结算前置检查；结算与录入共用日期锁。新流程旧报告 INSERT 被数据库拒绝，避免双账本同时计产。

迁移只加表/列/保护，不自动猜旧单师傅；已有报工旧单继续使用旧账本。部署先应用迁移再启动新代码；不能在已有新流程数据后回退到只读旧报告的应用版本。验证证据见 [本次执行记录](docs/audits/2026-09-28-production-assignment-implementation.md)。


## 2026-09-28 未来计件工价单版取消

前向迁移 `20260927180000` 单独扩展 enum `CANCELLED`；`20260927180100` 增加取消字段、不可变 `PieceworkCancellation` 及保护触发器；`20260927180200` 固定直接 SQL 报工的锁顺序和取消记录 NULL 形状检查；`20260927180300` 为报工 `snapshot #>> '{payroll,policyBookId}'` 增加非空部分表达式索引。完整链为 171 项，不修改已应用迁移。

应用与触发器使用相同的直接引用 OR 政策引用谓词，使 `priceBookId` 与政策表达式两侧均可使用索引。取消复核仍使用现有独占协调锁；索引避免报工记录增长后引用检查必然全表扫描，实际执行计划仍由数据库按数据量选择。

取消事实保存目标原始窗口、目标/前版/后继的真实外键及复核修订、前版原止期/新止期、操作者、原因、UUID 请求键、请求 SHA-256 和创建事务 ID。目标唯一、操作者/请求唯一；记录禁止更新/删除。创建事务 ID 防止在后续调价后重用历史取消记录恢复旧窗口。DRAFT/PUBLISHED 的取消字段全空；CANCELLED 保留完整发布事实并必须有完整取消事实。

`protect_piecework_price_book_history` 仅放行同事务登记的未来 PUBLISHED→CANCELLED 与对应前版区间恢复，其他发布事实不变；先取消目标再恢复前版，保留按 workerId 的 PUBLISHED 排斥约束。延迟触发器在提交时重新检查目标仍未生效、无 priceBookId 或 snapshot.payroll.policyBookId 引用、前版衔接完整和后继完全不变。取消路径的锁后与提交时均用 clock_timestamp；正常立即发布关闭前版保留既有事务开始时间判断，避免误拒绝同事务取时后的正常发布。CANCELLED 终态禁止更新/删除，规则 INSERT/DELETE/UPDATE 同时保护 OLD/NEW 所属发布或取消版本。

个人取消按身份锁→工价独占锁；统一取消取工价独占锁。应用报工继续工单/工序/身份→工价共享→报工日/人员日；直接 SQL 报工触发器先取工单锁，再取工价共享锁，后续既有工序/价格/工资保护照常执行，避免工单锁与工价锁交叉。人工核定领域同样在工单/工序锁之后、工序行锁和所有报工日锁之前取工价共享锁，并在等待后重验管理员，避免与排队中的取消/发布形成锁环。新报工不能引用取消版；历史冲正及人工核定保留原始价格锚点校验，不要求旧价格在更正时仍生效。

升级不重写已有工价、规则、报工或结算。开启前及回退限制见 [部署指南](docs/部署指南.md#未来计件调价取消开关2026-09-28)。

## 2026-09-27 仓库配置与库存并发边界

本批无 schema 或迁移改动。仓库维护、仓库/库位创建使用 `hashtextextended('print-shop-erp:warehouse-configuration',0)` 事务独占锁；手工出入库、采购收货/反向取消、调拨、盘点过账在顶层事务首先取得同键共享锁，再取得既有请求、采购、物料等锁。库位状态在锁内读取，维护逐条查询非零库存；改名/启停采用 updatedAt 比较及严格递增时间，同事务记录前后值审计。默认对象仅由既有迁移初始化，运行时没有默认库位创建函数；不修改历史迁移。

三个配置写入口在独占锁之前执行 `SET LOCAL lock_timeout = '3s'`，不修改库存共享锁策略；锁等待超时及交互事务繁忙转为可重试业务错误，全部回滚。兼容 Prisma 7 adapter 包装的 `55P03` 原因，其他异常继续抛出。


## 2026-09-27 表单创建记录

前向迁移 `20260927170000_form_creation_requests` 新增 `FormCreationKind` 与 `FormCreationRequest`。记录包含操作者、采购/BOM 类型、UUID 请求键与 draftId、SHA-256 业务事实摘要和规范化 JSON、唯一目标实体引用及创建时间。CHECK 要求目标恰好一个并与类型对应，外键 Restrict 保留实体关系，`(actorId, kind, clientRequestId)` 唯一。禁止更新、删除记录，首版不做自动清理，避免丢失重试去重依据。

创建领域事务先按请求取得事务级 advisory lock，再核对当前账号启用/创建权限并读旧记录；新实体、请求记录和创建审计同事务提交。状态查询使用相同锁，等待在途创建的提交或回滚。规范化事实保留 Decimal 精度，不包含生成单号、资料显示名、当前时间或浏览器暂存内容。既有单据不回填、不修改；兼容旧表单未提供请求键的原有创建入口。

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
| 薪资与考勤 | `SalaryRule`、`WorkerMachineSalaryRule`、`DailyWorkerSalary`、`HourlyWorkerPayroll`（只读打包历史存档）、`Attendance` |
| 账单与成本 | `Bill`、`BillPayment`、`BillItem`、`OrderCostEntry` |
| 通知与任务 | `NotificationChannel`、`NotificationRule`、`NotificationLog`、`BackgroundJob`、`BackgroundJobAttempt`、`BackgroundWorkerHeartbeat` |
| 系统配置 | `Setting`、业务编号序列模型 |

`DesignBundle.accessTokenHash` 只保存 CDR 外部下载 token 的 SHA-256；`zipObjectKey` 保存服务端生成的 bundles 对象键，公开路由只在 token 校验后签发短期下载地址。

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

- [`seedDashboardSnapshot`](./tests/e2e/_helpers.ts) 每次运行生成独立的 `e2e-dash-<runId>` 命名空间，只追加本轮测试所需的数据。销售 fixture 从角色匹配的 `e2e-*` 来源账号创建独立、停用的用户；不能借此克隆真实账号或产生可登录的新账号。
- 工作台 fixture 的用户、工单、账单、外协、周期和可选图表数据在同一事务中写入；任一步失败则整体回滚。重试创建新的命名空间，不删除或重写既有工单、账本、工资支付、价格快照或共享账号的历史记录。
- 测试应在完整关注列表中按本轮返回的记录 ID 查找，必要时翻页；不能为了使待办总数或第一屏顺序固定而清空历史数据。追加的数据随专用、可丢弃测试数据库的生命周期管理，不把该 helper 当作共享开发库的数据清理工具。
- [`worker-ui-fixture.ts`](./tests/visual/worker-ui-fixture.ts) 的工单展示交期使用 `2099-12-31`，使展示 fixture 不进入当前交期提醒窗口。
- 响应式 fixture 的工资日期也放在 2098 年。重建时只按该命名空间的明确 ID 清理自有数据，不按共享用户或全表删除。若自有记录出现新的账本引用，应检查引用与测试生命周期，不绕过外键约束。

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

`DesignBundle.accessTokenHash` 只保存 256 位随机下载令牌的 SHA-256 摘要；
`downloadUrlCiphertext` 使用 `AUTH_SECRET` 加密管理员历史页需要展示的原始链接，
`zipObjectKey` 保存受控对象键而不是长期 OSS 签名 URL。`revokedAt` 用于令牌失效
校验；下载接口始终在令牌校验通过后重新签发短时对象存储 URL。

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

（2026-09-11 当时的行为，2026-09-24 起时薪月结不再生成、重算或标记发放，打包历史月结只读：）已发时薪再次提交同一“已发”状态时保留原 `paidAt` 和 `updatedAt`，不能把重试时间写成首次发放时间。验证与候选状态见 [整改执行记录](./docs/audits/2026-09-11-remediation-validation.md)。

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

## 2026-09-20 空白封按单价管理

前向迁移 `20260920180000_blank_price_rules` 窄化 BASE 约束：只有结构合法的 `STOCK_BASE/BASE/PER_PIECE` 可以不绑定 Product，金额仍非空且非负；同价目规范化纸张、克重、规格键唯一。非空白 BASE、彩印 null 哨兵和已发布不可变约束保留。0 表示新业务未启用，不能解释为新单免费供货。新版本克隆可解绑旧产品但不改原版本。

`20260920181000_blank_bom_targets` 增加 `BillOfMaterial.blankPaperMaterialId/blankSpecificationKey`，目标三选一，纸张外键 Restrict、身份版本唯一且只允许一个启用版本。既有产品/分类外键改为 Restrict，保护历史 BOM。`blank_stock_bom_category_node_id` Setting 仅提供生产默认分类，数据库触发器校验有效空白封分类并保护引用。

新空白封 `OrderItem.productId=null`，继续保存完整事实和快照。历史材料补核存于原款式价格快照的独立确认元数据；订单总额不在补核动作中变更，修订与日志留痕。旧 Product 不参与新销售启用，仍保留有订单、价目、BOM、阶梯或审计引用的历史行。

升级操作与历史约束见[操作说明](./docs/空白封纸张规格管理-20260913.md)。BOM 复制工具默认只读，显式 `--apply` 才复制并核对，用量/基数/版本不一致整体回滚。


2026-09-21 审查补充：上述两条迁移已在本机日常库应用，不修改其 SQL 或校验和。升级入口先检查全部存量 STOCK_BASE 身份重复、旧语义零价与产品文本漂移，再持有价目排他 advisory lock 执行这两条迁移；详见[部署指南](./docs/部署指南.md#空白封按单价管理的升级前置2026-09-20)。此保护不能追溯修复已失败的迁移，也不代表正式库数据已通过。用料估算遇纸张身份冲突或默认分类异常时逐款返回“未估算”及原因，正常款式照常计算，汇总明确仅含已估算款式；不猜测物料或把异常算作零用量。

## 报工代次插入保护（2026-09-21）

增量迁移 `20260921100000_production_report_generation_guard` 对 ProductionReport 的新 REPORT 与全部 ProductionProgressReport 新增 BEFORE INSERT 闸口：从父工序/步骤读取工单，在 order-cascade advisory lock 下比较父代次与工单当前版本。触发器排序在既有工序行锁之前。报工表本身没有 orderId/workOrderVersion，不能直接套用父表触发函数。历史 REVERSAL/ADJUSTMENT 继续走已有锚点、管理员与结算保护，不把工资纠错当作旧代追加生产。迁移可重复执行，不更新历史行、不修改既有迁移。

## 删除客服 / 清废厨师与脱敏策略清理（2026-09-24）

业主 2026-09-24 决定（DECISIONS 同日、SPEC §L）由三条前向迁移落地，迁移链共 165 条：

- `20260924100000_remove_cleaner_cook_cleaning`：`WorkerType` 只剩 `MACHINE | PACKER`；删除
  `SalaryRuleType.COOK_SALARY`、`CLEANING` 工艺及其能力行、规则 `CLEANER_HOURLY` / `COOK_SPARE_HOURLY` /
  `OT_MULTIPLIER`，删除列 `Attendance.spareHours`、`HourlyWorkerPayroll.totalSpareHours` / `spareSalary`
  并重建 `HourlyWorkerPayroll_component_total_reconciles`（`totalSalary = baseSalary + otSalary`）；
  排队中的 `CRON_HOURLY_PAYROLL` 任务标记 `CANCELLED`（`lastErrorCode = JOB_TYPE_REMOVED`）。
- `20260924110000_remove_customer_service_role`：`Role` 只剩 `ADMIN | SALES | WORKER`；
  `OrderSettlementType` 只剩 `EXTERNAL_SALES | NO_CHARGE`；删除 `SalaryRuleType.CS_COMMISSION` 及其规则行、
  `SalaryPeriod` / `CsSalesEntry` / `CustomerServiceCommission` / `CsPayrollPayment` 四张表与
  `SalaryPeriodStatus` / `CsSalesEntryType` 枚举、`CS_PERIOD_ENDING` / `CS_PERIOD_SETTLED` 通知规则；
  排队中的客服 cron 与客服通知任务标记 `CANCELLED`；重建 `Order_protect_billed_settlement` 触发器与相关
  CHECK 约束，`Order_settlement_role_consistent` 收紧为收费单必须 `SALES + EXTERNAL_SALES`。
- `20260924150000_prune_removed_sensitive_column_policies`：删除 `app_ops.sensitive_column_policy` 中指向
  上述已删列 / 表的 10 条策略（`HourlyWorkerPayroll.spareSalary`、`SalaryPeriod` 3 列、
  `CustomerServiceCommission` 6 列），且只在对应列确已不存在时删除，可重复执行。否则
  `app_ops.security_extension_readiness` 会持续报 `sensitive_policy_references_missing_columns`。

前两条迁移是 fail closed：任何业务数据（账号、工单身份与结算快照、价格修订快照、价目簿、考勤快照、
审计日志、四张客服表中的数据、工艺 / 派工 / 日工资明细 / 待审改单 / 进度步骤对 `CLEANING` 的引用、
运行中的相关任务）仍引用被删除的值时 `RAISE` 中止并整体回滚，不静默改写历史。已结束的历史任务与
通知日志保留为运行记录，应用层不再允许重试 / 重发（见 API.md「已删除功能的历史任务与通知」）。
生产执行前的只读预查 SQL 见 [部署指南](./docs/部署指南.md#删除客服--清废厨师的三条迁移2026-09-24)。
以后删除列或表时，同一迁移或紧随的前向迁移必须清理对应脱敏策略。
