---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# 数据库指南

本文描述仓库中的 PostgreSQL / Prisma 契约。Schema 的唯一事实源是
[`prisma/schema.prisma`](./prisma/schema.prisma)，迁移历史的唯一事实源是
[`prisma/migrations/`](./prisma/migrations/)。任何文档里的数字都不能替代目标数据库上的 `prisma migrate status`。

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
