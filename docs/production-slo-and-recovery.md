# 生产 SLO、备份与恢复基线

本文是本项目的可验收生产基线，不是理想态清单。应用不自己实现备份；PostgreSQL 备份由 Pigsty/pgBackRest 执行。

## 目标

| 项目 | 目标 | 验收方式 |
|---|---:|---|
| Web 可用性 | 月度 99.9% | 外部监控每 1 分钟请求 `/api/health/ready` |
| 数据库 RPO | ≤ 5 分钟 | pgBackRest 连续 WAL 归档，每日检查 archive max |
| 数据库 RTO | ≤ 60 分钟 | 每月在隔离环境做完整恢复演练并记录耗时 |
| 轻任务开始延迟 | 95% < 1 分钟 | 任务账本 `createdAt` 到 `startedAt` |
| 重任务开始延迟 | 95% < 15 分钟 | `/owner/background-jobs` 与 ready 端点 |
| 死信响应 | 工作时间 30 分钟内 | Sentry + ready 端点 `deadLast24h` 告警 |

## 备份策略

- 每日完整备份，保留 30 天。
- 至少两个独立 repository：Pigsty 节点本地一份，异地对象存储一份。
- 连续 WAL 归档同时写入两个 repository，以支持 PITR。
- OSS `design/` 原稿开启版本化与跨区域复制；`bundles/` 为可再生成产物，可用生命周期规则清理。
- 备份凭证不进入应用 `.env`、CI 或 Git，由 Pigsty 主机管理。

每日由监控节点执行只读验收：

```bash
PGBACKREST_STANZA=<stanza> \
BACKUP_REQUIRED_REPOS=2 \
BACKUP_MAX_AGE_HOURS=30 \
pnpm check:backup
```

任一 repository 不健康、最新 full 超时或没有 WAL 时返回非零退出码。

## 恢复演练

1. 在与生产网络隔离的 Pigsty 演练集群中，从异地 repo 恢复最新 full + WAL。
2. 恢复到演练时间点，记录备份 label、目标时间、实际 RPO/RTO。
3. 用只读账号核对表数量、最新工单、任务账本、设计文件引用数。
4. 启动三个 PM2 进程，确认 `/api/health/ready` 为 200，再消费演练环境队列。
5. 结果记入运维工单；超出 RTO/RPO 时必须整改后重演。

## 监控与告警

- `/api/health/live`：只判断 Node 进程存活，不用于业务就绪。
- `/api/health/ready`：验证 DB、LIGHT/HEAVY worker 心跳、积压、死信与超时 RUNNING 任务。
- Sentry：Web 未捕获错误和 worker 错误都上报，以 `APP_VERSION` 区分发布。
- PM2：Web 768 MiB，LIGHT 384 MiB，HEAVY 1280 MiB；HEAVY 并发固定为 1。
- PostgreSQL：用 Pigsty 自带监控 + `pg_stat_statements`，不在应用主机重复搭建 Prometheus/Grafana/ELK。

## 发布门禁

只有以下项全部通过才可切流量：

```bash
pnpm check:env
pnpm prisma migrate status
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
curl -fsS https://erp.example.com/api/health/ready
pnpm check:backup
```
