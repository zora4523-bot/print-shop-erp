# 分区 Cutover 计划（A09）

> 本文档只是**计划**。任何一步都必须由运维在维护窗口内手工执行，
> 禁止 agent / migration / CI 自动执行（backlog A09 为 `manual-ops-only`）。
> 执行前必须先完成 pgbackrest 全量备份，并确认可以按"回滚"章节恢复。

## 1. 适用范围

来自 `app_ops.partition_candidate`（migration `20260628006000_partition_readiness`）：

| 表 | 分区键（control） | 分区粒度 | 保留策略 | 优先级 |
|---|---|---|---|---|
| `public."MaterialTransaction"` | `occurredAt` | 1 month | 36 months（保留归档表） | 10 |
| `public."OrderLog"` | `createdAt` | 1 month | 36 months（保留归档表） | 20 |
| `public."NotificationLog"` | `createdAt` | 1 month | 18 months（保留归档表） | 30 |

**何时执行**：单表行数超过约 500 万行、或 `pg_stat_statements` 显示按时间范围
查询的日志扫描成为 top 慢查询时再做。在此之前维持现状（已有 `occurredAt` /
`createdAt` 单列索引，见 dashboard 索引 migration）。

## 2. 当前 blocker（与 `app_ops.partition_readiness` 对齐）

三张表共同的 blocker：

1. `parent_table_is_not_partitioned` — 现表是普通堆表，PostgreSQL 不能原地转分区表，必须新建 partitioned parent 后搬数据。
2. `primary_key_does_not_include_control_column` — 现 PK 都是单列 `id`（cuid）。分区表的 PK/唯一约束必须包含分区键，需改为复合主键 `(id, <control>)`。

**incoming foreign keys**：截至本计划编写时（schema `20260628014000`），
`MaterialTransaction`、`OrderLog`、`NotificationLog` **没有任何入向外键**
（其他表不引用它们的 `id`；schema 里的 `MaterialTransaction[]` 等都是反向关系
列表，外键实际落在日志表自身）。cutover 前必须复核：

```sql
SELECT conname, conrelid::regclass AS referencing_table
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('public."MaterialTransaction"'::regclass,
                    'public."OrderLog"'::regclass,
                    'public."NotificationLog"'::regclass);
-- 期望 0 行。若出现新引用，该引用表必须先改造（分区表的被引用列
-- 必须含分区键，等价于要求引用方持有复合外键），否则本计划作废重评。
```

出向外键（日志表指向 `Material` / `Order` / `User` / `NotificationChannel` 等）
在分区表上不受限制，可原样保留，包括 `OrderLog.orderId` 的 `ON DELETE CASCADE`。

## 3. 主键与 Prisma 模型变更

每张表的 PK 从 `(id)` 改为复合：

- `MaterialTransaction`: `PRIMARY KEY ("id", "occurredAt")`
- `OrderLog` / `NotificationLog`: `PRIMARY KEY ("id", "createdAt")`

`id` 仍由应用侧 cuid 生成，全局唯一性由生成器保证；数据库层不再有跨分区的
`id` 唯一约束（PostgreSQL 分区表做不到不含分区键的全局唯一索引），可接受：
三张表都没有入向外键，也没有按裸 `id` upsert 的业务路径。

Prisma 侧（cutover 同一 PR 内完成，上线顺序见 §5）：

```prisma
model MaterialTransaction {
  id         String   @default(cuid())
  occurredAt DateTime @default(now())
  // ...其余字段不变
  @@id([id, occurredAt])
}
```

应用代码影响排查清单：

- `findUnique({ where: { id } })` → 复合主键后需改 `findUnique({ where: { id_occurredAt } })` 或 `findFirst({ where: { id } })`。cutover 前 grep 三张表的所有 `findUnique` / `update` / `delete` / `upsert` 调用点并逐一改写。
- 三张表当前都是 append-only + 列表查询为主（`createMany` / `findMany`），预期改动面小；`NotificationLog` 的 retry 更新路径（`lib/notification/webhook.ts`）按 `id` 更新，需要确认改为 `updateMany({ where: { id } })`。

## 4. 前置条件（一次性）

1. Pigsty 集群已按 `docs/pigsty-production-activation-runbook.md` 安装 `pg_partman` 并建好 `partman` schema（`CREATE EXTENSION pg_partman WITH SCHEMA partman` 已由 migration 在有包的环境完成）。
2. `SELECT * FROM app_ops.partition_readiness;` 确认 `partman_installed = true`。
3. pgbackrest 完成一次全量备份且验证可恢复。
4. 选定低峰维护窗口（写入停止或可容忍分钟级锁）：三张表都是日志型写入，建议在夜间 cron（薪资结算）完成后执行。
5. 应用侧准备好配套 Prisma schema/代码 PR（§3），但**先不部署**。

## 5. Cutover 步骤（每表独立执行，按优先级 NotificationLog 先试点）

> 建议顺序：先拿风险最低、无更新路径几乎纯 append 的 `OrderLog` 或
> `NotificationLog` 试点，最后做 `MaterialTransaction`（涉及库存对账）。
> 以下以 `NotificationLog` 为例，另两张表同构替换表名/控制列。

### 5.1 建新分区父表（在线，无锁风险）

