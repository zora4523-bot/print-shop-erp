# 2026-10-04 生产入口简化发布记录

## 发布结果

用户明确授权部署到生产环境。生产于 **2026-10-04 00:58:22（上海时间）**恢复服务与四条应用 cron，运行 `f084d34e5eaa7d991f003a60ca1bf49cbee3a22f`（[PR #46](https://github.com/zora4523-bot/print-shop-erp/pull/46)）。上一实际生产版为 `c5983b8906ffb80ced252cb36d1d3072f5bd1ec4`，以主机 Git、进程环境和 live 响应核实，未沿用较早文档中的 `deb6c2b2` 快照。

生产地址：https://bag.sshapi.cn。

上线包含自动准备工单、取消独立下发入口、厂内直接安排师傅、寄样直接履约及外协工单处理，以及 CI 发现的看板卡宽和验收定位修复。没有 schema、迁移、依赖或部署配置变化，保留 queued PDF、durable 后台任务和原有四条 cron。

## 候选与构建

- [最终 PR Quality](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37128815191) 与 [macOS 打印](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37128815185)：15 项适用检查通过。实现 Claude 对抗复审 9.2/10，CI 修正增量复审 9.3/10，原文见 [审查记录](2026-10-03-production-entry-claude-review.md)。
- [main Quality](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37129548704)：静态和完整九视口门禁通过；业务/响应式 280 项通过、8 项配置跳过；视觉夹具 19 项通过、8 项配置跳过。未运行项不计通过，完整业务/单测等由上述 PR CI 覆盖。
- 精确导出合并 SHA，在 Linux amd64 / Node 24 隔离容器构建，完整类型检查通过；没有在低内存生产机编译，没有使用测试环境构建包。
- Build ID：`yIRDc3_M26Qm21V-9PEW1`。运行包 314,068,213 字节，SHA256：`b307db2f6294ee596f6510c5f0e194dfb71f69b56f7ffb54770aad27db9bbb3f`，上传后逐字节摘要匹配。包仅含 `.next`、Linux dependencies 和生成的 Prisma Client，不含生产环境文件。
- 候选 `.env` 与旧版逐项比较，仅 APP_VERSION 改为发布 SHA；`PDF_ORDER_MODE=queued` 保持不变。环境预检通过，Sentry 缺失仍是既有警告。解包时 GNU tar 忽略 macOS/Docker ownership 扩展属性，命令成功且后续运行验证通过。

## 数据与存量检查

- 正式库及副本均为 188 条已完成迁移；源文件 SHA256 逐条匹配，无失败迁移、回滚迁移或无效索引。本次不执行迁移和 seed。
- 发布前逻辑备份恢复到独立 `erp_production_rehearsal_20261004`；新版影子服务只监听 loopback、使用随机会话密钥及 mock 通知，不运行 worker。检查前后 108 张表行数和完整行摘要一致。
- 正式库和副本均用候选 `repair-legacy-production-entry.ts` 执行 dry-run，待处理状态工单数均为 **0**。停写后再次确认正式库为 0；没有执行 `--apply`、生产补录或批量推进状态。
- 停写后完成最终逻辑备份，备份前后 108 表摘要稳定。切换后只有 `BackgroundWorkerHeartbeat` 发生预期变化，其余 107 表摘要一致。
- 发布前、最终备份和演练清理后，postgres 账号执行的双仓库 `pgbackrest check` 通过；两次即时 info 快照通过双仓库、30 小时 full 新鲜度与 WAL 覆盖门禁。最终快照最近 full 为 `20261003-010004F` 与 `20261003-013005F`。这不替代长期连续归档监控或完整集群时间点恢复演练。

## 切换与线上验证

- 00:55:49 开始暂停四条应用 cron，停止 Web/LIGHT/HEAVY。HEAVY 已记录 draining/stopped，运行任务与应用 DB 连接均为 0，但旧进程仍残留；核对 PID、工作目录与 PM2 身份后终止该残留进程。00:57:26 确认旧写进程及 3000 监听消失。
- 最终备份和候选复检通过后，目录切换并以统一 APP_VERSION 启动三个进程。机器人 CONNECTED 稳定门禁、live/ready 与版本检查通过后保存 PM2 并恢复原 crontab；前后逐字节一致。维护窗口 153 秒，从准备暂停 cron 至恢复计，不等同于精确 HTTP 中断时长。
- Web、LIGHT、HEAVY 均 online、同一发布 SHA；后续复核 PID 保持 `1406011 / 1406017 / 1406024`，重启计数保持 `19 / 17 / 11`。3000 只监听 `127.0.0.1`；本机和公网 live/ready 均 200。
- 正式 `deploy:smoke --skip-build --require-base-url` 通过，seed 禁用；包含迁移状态、索引、真实通知配置、durable、PDF 字体/渲染/私有产物存储、路由、无效 cron token 和 jobs 门禁。PDF 产品探针输出 29,675 字节。
- 影子与正式环境均完成 38 项登录态检查：管理员/销售共 28 个页面（含安排生产、两张真实工单详情、Analytics 五个视图），管理员五种 CSV 导出正常，销售五种导出访问均被 401 拒绝。使用既有账号的短期 JWT，未创建账号、保存会话或修改业务数据。
- 系统 Chromium 另外生成 77,098 字节中文合成 PDF，下载栅格化后目视确认中文与公式可读。
- 演练库已删除，两条临时 HBA 规则撤销；配置与前态完全一致，HBA 错误 0，归档复查通过。

## 证据与限制

应用机 `/root/erp-production-release-20261004/` 保存运行包、源码 bundle、部署/影子/正式页面/PDF 日志、环境和版本检查脚本、cron 前后及时间标记。数据库机 `/var/backups/erp-production-20261004/` 保存初始/最终逻辑备份、108 表摘要、HBA 前态与备份检查。开发机临时证据在 `/tmp/erp-production-release-20261004/`；敏感配置、业务备份、会话和运行包不入 Git。

未执行生产新建工单、安排/报工/发货写入全链路、真实群消息实收、新 OSS 直传、实际 CDR 转换、实体打印或手机扫码。本次部署以已有 CI 功能验收、生产副本与线上只读/运行时探针为证据，不将 mock、CONNECTED 或合成 PDF 冒充这些真实业务验收。Sentry 未配置、应用机约 1.6 GiB RAM 的既存限制保留。

旧目录保留为 `/var/www/print-shop-erp-before-production-20261004`。本次没有数据库迁移或存量修复；若后续需要回退，仍须先检查上线后的新业务写入兼容性，不直接整库恢复或删除历史。
