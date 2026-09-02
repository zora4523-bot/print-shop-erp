# Prisma PostgreSQL 单连接并发查询审查（2026-09-02）

## 结论

`@prisma/adapter-pg@7.7.0` 会让 Prisma 的关系查询解释器在同一个
`pg.PoolClient` 事务连接上并发调用 `client.query()`。`pg@8.20.0` 会为此输出
弃用警告，`pg@9` 将直接拒绝这种调用。问题不是管理端工单页自己的
`Promise.all`；只改一个业务查询会遗漏其他同形入口。

仓库通过 pnpm 补丁回移 Prisma 上游
[PR #29979](https://github.com/prisma/prisma/pull/29979) 的修复语义：

- `PgTransaction` 的底层 I/O 在单个连接内串行执行；
- `PrismaPgAdapter` 的 `pg.Pool` 查询仍保持并行；
- 队列只传递“完成”信号，失败查询不会阻塞后续查询；
- 锁只包住 `performIO`，不会与 `userDefinedTypeParser` 的递归查询形成死锁。

补丁应在 Prisma 发布并升级到包含该修复的版本后移除；移除前必须让本次新增的
适配层行为测试和真实 PostgreSQL 探针在无补丁状态下全部通过。

## 已复现的业务路径

| 路径 | 入口 | 关系查询形状 |
| --- | --- | --- |
| 管理端工单列表 | `lib/order/admin-workspace.ts` | 工单及 items、变更、打印、账单、物流、日志等 |
| 师傅端工单列表 | `lib/worker-portal.ts` | submitter、工序报工、生产进度 |
| 返工单 | `lib/order/rework.ts` | items.designs、shipments、包装组 |
| 顺丰到付 | `lib/order.ts` | items、shipments.lines、customerCharges |
| 取消/改单审核 | `lib/order/change-request.ts` | 多分支取消与计价快照 |
| 月度账单导出 | `lib/agent-monthly-billing/export.ts` | items、adjustments.credit、receipt |

以下事务内关系读取也属于同一风险面，并由共享适配层补丁一并覆盖：变更计价与审核、
生产工序物化、工序报工、客户价目簿、账单、采购、外协、库存调拨及计件结算。

## 直接 `pg.Client` 审查

生产 `lib/` 只通过 PrismaPg 连接池访问 PostgreSQL。直连 `pg.Client` 仅存在于
负载测试、迁移验证、数据审计和测试辅助代码；逐处检查后均为逐条 `await query()`。
未发现同一 Client 上的 `Promise.all(query)` 或其他重叠查询。

## 验证门禁

- 适配层单元测试固定三项契约：事务串行、Pool 并行、失败后继续。
- PostgreSQL 子进程探针创建一条带星标关系的确定性工单，启用
  `--trace-deprecation` 调用真实 `loadAdminOrderWorkspace()`，并断言命中该工单且
  目标警告为零；探针设有超时和子进程强制回收。
- 子进程隔离是必要条件：`pg` 的弃用警告在一个进程中只报告一次，共用 Vitest
  worker 可能因其他测试先触发警告而产生假绿。
