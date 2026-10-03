# 2026-10-03 Analytics 生产发布记录

## 发布结果

用户明确要求部署生产。生产于 **2026-10-03 19:21:23（上海时间）**恢复服务与四条定时任务，运行主分支合并提交 `c5983b8906ffb80ced252cb36d1d3072f5bd1ec4`，上一版本为 `deb6c2b20ff9bea3c5961a8d31712674674725ec`。

地址：https://bag.sshapi.cn/owner/analytics 。本次发布包含 [PR #45](https://github.com/zora4523-bot/print-shop-erp/pull/45) 的经营分析重构、CSV 导出、派单事实校验错误提示及必要测试与清理。没有新增数据库迁移、依赖或生产配置项；188 条迁移的文件校验值全部匹配，无无效索引，没有运行 seed 或业务数据清理。

Web、LIGHT、HEAVY 均 online 且版本一致；公网与本机 live/ready 均 200，数据库正常。jobs 返回 ok，PDF ready，智能机器人 CONNECTED，身份匹配，队列为空且无告警。3000 仅监听 127.0.0.1。保留 `PDF_ORDER_MODE=queued`，原四条 crontab 恢复后逐字节一致。

## 候选证据

- [PR Quality 37114785741](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37114785741) 的 14 项适用检查成功；[main Quality 37115857008](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37115857008) 在目标 SHA 上成功，包含主分支完整九视口检查。按触发条件跳过的检查不计为重新执行。
- Claude Code 复审及本地验收见 [功能验收](2026-10-03-analytics-release-acceptance.md)、[对抗审查](2026-10-03-analytics-acceptance-claude-review.md)、[CI 修复复审 9.4/10](2026-10-03-analytics-ci-remediation.md)。发布没有修改应用源码。
- 从目标 SHA 的源码归档构建，源码树为 `b6177682b7fdd6e7c4228e247c6df53ec7edf59b`。隔离 Linux amd64 / Node 24.21.0 / pnpm 10.33.1 构建通过，包含类型检查和 69 个静态页面。没有在生产机编译。
- 第一次类型检查触及默认约 2 GiB V8 上限，调整至 4 GiB 后通过；随后页面收集因缺少 DATABASE_URL 中止，补充仅指向构建容器本机的占位地址后完整构建成功。容器内存上限 6 GiB，构建只有一个页面收集 worker。保留两条既有文件追踪警告，没有关闭类型检查。
- 运行包约 289 MiB，SHA256 `c99a05cb15622d11307de7641e972f9e0d81aaa8bed0594025f842752b4ea405`，上传后校验一致；Build ID `9smHy-4GQS0gvIHBM-PXM`。包内没有环境文件；候选 `.env` 从生产原文件复制，只更改 APP_VERSION。

## 备份、演练与切换

生产逻辑备份成功恢复到独立 `erp_analytics_rehearsal_20261003`。候选连接该副本，188 条迁移校验值匹配、无无效索引。影子 Web 只监听 127.0.0.1:3156，使用随机会话密钥、mock 通知，不启动 worker。

影子与正式环境分别完成相同的只读检查：管理员 22 个页面请求、销售 4 个页面请求均 200，包含五个分析视图与派单页，无页面错误边界；管理员五种 CSV 导出均 200，内容与私有缓存头通过，销售五种导出全部返回 401。使用既有账号的短时内存会话，没有保存凭据、创建测试账号或工单。

19:20:13 开始暂停 cron 与三个应用进程。HEAVY 已记录 draining/stopped，但进程仍存在；确认 PID、工作目录、运行任务为零及应用数据库连接为零后，结束该残留进程。19:20:39 确认全部旧写进程与端口监听消失。

停写后再次执行逻辑备份，比较备份前后 108 张 public 表的完整行摘要与数量，全部一致。发布前、最终备份与发布后，pgBackRest 双仓库 check 均通过；即时 info 快照通过两仓库 30 小时备份新鲜度及 WAL 覆盖检查。此次没有待执行迁移，切换前再次核对迁移校验值，然后更换应用目录、启动三个同版本进程。

连接稳定门禁、ready、jobs、版本及公网检查通过后保存 PM2，并恢复原 crontab。维护窗口约 **70 秒**，按暂停 cron 至恢复时间计算，不等于精确 HTTP 中断时长。

## 上线后检查与限制

- `deploy-smoke.mjs --skip-build --require-base-url` 通过：Prisma schema/迁移状态、索引、通知与 durable 配置、PDF 字体及私有产物、路由、无效 cron 凭据拒绝和 jobs。seed 未启用。
- 产品 PDF 探针输出 29,675 字节；生产系统 Chromium 生成 77,098 字节中文合成 PDF，下载后栅格化检查确认中文和公式正常。
- 后续复核三个进程 PID 保持 1393687 / 1393688 / 1393694，重启计数保持 19 / 17 / 11；线上 Git 工作区干净，188 条迁移校验值一致，无无效索引。
- 演练库已删除，两条临时 HBA 规则已移除，配置恢复到原文，HBA 错误为零；双仓库归档再次检查通过。
- 既有应用机约 1.6 GiB 内存、Sentry 未配置的限制仍在。此次没有执行正式工单写入全链路、真实群消息实收、新 OSS 文件上传、实际 CDR 转换、实体打印或手机扫码；只读页面、合成 PDF 与连接状态不替代这些业务验收。

应用机 `/root/erp-analytics-release-20261003/` 保存运行包、候选源码 bundle、检查脚本和发布日志；数据库机 `/var/backups/erp-analytics-20261003/` 保存备份、108 表摘要、恢复日志及归档检查。旧应用目录保留在 `/var/www/print-shop-erp-before-analytics-20261003`。密钥、环境文件、会话及生产数据不入 Git。
