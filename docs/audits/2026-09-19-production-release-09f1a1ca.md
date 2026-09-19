# 2026-09-19 生产应用版本切换（0e6c009b → 09f1a1ca）

状态：2026-09-19 17:29（上海时间）完成生产切换，上线后检查通过。正式地址：https://bag.sshapi.cn。执行人：Claude Code（业主逐步授权，切换前业主明确回复「切」）。流程与 [2026-09-17 发布](./2026-09-17-production-application-release.md) 相同，复用当时留在服务器 `/root/erp-release-20260917/` 的脚本。

## 版本与范围

- 旧版本 `0e6c009b014757b011c0b4fce2a37a72d2435cef`（PR #22）；新版本 `09f1a1cae0f13b63b5d0e540dd60920147d48aa7`（`main`，PR #20 `78e49183` + PR #23 `09f1a1ca`），共 92 个提交。
- CI：PR #23 run [35423982889](https://github.com/zora4523-bot/print-shop-erp/actions/runs/35423982889) `verify` / `print-darwin` 全绿，head `00baf758`；`main` 头为其 merge commit。
- 数据库：156 → 158 条迁移，均为纯新增——`20260918060000_production_report_disputes`（新表）、`20260918120000_order_design_groups`（`OrderItem.designGroupKey` 可空列）。依赖（`pnpm-lock.yaml`）无变化。未运行 seed，未发布价目 / 工价（本次不需要）。
- 功能范围见 HANDOFF 2026-09-18 ～ 09-19：分层设计规格与批量建单、120g 退役拦截、烫金显示名反查、收货地址粘贴识别、跳转回执、内部工单物流自动计价、报工异议、师傅端调整；grok 对抗审查后的 5 处修复；业主 2026-09-19 拍板的 4 项（到付清零补录运费、冲正 = 作废原报工、师傅工资页口径、寄样最小包装档）。

## 预发布

- 运行包在本机 Docker（`node:24-bookworm`，linux/amd64，`--cpuset-cpus=0,1 --memory=4g`，`NODE_OPTIONS=--max-old-space-size=2560`，构建期仅占位 `DATABASE_URL` / `AUTH_SECRET`）构建；应用机只有 1.6 GiB 内存，不在其上构建。`BUILD_ID=RsMZR9qyC1-2GmWodYbo1`。归档含 `.next`（去 cache）/ `node_modules` / `generated`，不含任何 `.env`；SHA256 `0771970642dae529704b853c81d7bb0e3ef747b4b2bcaf3c29dc9eb7c28a5f11`，上传后服务器端校验一致。
- 候选目录 `/var/www/print-shop-erp-release-09f1a1ca`：由 git bundle 检出固定 SHA、工作区干净；拷贝现有 `.env`（600）并由 `prepare-release-env.cjs` 写入版本与 durable / 非 mock 配置。`check-env` 通过（仅 Sentry 未配置的既有警告）。`prisma migrate status` 确认恰好 2 条待应用、无漂移。
- 备份健康：切换前 pgBackRest 两仓库当日 01:00 / 01:32 full，`check-backup-readiness` 通过。
- 逻辑备份 `/var/backups/erp-20260919/formal-before-09f1a1ca.dump`（1,075,798 字节），用它 `pg_restore` 出演练库 `erp_release_rehearsal_20260919`——同时证明备份可恢复。
- 演练：临时 HBA 规则（`hostssl erp_release_rehearsal_20260919 erp_app 47.110.247.150/32`，原文件备份为 `pg_hba.before`）；候选包对演练库 `migrate deploy` 156 → 158 成功；数据核对：1 ADMIN + 3 SALES、统一烫金工价第 1 版（局部 0.007/12/5，专版 0.01/20/10）完好，工单 / 账单 / 报工均为 0。
- 影子进程（`127.0.0.1:3156`，`--max-old-space-size=256`，连演练库）：`/login` 200，受保护路由 307，db ok。影子 `ready` 为 503 属环境原因（影子进程不持有企业微信连接、无同版本 worker），线上应用全程正常。

## 正式切换

- 17:25:01 停止 Web / LIGHT / HEAVY，三个 pid=0、3000 端口无监听、任务队列为空、库上 `erp_app` 连接数 0。
- 停写后逻辑备份 `/var/backups/erp-20260919/formal-pre-09f1a1ca.dump`（1,075,597 字节）；`pgbackrest check` 通过；手动 full：repo1 `20260919-172512F`、OSS repo2 `20260919-172531F`，两个 service 均 `Result=success / ExecMainStatus=0`；备份门禁通过后才写 `final-backup-09f1a1ca.ok`。
- `cutover-app.sh`（09-17 脚本，仅改旧目录名、标记文件路径，去掉两行价目 / 工价发布）：正式库 `migrate deploy` 两条迁移成功；旧目录保存为 `/var/www/print-shop-erp-before-20260919`（仅作证据，**不可**对已迁移的库回滚旧代码）；`pm2 startOrReload`、`ready` 200、jobs gate「stable connector accepted: CONNECTED」、`pm2 save`。17:29:44 完成，停机约 4 分 40 秒。
- 与 09-17 相同的已知现象：PM2 沿用旧的 `APP_VERSION` 进程环境，`live` 仍报 `0e6c009b`。按当时做法 `APP_VERSION=<sha> pm2 restart … --update-env`，再等 ready + jobs gate、`pm2 save`。

## 上线后检查

- `post-cutover-check.cjs`：三个进程 online、版本均为 `09f1a1ca…`、cwd 为 `/var/www/print-shop-erp`；本机与公网 `live` / `ready` 均 200、版本一致、db ok；3000 端口仅绑定 127.0.0.1。
- `deploy-smoke.mjs --skip-build --require-base-url`（禁止 seed）通过：schema 最新、`NOTIFICATION_MOCK_MODE=false`、durable、系统 Chromium 可用、公网路由与 `/api/health/jobs` ok。
- 公网（从开发机）：`/login` 200，未登录访问 `/owner`、`/worker/tasks` 均 307。`ready`：inventory ok、jobs 全 0、smartBot `CONNECTED`、无 warnings。
- 正式库：158 条迁移、1 ADMIN + 3 SALES、烫金工价第 1 版完好、工单 / 账单 / 报工为 0。
- 进程稳定：切换后重启计数不再增长。

## 收尾与已知范围

- 已删除演练库与临时 HBA 规则；`pg_hba.conf` 与发布前备份逐行一致，HBA 错误数 0。`erp_release_rehearsal_20260916` / `_20260917`、`erp_cleanup_rehearsal_20260917` 及 20260916 的一条 HBA 规则是此前遗留，本次未动。
- 本次为发布给数据库主机 `root` 的 `authorized_keys` 增加了开发机公钥（业主亲自执行）；不再需要时删除该行即可。
- **未做**：登录后的各角色页面逐页检查（不持有、也不应经手任何账号密码）；真实报工 / 建单写入（不污染生产）；实体手机扫码；企业微信真实消息实收；Sentry 仍未配置；包装计件工价仍暂缓。未验收项目不得写成已验收。
- 证据：服务器 `/root/erp-release-20260919/`（cutover.log、rehearsal-migrate.log、shadow-runtime.log、deploy-smoke-final.log、pm2-pin-version.log）；数据库主机 `/var/backups/erp-20260919/`。文件中不记录密钥或完整连接串。
