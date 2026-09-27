# 2026-09-27 生产发布记录（b658328c）

状态：2026-09-27 13:23（上海时间）完成正式切换，上线后检查通过。正式地址：https://bag.sshapi.cn。

## 版本与授权

- 目标：主分支 PR #27 合并提交 `b658328c02d1434dc97f03fc34dd9dcfa12f63b7`；旧生产运行 `ef6fa012ffdff08d168dafe71d33ee87c2a72915`。
- 业主明确要求部署生产，演练通过后回复“切”；定时任务选择“只删三行”（见下文 crontab）。
- PR #27 在 `4738d8d8` 上 15 项检查全绿，之后只追加一个仅改文档的提交 `1fa0d297`（与合并提交源码树一致）；主分支 run 在 `b658328c` 上 static 与六视口全量 `viewports-main` 均通过，其余 job 按设计仅 PR 触发。
- 本批带 6 条迁移（160 → 166）：`20260921100000_production_report_generation_guard`、`20260922100000_secure_cdr_bundle_tokens`、`20260924100000_remove_cleaner_cook_cleaning`、`20260924110000_remove_customer_service_role`、`20260924150000_prune_removed_sensitive_column_policies`、`20260927100000_order_overdue_template_external_sales`。

## 已完成的预发布验证

- 正式库只读预检：160 条迁移、无未完成迁移。两条 fail-closed 迁移（删除清废 / 厨师、删除客服）的 24 项预查全部为 0；知情查询：已删除功能的历史任务只有 `CRON_CS_PERIOD_ENDING` 45、`CRON_CS_SETTLE` 45、`CRON_HOURLY_PAYROLL` 1，全部 `SUCCEEDED`，无排队。正式库工单、账单、报工、CDR 包均为 0；4 个账号（1 管理员 + 3 销售）。
- 逻辑备份 `/var/backups/erp-20260927/formal-before-b658328c.dump` 用 template0 恢复为独立演练库 `erp_release_rehearsal_20260927`，恢复后数据摘要与正式库逐项一致；临时增加一条仅限应用机公网 IP 的 `hostssl` 规则访问演练库。
- 演练库在旧结构上重跑预查仍全为 0；用候选运行包执行 `prisma migrate deploy`（带 `lock_timeout=5s`、`statement_timeout=120s`，输出过滤连接串）：160 → 166 成功，无失败迁移、无无效索引；三条删除迁移已记录、悬空脱敏策略为 0；逾期通知模板（旧默认原文）改为“外部销售：{externalSalesName}”。
- 演练前后摘要：工单、账单、报工、价目簿、价格规则、计件工价、材料、账号、通知通道一致；只有迁移数与通知规则变化（15 → 13，删除两条客服事件规则；逾期模板改写）。
- Linux 构建（Docker `node:24-bookworm` linux/amd64，`CIRCLE_NODE_TOTAL=2`）：首次在 4 GB 内存下 `next build` 的类型检查阶段报“Failed to type check”而无具体错误；本机与容器内单独 `tsc -p tsconfig.release.json`（先 `next typegen`）均通过，改为 6 GB 容器、4 GB 堆后完整构建通过，未跳过类型检查、未改应用配置。打包时 `.next/cache` 的排除规则写错，改为从原归档过滤复制出不含缓存的运行包（311 MB，SHA256 `fd61ce7639cf0665c6dcec9093ec78dea67bd29e8d982ceab94afcf8eb2af3c0`），上传后服务器端一致。
- 候选目录 `/var/www/print-shop-erp-release-b658328c`：由 git bundle 检出目标 SHA、工作区干净，复制正式 `.env` 后按发布脚本写入版本与运行参数；生产 `check-env` 通过（NODE_ENV 未设为既有提示，PM2 会设置）。
- 候选运行包连接演练库的影子进程（127.0.0.1:3156、随机会话密钥、通知 mock、不起 worker）：管理员 13 个页面、销售 4 个页面均 200，无错误边界；工单列表无“按产品客户筛选”、搜索框为新文案；逾期规则页显示外部销售模板；`/owner/pigsty` 不再报缺失列。
- 生产 Chromium 真实生成 77,098 字节中文 PDF，截图中文字形正常；不代替真实工单图稿、实体打印或手机扫码验收。
- 历史数据清理脚本在演练库 dry-run：M-7、L-14 均为 0。
- 两份 pgBackRest full：repo1 `20260927-131753F`、OSS repo2 `20260927-131813F`，服务均 `Result=success / ExecMainStatus=0`；备份 JSON 快照通过仓库 readiness 检查（2 个仓库、30 小时内、WAL 覆盖）。

