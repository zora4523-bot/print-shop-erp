# 2026-10-03 生产发布记录

## 结果与范围

业主授权「创建 PR 提交到仓库，并且部署到生产服务器」。[PR #43](https://github.com/zora4523-bot/print-shop-erp/pull/43) 已合并；生产于 **2026-10-03 03:21:36（上海时间）**恢复服务与四条应用定时任务，运行 `deb6c2b20ff9bea3c5961a8d31712674674725ec`。上一生产版本为 `c3908b1ce0ee2f095cb78d55fd97db8d916c1394`。

本次上线包含 main 自上一生产版以来的累计改动，以及折叠侧栏裁切修复。不是只部署侧栏 CSS。正式库从 179 升至 188 条迁移；停写后至迁移完成，108 张既有表按迁移前列集合计算的数量和完整行摘要一致。没有执行 seed、业务清理、价格发布或人工生产补录。

- 生产地址：https://bag.sshapi.cn。
- Web、LIGHT、HEAVY 同一 SHA、online；本机和公网 live/ready 均 200；3000 仅监听 loopback。
- jobs 门禁通过，PDF 就绪、智能机器人 CONNECTED；恢复的四条 cron 与发布前逐字节一致。
- 继续使用后台 PDF 处理，显式设置 `PDF_ORDER_MODE=queued`；未开启 direct 模式。除固定发布 SHA 和明确 PDF 模式外，候选与原 `.env` 配置一致。

## 候选验证

- [PR Quality](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37047171356)：14 项适用检查通过。单测 8593 通过、46 个既有跳过；包含静态、浏览器组件、生产构建、业务 E2E、兼容性、durable worker 和代表视口检查。
- [main Quality](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37048608058)：静态与完整九视口门禁通过；业务/响应式检查 253 通过、8 跳过，视觉夹具 19 通过、8 跳过。跳过项不计通过。
- 侧栏本地专项 62/62 浏览器测试、lint/typecheck 通过，详见 [侧栏 QA](2026-10-03-sidebar-collapse-qa.md)。
- Linux amd64 / Node 24 隔离构建成功，包含完整类型检查。首次 4 GiB 容器 OOM（137），调整构建容器至 6 GiB 后成功，未在生产机编译。
- 运行包从 `b72a5e1f` 构建；与合并版本仅 `HANDOFF.md` 不同，可执行源码、锁文件、迁移均相同。影子与正式进程均以合并 SHA 运行并通过版本检查。
- 运行包约 290 MiB；SHA256 `05a99f7ee837e4f56208c4e24b16ba099b91c2282cc84fa778e806efe7a60ed9`，上传后匹配；Build ID `T14lNfqJe0Eo0rTnUQWVr`。包内不含生产环境文件。

## 数据库与演练

正式库已应用的 179 条迁移校验值逐条匹配。逻辑备份恢复至独立 `erp_release_rehearsal_20261003`，演练全部 9 条新增迁移后，108 张既有表数量和原有列数据摘要一致；已应用 188 条迁移；失败迁移及无效索引均为 0。

新增迁移：`20260930100000_agent_bill_settlement_detail`、`20260930160000_pdf_worker_capability`、`20261001100000_switch_performance_indexes`、`20261001110000_list_ordering_indexes`、`20261001120000_agent_bill_surcharge`、`20261002090000_cdr_workbench_manifest`、`20261002093000_cdr_bundle_order_membership`、`20261002100000_agent_bill_cancellation_detail`、`20261002100000_order_print_attempt`。

影子服务仅监听 127.0.0.1:3156，连接演练库、随机会话密钥、mock 通知，不启动 worker。既有管理员 17 页、销售 4 页均返回 200，无错误边界；未保存会话或创建测试账号。正式环境重复同一组只读页面检查，全部通过。

两个备份仓库最近 full 分别为 `20261003-010004F` 与 `20261003-013005F`。发布前、最终备份及发布后，以 postgres 账号执行的 pgBackRest check 均通过，双仓库 30 小时新鲜度与 WAL 覆盖门禁通过。第一次以 root 执行 check 因数据库角色不匹配失败，改用既有 postgres 运维账号后通过，未扩大数据库权限。

## 切换与验收

- 03:19:29 准备暂停四条 cron；停止 Web、LIGHT、HEAVY。旧 HEAVY 已记录 draining/stopped，任务与应用数据库连接均为 0，但进程仍未退出；核对 PID 与工作目录后终止该残留进程。03:20:37 确认所有旧写进程与 3000 监听已消失。
- 停写后完成最终逻辑备份，复核备份前后摘要稳定、双仓库归档与 WAL 门禁，然后正式迁移。迁移后、启动新进程前再比对 108 张既有表，全部一致。
- 新版 Web/LIGHT/HEAVY 启动后通过 ready、jobs、连接稳定性、同 SHA、公网及 loopback 检查，再 `pm2 save` 并恢复原 crontab。维护窗口约 127 秒（从准备暂停 cron 至恢复，不等于精确 HTTP 中断时长）。
- `deploy-smoke.mjs --skip-build --require-base-url` 通过：schema、迁移、索引、真实通知配置、durable、PDF 字体与产物探针、公网路由和 jobs。seed 明确禁用。
- 系统 Chromium 真实输出 77,098 字节中文合成 PDF，栅格化后核对中文字形及公式正常；产品 PDF 探针输出 29,675 字节并通过产物存储检查。
- 后续复核三个进程 PID 与重启计数均未变化，188 条迁移、失败迁移 0、无效索引 0。
- 演练库已删除，两条临时 HBA 规则已撤销，配置与原文完全一致、HBA 错误 0；发布后 pgBackRest check 通过。

## 证据与限制

应用机 `/root/erp-release-20261003/` 保存运行包、源码 bundle、配置/迁移/切换/smoke 日志、SHA 与构建信息、crontab 前后及进程状态。数据库机 `/var/backups/erp-20261003/` 保存前后逻辑备份、108 表摘要、HBA 前态和备份检查。敏感环境文件、备份及会话不入 Git。

Sentry 仍未配置，应用机仍为约 1.6 GiB RAM；这些既存限制没有在本次修复。未执行正式工单写入全链路、真实群消息实收、新 OSS 文件直传、实际 CDR 转换、实体打印或手机扫码。只读页面 smoke、合成 PDF 和 CI 不替代这些真实业务验收。

旧目录保留在 `/var/www/print-shop-erp-before-20261003`。数据库已前向迁移，不能直接启动旧代码恢复写入；异常以前向修复处理，整库恢复需另行授权。
