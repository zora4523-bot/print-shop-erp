---
status: canonical-entrypoint
owner: project-maintainers
last_verified: 2026-10-03
applies_to: repository deployment workflow at last_verified
---

# 部署入口

详细、可执行的部署 runbook 只有一份：

> **[`docs/部署指南.md`](./docs/部署指南.md)**

本文件提供稳定的英文文件名入口，不复制安装、迁移、PM2、Nginx、cron 或恢复命令。这样修改部署流程时只维护一个事实源。

## 发布资料地图

| 需要解决的问题 | 事实源 |
|---|---|
| 从零部署、更新、故障恢复 | [`docs/部署指南.md`](./docs/部署指南.md) |
| 当前发布批次的单向门和人工核对 | [`docs/上线前置操作清单.md`](./docs/上线前置操作清单.md) |
| 发布阻塞、修复顺序与验收状态 | [发布整改任务台账](./docs/release-remediation-2026-09-10.md) |
| 2026-09-10 审查证据与功能覆盖 | [发布审查快照](./docs/audits/2026-09-10-release-readiness.md) |
| 自动化 smoke 与备份检查 | [`docs/deployment-smoke-checklist.md`](./docs/deployment-smoke-checklist.md) |
| 环境变量模板 | [`.env.example`](./.env.example) |
| 环境预检实现 | [`scripts/check-env.mjs`](./scripts/check-env.mjs) |
| PM2 三进程配置 | [`deploy/ecosystem.config.cjs`](./deploy/ecosystem.config.cjs) |
| Nginx 示例 | [`deploy/nginx.conf.example`](./deploy/nginx.conf.example) |
| 支持的 cron 端点与时间 | [`deploy/crontab.example`](./deploy/crontab.example) |
| cron 安全调用脚本 | [`deploy/run-cron.sh`](./deploy/run-cron.sh) |
| 当前生产候选目录切换 | [09-21 实际发布流程](./docs/audits/2026-09-21-production-release-ef6fa012.md) |
| 最新生产状态与发布证据 | [10-03 Analytics 发布记录](./docs/audits/2026-10-03-production-release-c5983b89.md) |
| 09-29 颜色目录验收（历史） | [09-29 烫金颜色修复发布记录](./docs/audits/2026-09-29-foil-color-identity-fix.md#正式发布结果) |
| 其他适配环境的更新脚本（不适用于当前生产） | [`deploy/update.sh`](./deploy/update.sh) |
| Pigsty 扩展激活 | [`docs/pigsty-production-activation-runbook.md`](./docs/pigsty-production-activation-runbook.md) |
| SLO、告警与恢复目标 | [`docs/production-slo-and-recovery.md`](./docs/production-slo-and-recovery.md) |
| 数据库规则 | [DATABASE.md](./DATABASE.md) |

当前生产不是 `main` 检出，应用机 1.6 GiB 内存不能承担本机构建，不得直接运行 `deploy/update.sh`。
2026-09-21 两条空白封迁移已 applied，脚本的 `--check-applied` 门禁会放行，不能再依赖它防止误用。

2026-10-03 当前生产为 `c5983b89`，188 条迁移已应用，Web/LIGHT/HEAVY、ready、jobs 与部署 smoke 通过。
本次使用候选目录切换、保留 queued PDF 和四条原有 cron；备份、副本演练、分析页及导出验收证据见
[10-03 Analytics 发布记录](./docs/audits/2026-10-03-production-release-c5983b89.md)。
历史前置 SQL 不应重复执行；后续仍须按目标环境事实确认适用步骤。

## 不可跳过的边界

- 先确认受审查的 release SHA，不能把分支名或本地脏工作区当作发布版本。
- 生产环境、备份、数据库迁移和外部服务状态必须在目标机器重新验证；仓库文档中的带日期快照不代表今天仍成立。
- 数据库迁移只向前。迁移开始后不能单独回退代码并恢复写入。
- 生产调度使用系统 crontab 和 root-only secret file；不要恢复 `pg_cron + pg_net` HTTP 调度。
- Web、LIGHT worker、HEAVY worker 和健康检查都通过后，才能把发布标为成功。
- 打印 PDF、OSS 直传、企业微信真发和备份恢复能力需要真实环境验证，接口 `200` 或 mock 成功不能替代。
- 启用企业微信 Bot ID + Secret 智能机器人前，必须先轮换本次已明文暴露的 Secret；`WECOM_SMART_BOT_ID` / `WECOM_SMART_BOT_SECRET` 成对注入受限环境，`BACKGROUND_JOBS_MODE=durable`，且 PM2 只运行 **1 个 LIGHT worker 进程实例**。重启后还必须在目标群完成一次性绑定，不能用“凭据已配”代替群真发验证。发布脚本会要求启用目标、Web 配置与当前版本 LIGHT worker 的 Bot ID 摘要一致，并等待 `CONNECTED` 稳定后才解除停写保护；持续断连会拒绝发布。
- 密钥不进入 Git、shell history、进程参数、数据库自定义 GUC 或共享日志。

## 使用方式

1. 打开 canonical [部署指南](./docs/部署指南.md)。
2. 核对[发布整改台账](./docs/release-remediation-2026-09-10.md)的候选验证与未关闭项，
   再按[前置清单](./docs/上线前置操作清单.md)确认适用的存量约束和不可逆步骤。
3. 只执行 runbook 中与目标环境和 release SHA 匹配的流程。
4. 使用[部署 smoke 清单](./docs/deployment-smoke-checklist.md)保存验证证据。
5. 遇到本地开发问题先查 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)；生产问题以部署 runbook 为准。

如果部署命令或拓扑发生变化，请修改 `docs/部署指南.md`，只在入口或资料地图变化时修改本文件。

2026-09-10 本次仅复核发布资料入口与审查状态：整改规划不等于修复完成，仓库 CI 目前也未执行浏览器发布门禁。
本文其余部署拓扑的历史核对日期保持不变；实际放行须依据同一候选的新证据。