## 正式切换与复核

- 13:22:07（上海时间）暂停 7 条应用 cron、停止 Web / LIGHT / HEAVY，pid 均为 0，3000 无监听；数据库应用账号连接数为 0。
- 停写后逻辑备份 `/var/backups/erp-20260927/formal-pre-b658328c.dump` 完成，`pgbackrest check` 通过；停写前后数据摘要一致；正式库在旧结构上再跑预查全部为 0。
- 13:22:41 迁移 160 → 166；13:23:13 切换完成（停机约 66 秒）。旧目录保存在 `/var/www/print-shop-erp-before-20260927`，仅作证据，不能对已迁移数据库直接回滚旧代码。
- 三个 PM2 进程 online、同一 SHA，`APP_VERSION` 固定后 `pm2 save`；企业微信智能机器人通过 CONNECTED 门禁；本机与公网 live / ready 均 200；3000 仅监听 127.0.0.1。重启计数的增加全部来自计划内的停止 / 启动 / 重启（退出码 0、SIGINT），13:22:43 之后无新增重启，错误日志无新增。
- 13:24:05 恢复 crontab：按业主选择只删除已下线的 `cs-settle`、`cs-period-ending`、`hourly-payroll` 三行及其注释，其余 4 行（`daily-salary`、`outsource-overdue`、`order-overdue`、`generate-bills`）与环境行逐字保留；示例中生产从未安装的 `pending-factory-backlog`、`production-alerts`、`order-export-cleanup` 仍不安装。cron 包装脚本换为仓库现行版本（密钥经 stdin 传给 curl，不再出现在进程命令行；已下线端点返回 64 拒绝），旧版本留存 `/root/erp-release-20260927/print-shop-erp-cron.before`。
- 13:24:26 nginx 同步 `erp_redacted` 访问日志格式（遮蔽 CDR 下载 token），`nginx -t` 通过后 reload；用伪造 token 请求验证访问日志只记 `/api/cdr/bundles/[token]`。原配置留存 `/root/erp-release-20260927/nginx-print-shop-erp.conf.before`。
- 正式库验收：166 条迁移、三条删除迁移已记录、悬空脱敏策略为 0；停写前后摘要只有迁移数与通知规则变化，与演练结果一致（通知规则排除 `updatedAt` 后逐行相同）。
- 正式环境管理员 13 个页面、销售 4 个页面均 200（已有账号的 120 秒内存会话，仅读取，不保存凭据或测试数据）。`deploy-smoke`（skip-build、禁止 seed）通过：schema 最新、索引有效、通知真发模式、durable、Chromium、公网路由与 jobs。
- 历史数据清理脚本在正式库 dry-run：M-7、L-14 均为 0，无需 `--apply`。运维核对：已删除类型的死信任务 0 条，客服周期事件无通知日志，无排队任务。
- 演练库已删除；`pg_hba.conf` 恢复为执行前原文（逐字节一致），HBA 错误为 0。Docker 恢复本任务开始时的关闭状态。

## 验收边界

- 真实消息实收、真实 CDR 转换、OSS 新文件直传、实体打印及手机扫码未在本次执行，不冒记为验收通过；清单“五、业务验收”仍待业主。
- CDR 旧链接失效只影响已发出的 READY 包，正式库 CDR 包为 0，无需重新生成。
- Sentry 仍未配置。

## 未清理的历史遗留（非本次产生，未处理）

- 数据库机：旧演练库 `erp_release_rehearsal_20260916`、`erp_release_rehearsal_20260917`、`erp_cleanup_rehearsal_20260917`，以及 `pg_hba.conf` 中 09-16 的临时演练规则。
- 应用机 `/var/www/`：`print-shop-erp-before-20260917/19/21/27`、`print-shop-erp-release-{093aa3c2,52a3dc3e,f5dcd074}`、`print-shop-erp-loadtest`（磁盘剩余约 18 GB）。

## 证据位置

- 本机会话临时目录：固定 SHA 源码、Linux 构建日志、发布脚本副本（会话结束后不保留）。
- 应用机 `/root/erp-release-20260927/`：候选 bundle 与运行包、发布脚本、演练迁移日志、影子与正式页面检查、切换日志、crontab 前后、cron 包装与 nginx 前态、清理 dry-run 结果。
- 数据库机 `/var/backups/erp-20260927/`：两份逻辑备份、数据摘要（正式 before / pre / after、演练 before / after）、`pg_hba.before`、备份信息快照与检查日志。
- 密钥、环境文件、运行归档及生产数据不进入仓库。