```sql
CREATE TABLE public."NotificationLog_p" (LIKE public."NotificationLog" INCLUDING DEFAULTS INCLUDING STORAGE)
PARTITION BY RANGE ("createdAt");

ALTER TABLE public."NotificationLog_p" ADD PRIMARY KEY ("id", "createdAt");
-- 重建原表全部二级索引（eventType / status / createdAt）与出向外键。
-- 外键必须逐字复制原表定义（含 ON DELETE / ON UPDATE 行为——Prisma 默认是
-- ON DELETE RESTRICT ON UPDATE CASCADE，OrderLog.orderId 是 ON DELETE CASCADE），
-- 先用下面查询导出原定义再改表名套用，禁止手写裸 REFERENCES：
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public."NotificationLog"'::regclass AND contype = 'f';
ALTER TABLE public."NotificationLog_p"
  ADD CONSTRAINT "NotificationLog_p_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES public."NotificationChannel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX ON public."NotificationLog_p" ("eventType");
CREATE INDEX ON public."NotificationLog_p" ("status");
CREATE INDEX ON public."NotificationLog_p" ("createdAt");

SELECT partman.create_parent(
  p_parent_table := 'public.NotificationLog_p',
  p_control      := 'createdAt',
  p_interval     := '1 month',
  p_start_partition := (SELECT to_char(date_trunc('month', min("createdAt")), 'YYYY-MM-DD')
                        FROM public."NotificationLog")
);
```

### 5.2 历史回填（在线，分批）

```sql
-- 按月分批 INSERT，避免一次性大事务；每批后检查复制延迟/WAL 压力。
INSERT INTO public."NotificationLog_p"
SELECT * FROM public."NotificationLog"
WHERE "createdAt" >= '<月初>' AND "createdAt" < '<下月初>';
```

### 5.3 停写切换（维护窗口，分钟级）

```sql
BEGIN;
LOCK TABLE public."NotificationLog" IN ACCESS EXCLUSIVE MODE;
-- 补最后一段增量（回填高水位之后的行）：
INSERT INTO public."NotificationLog_p"
SELECT * FROM public."NotificationLog" t
WHERE NOT EXISTS (
  SELECT 1 FROM public."NotificationLog_p" p
  WHERE p."id" = t."id" AND p."createdAt" = t."createdAt");
ALTER TABLE public."NotificationLog" RENAME TO "NotificationLog_old";
ALTER TABLE public."NotificationLog_p" RENAME TO "NotificationLog";
-- 关键：pg_partman 的 part_config.parent_table 是纯 text，RENAME 不会跟随，
-- 不改这行的话 retention / run_maintenance 会挂在已不存在的 _p 名字上。
-- 先 SELECT parent_table FROM partman.part_config 确认 create_parent 实际
-- 存储的字符串（引号/大小写以存储值为准），再在同一事务里改写：
UPDATE partman.part_config
SET parent_table = replace(parent_table, 'NotificationLog_p', 'NotificationLog')
WHERE parent_table LIKE '%NotificationLog_p%';
COMMIT;
```

窗口内同时部署 §3 的应用 PR（复合主键 Prisma 模型）。`_old` 表保留至验证通过。

### 5.4 验证（切换后立即）

```sql
-- 行数一致
SELECT (SELECT count(*) FROM public."NotificationLog") =
       (SELECT count(*) FROM public."NotificationLog_old") AS counts_match;
-- 边界一致
SELECT min("createdAt"), max("createdAt") FROM public."NotificationLog"
UNION ALL
SELECT min("createdAt"), max("createdAt") FROM public."NotificationLog_old";
-- MaterialTransaction 额外做金额/数量对账：
-- SELECT direction, sum(quantity) FROM ... GROUP BY direction; 两表结果必须一致。
-- 分区计划正确、新写入落到当月分区
SELECT * FROM partman.show_partitions('public.NotificationLog');
```

应用 smoke：走一次真实写入路径（发一条 mock 推送 / 录一笔物料流水 / 改一次工单），
确认新行进入正确分区且列表页正常。

### 5.5 收尾（验证通过 1-2 周后）

```sql
UPDATE partman.part_config
SET retention = '18 months',           -- MaterialTransaction/OrderLog 用 36 months
    retention_keep_table = true
WHERE parent_table = 'public.NotificationLog';
-- run_maintenance 由 partman BGW 或 pg_cron 定期执行（见 runbook）。
DROP TABLE public."NotificationLog_old";  -- 最后一步，确认无回滚需要后执行
```

## 6. 回滚

- **切换事务内失败**：`ROLLBACK` 即可，原表未动。
- **切换后发现问题（`_old` 未删）**：再开维护窗口反向 rename——把分区表改回 `_p` 名、`_old` 改回原名，并把 `partman.part_config.parent_table` 同事务改回 `_p` 名（同 §5.3 的 UPDATE，方向相反）；将窗口期间写入分区表的增量行（`createdAt` > 切换时刻）`INSERT` 回原表；回滚应用 PR（复合主键 → 单列 `@id`）。
- **`_old` 已删**：从 pgbackrest PITR 恢复，属事故级操作，故 §5.5 要求延迟删除。

## 7. 明确不做

- 不改 `BusinessAuditLog`（新表、量级未知，等增长数据再评估，先复用本计划模板）。
- 不在 Prisma migration 里做任何 rename/backfill——cutover SQL 全部走运维手工执行并记录到 `DECISIONS.md`。
- 不引入按 `id` 的全局唯一索引替代品（如触发器查重）——cuid 生成端唯一性足够。
