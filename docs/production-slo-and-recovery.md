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
| 死信响应（**非通知类**） | 工作时间 30 分钟内 | 外部监控每 1 分钟请求 `/api/health/jobs`，非 200 即告警（连续 2 次失败再通知）；告警码 `dead-jobs-last-24h` |
| 通知投递失败响应 | 工作时间 30 分钟内 | **不看 `/api/health/jobs` 的状态码**（通知类死信只让它 200 `degraded`）。采样点是 `/owner/notifications` 的 `NotificationLog(status=FAILED)` 与 `/owner` 首页的 24 小时推送失败告警条 |

## 当前生产偏差（2026-08-02）

- <https://bag.sshapi.cn> 已运行 `aa42ba0`，45 / 45 migrations，Web、LIGHT、HEAVY 与 ready 正常。
- pgBackRest full `20260802-193420F` 和连续 WAL 正常，但仅有 repo1、full retention 为 2；因此“两 repo + 30 天”仍未达标，默认备份门禁应失败。
- `SENTRY_DSN` 尚未配置，当前只能依赖 PM2/Next 日志和 ready。
- `/api/health/jobs` 已在应用侧就绪（2026-08-21），但**尚未接进任何外部监控**；在有东西按分钟去拉它之前，上表的死信响应目标不生效——代码只是把信号暴露出来了，不会自己告警。
- 应用机为 1.6 GiB RAM + 4 GiB swap，自动使用低内存 PM2 档；生产构建曾因换页耗时约 10.9 分钟。至少 4 GiB RAM 仍是整改目标。
- PDF 固定使用 `/usr/bin/chromium`，已实测生成 37,646 字节中文 PDF；真实 OSS 设计图打印仍需人工验收。

## 备份策略

- 每日完整备份，保留 30 天。
- 至少两个独立 repository：Pigsty 节点本地一份，异地对象存储一份。
- 连续 WAL 归档同时写入两个 repository，以支持 PITR。
- OSS `design/` 原稿开启版本化与跨区域复制；`bundles/` 为可再生成产物，可用生命周期规则清理。
- 工单与代理商月账单 XLSX 是可再生成的私有临时产物，不纳入备份；分别使用 `ORDER_EXPORT_ARTIFACT_DIR` 和 `AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR`，两者不得共用。READY 产物生成完成后 24 小时过期；无账本 orphan 为避免误删刚落盘但事务结果尚不确定的文件，留出最多约 48 小时安全窗口后回收。`/api/cron/order-export-cleanup` 同时回收两套账本，每套每次按 100 行一批、最多处理 500 行；终态月账单导出收据擦除全部筛选参数。多机部署前必须迁往私有对象存储并保留本人授权与下载审计。
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
- `/api/health/ready`：判断「能不能接流量」——DB 连通 + LIGHT/HEAVY worker 心跳。死信、卡死 RUNNING、积压只出现在 `warnings` 与 `jobs` 计数里，**不影响状态码**：`deploy/update.sh` 用它判定发布成败，非 200 会让三个进程保持停止，历史死信不该有这种杀伤力。
- `/api/health/jobs`：队列告警专用。**非通知类**死信、超时 RUNNING、worker 心跳缺失或版本不一致 → 503；会自愈的积压、以及**通知类死信**（`deadNotificationLast24h` / 告警码 `dead-notification-jobs-last-24h`）→ 200 `degraded`。启用智能机器人目标后，目标配置残缺、凭据缺失、Bot 身份不一致、认证失败或连接冲突也会告警。匿名响应给出 `smartBot.required/configurationValid/identityMatch/operational` 和额外 LIGHT 心跳的相对过期提示 `recoveryWaitMs`（0–180 秒），不回 Bot ID 摘要、群 ID、worker 明细、任务 id、类型或错误信息。这是**非通知类**死信 30 分钟响应目标的采样点。通知类之所以降级不 503（2026-08-21）：通知死信是**批量**的（一次企业微信扇出可以一口气产生几十条），且真正需要人处置的信息是「哪个群、哪个事件、什么错误码」——那在 `/owner/notifications` 上，不在探针的计数里；让它 503 只会把发布人和值班人训练成忽略这个端点。**「连续 2 次失败再通知」的去抖要放在监控侧**：HEAVY 队列并发固定 1、`runLane` 只在 claim 时扫租约，唯一 lane 跑长任务期间一条崩溃遗留的 RUNNING 会持续计入 `staleRunning`，探针会稳定 503 一段时间——不要为此把代码里的阈值调松。
- `scripts/deploy-smoke.mjs` 也会拉一次 `/api/health/jobs`。历史死信等与本次智能机器人发布无关的 503 只打 WARNING；若存在启用中的智能机器人目标，则配置/身份错误立即阻断，`CONNECTING` / `DISCONNECTED` 也不会被当作发布成功。`deploy/update.sh` 使用共享的有界等待策略：默认先给 120 秒启动观察；首次配置有效且身份一致的暂态异常有 270 秒恢复预算（180 秒心跳过期 + 60 秒最大心跳间隔 + 6 秒稳定期 + 24 秒余量）。新的额外心跳可按相对过期提示有限延长软截止，但整个门禁默认最多 600 秒。仍要求唯一 LIGHT worker 稳定 `CONNECTED` 6 秒；真实双实例、持续重启或观察期结束仍未恢复都会保持停写并拒绝发布。健康不可读或身份尚未确认不会凭空延长预算；临近硬截止的新崩溃也不保证自愈放行。
- Sentry：目标是 Web 未捕获错误和 worker 错误都上报，以 `APP_VERSION` 区分发布；当前生产尚未配置，不能把该告警链视为已启用。
- PM2：≥3 GiB 主机使用 Web 768 / LIGHT 384 / HEAVY 1280 MiB restart 上限；<3 GiB 主机自动使用 Web 512 / LIGHT 384 / HEAVY 640 MiB 低内存档（V8 heap 分别 384 / 256 / 448 MiB）。HEAVY 并发固定为 1，低内存档是带 swap 的临时方案。
- PostgreSQL：用 Pigsty 自带监控 + `pg_stat_statements`，不在应用主机重复搭建 Prometheus/Grafana/ELK。

## 发布门禁

只有以下项全部通过才可切流量：

```bash
NODE_ENV=production pnpm check:env
pnpm prisma migrate status
pnpm typecheck
pnpm lint
pnpm exec vitest run
pnpm build
curl -fsS https://erp.example.com/api/health/ready
PGBACKREST_STANZA=<stanza> BACKUP_REQUIRED_REPOS=2 pnpm check:backup
```

当前生产在 repo2、30 天保留、恢复演练和 Sentry 项上仍未满足本基线；文档记录
真实偏差不等于豁免门禁。补齐前的每次发布都必须明确风险、保留迁移前 full
backup，并由负责人确认继续发布。
