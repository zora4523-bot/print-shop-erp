# 红包印刷 ERP 系统

内部工具，服务于佛山某红包印刷厂的生产、销售、薪资、库存全流程数字化。

---

## 📂 文档结构

| 文件 | 作用 | 读者 |
|---|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | 当前系统边界、分层、进程与数据流 | 开发 / 评审 |
| **[DEVELOPMENT.md](./DEVELOPMENT.md)** | 本地安装、命令、测试与开发循环 | 开发 |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | 编码、迁移、测试、评审与发布记录规则 | 贡献者 |
| **[docs/编码规范.md](./docs/编码规范.md)** | 分层、表单/授权边界、金额真值与防回归编码要求 | 开发 / 评审 |
| **[发布整改任务台账](./docs/release-remediation-2026-09-10.md)** | 发布审查项的阶段、依赖、责任角色、验收与现行状态 | 开发 / 测试 / 发布负责人 |
| **[发布审查快照](./docs/audits/2026-09-10-release-readiness.md)** | 2026-09-10 测试结果及逐功能矩阵；后续状态看任务台账 | 开发 / 验收 |
| **[API.md](./API.md)** | Route Handlers 与 Server Actions 契约 | 开发 / 集成 |
| **[DATABASE.md](./DATABASE.md)** | Prisma、迁移、seed、扩展与数据安全 | 开发 / DBA |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | 稳定部署入口；详细步骤指向唯一 runbook | 运维 / Owner |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | 本地开发、Prisma、E2E 与视觉门禁排错 | 开发 / 运维 |
| **[UI-SYSTEM.md](./UI-SYSTEM.md)** | Token、组件分层、页面状态与视觉验收 | 设计 / 开发 |
| **[docs/UI-DESIGN-COVERAGE.md](./docs/UI-DESIGN-COVERAGE.md)** | 85 页设计证据等级、实现覆盖与视觉验证边界 | 设计 / 开发 / 验收 |
| **[docs/UI-REMEDIATION-BACKLOG.md](./docs/UI-REMEDIATION-BACKLOG.md)** | UI 问题严重度、成本、独立任务与完成状态 | 开发 / 验收 |
| **[docs/UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md](./docs/UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md)** | 提交 `41abe65` 后的 UI/UX 对抗复审、代码证据、独立子任务与 canonical 映射 | 设计 / 开发 / 验收 |
| **SPEC-v1.2.md** | 业务规格（冻结版，权威） | 所有人 |
| **CLAUDE.md** | 开发规范与工作准则 | Claude Code / Codex |
| **prisma/schema.prisma** | 数据库Schema | 开发 |
| **prisma/seed.ts** | 初始化种子数据 | 开发 |
| **PIGSTY-EXTENSIONS.md** | Pigsty 扩展适配与开发计划 | 开发 / 运维 |
| **docs/pigsty-production-activation-runbook.md** | Pigsty 生产扩展启用 runbook | 运维 / Owner |
| **docs/deployment-smoke-checklist.md** | 部署前 smoke 与备份检查清单 | 开发 / 运维 |
| **docs/上线前置操作清单.md** | 当前发布批次的部署前排查、单向门与人工验证 | 运维 / Owner |
| **docs/AGENT-BACKLOG.md** | Agent 自动化开发任务队列 | 开发 / Codex routines |
| **docs/archive/规范合规审查-2026-08-19.md** | CLAUDE.md 规范合规审查快照（含 19 条待处理） | 开发 |
| **docs/AGENT-ROUTINES.md** | Agent 自动 prompt / draft PR 执行协议 | 开发 / Codex routines |
| **CHANGELOG.md** | SPEC 历史；不是产品发布日志 | 所有人 |
| **SPEC-v1.0.md / v1.1.md** | 历史版本（仅归档） | 参考 |

---

## 🚀 启动开发

### 环境要求

- **Node.js 24 LTS**（Krypton，支持至2028-04-30）
- **pnpm 10.33.1**（以 `package.json#packageManager` 为准）
- **PostgreSQL 16**（开发期用本地 PG 或 Pigsty dev 实例，生产用独立 Pigsty）

### 第一次启动

```bash
# 0. 确认 Node 版本
node -v  # 必须满足 package.json 的 >=24

# 1. 从受控仓库 clone；不要重新运行 create-next-app
git clone <repository-url> print-shop-erp
cd print-shop-erp

# 2. 安装锁定依赖并准备本地环境
pnpm install --frozen-lockfile
cp .env.example .env  # 填写专用开发库 DATABASE_URL 与本地 secret

# 3. 应用已有 migration、生成 client、运行 seed
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm db:seed

# 4. 启动开发
pnpm dev
```

完整环境变量、数据库创建、测试和日常命令见 `DEVELOPMENT.md`。

### 首次启动后

1. 打开 `http://localhost:3000`
2. 使用 `SEED_ADMIN_USERNAME` 和本地安全保存的 seed 密码登录
3. 未配置 `SEED_ADMIN_PASSWORD` 时，seed 只在首次创建时打印一次随机密码；不要把输出发到共享日志
4. **首次登录后立刻修改初始密码**

### 开发路径（P0优先级）

> 以下保留最初的 P0 规划背景，不代表当前实现进度；当前开发与验收流程以
> `DEVELOPMENT.md`、`CONTRIBUTING.md` 和实际代码/测试为准。

按以下顺序开发，**每个模块必须端到端完成后再进入下一个**：

1. **认证与用户管理**（1周）
   - 登录、密码管理
   - 管理员管账号（增删改）、角色选择

2. **工艺字典与产品字典**（3天）
   - 工艺管理页面
   - 产品基础管理

3. **工单核心**（2周）
   - 销售/客服：创建工单、多款式、双面双色、工艺多选
   - 上传JPG设计图 + CDR源文件（OSS）
   - 工单列表、详情、修改（按状态限制）
   - 服务端稳定分页、逐项筛选、管理员异步多表 XLSX 导出
   - 状态机严格落地

4. **生产流程**（1周）
   - 管理员：排产、派师傅（按工艺推荐）
   - 外协单管理
   - 工单PDF生成（含任务二维码）
   - 师傅扫码开工/完工
   - 不良/返工记录

5. **薪资系统（核心难点）**（2周）
   - 三套薪资规则配置界面
   - 开机师傅日薪计算（调度时间以 `deploy/crontab.example` 为准）
   - 客服业绩周期累计 + 结算
   - 员工考勤录入

6. **应收账单**（3天）
   - 月度自动生成销售账单
   - 销售查看、管理员登记收款

7. **CDR汇总**（2天）
   - 管理员勾选打包
   - 24小时临时链接

8. **推送与Dashboard**（1周）
   - 企业微信Webhook配置
   - 15个预置事件
   - 管理员Dashboard

9. **测试与上线准备**（3天）
   - 关键流程E2E
   - 性能压测（小规模）
   - 生产部署

**目标总时长：约6周**

---

## 🛡️ 开发边界（必读）

### 不要做的事

见 `SPEC-v1.2.md` 第10章「不做清单」。其中最容易踩坑的：

- ❌ 不要引入Redis/消息队列/Docker等重型基础设施
- ❌ 不要修改技术栈（Next.js + Prisma + PostgreSQL 是固定的）
- ❌ 不要自己猜测业务规则，不清楚就标TODO
- ❌ 不要集成任何未在SPEC中声明的外部系统

### 核心算法的正确性

**薪资算法错1元，管理员的信任会崩塌**。所以：

- 所有薪资算法必须100%单元测试覆盖
- 所有薪资记录必须快照化（改规则不影响历史）
- 所有边界case都要测（小单、超大单、档位边界）

---

## 🎯 验收标准

### 功能验收

- [ ] 销售能在手机上10秒内录完一张简单工单
- [ ] 师傅能在30秒内完成扫码报工
- [ ] 管理员能30秒内汇总当日CDR并拿到分享链接
- [ ] 客服能实时看到自己当前周期的业绩和距离下一档的差额
- [ ] 管理员能在Dashboard上一眼看到今日工单、产量、待发货
- [ ] 急单提交后企业微信群3秒内收到推送

### 技术验收

- [ ] 核心算法测试覆盖率 100%
- [ ] E2E测试覆盖关键路径
- [ ] 所有Server Action有权限检查
- [ ] 所有金额字段用Decimal或integer
- [ ] 所有薪资记录有快照
- [ ] Pigsty/pgBackRest 每日 full、连续 WAL、两份 repository 与恢复演练通过只读门禁

---

## 📞 遇到问题

按优先级：

1. 查 `SPEC-v1.2.md`
2. 查 `CLAUDE.md`
3. 查既有代码的模式
4. 标记 `TODO: 需业主确认` 并暂停该任务

**禁止**：自行假设业务规则继续开发。

---

## 🚢 上线运维（P0 部署清单）

> 可执行部署步骤的唯一入口是 `DEPLOYMENT.md`，详细 runbook 是
> `docs/部署指南.md`。本节包含带日期的历史快照，不应替代目标环境核验。

截至 2026-08-02，`aa42ba0` 已运行在 <https://bag.sshapi.cn>，生产数据库为 45 / 45 migrations。本节记录当前生产口径和后续发布门禁，不再把“首次生产激活”当作待办。

> 当前已确认 Web、LIGHT worker、HEAVY worker、ready 和系统 Chromium PDF 正常；仍需补异地备份 repo2、30 天保留与恢复演练、`SENTRY_DSN / APP_VERSION`，并将 1.6 GiB 应用机升级到至少 4 GiB。生产只有 repo1 不能算备份基线通过。

### 1. 必填环境变量（`.env`）

| 变量 | 用途 | 不配会怎样 |
|---|---|---|
| `DATABASE_URL` | Pigsty PG 连接串 | 应用起不来 |
| `AUTH_SECRET` | Auth.js 会话签名 | Auth.js 拒启 |
| `AUTH_TRUST_HOST` | Nginx 反代场景必填 `"true"` | 登录跳转失败 |
| `CRON_SECRET` | Web/worker 服务端校验 cron endpoints 的 `Authorization: Bearer <secret>` | 10 个 `/api/cron/*` 全部 503 |
| `BACKGROUND_JOBS_MODE` | 生产设 `durable`，通知/cron/PDF/CDR/工单导出进 PostgreSQL 任务账本 | `inline` 会失去持久重试和资源隔离 |
| `ORDER_EXPORT_ARTIFACT_DIR` | Web 与 HEAVY worker 共享的私有 XLSX 目录，单机建议 `/var/tmp/print-shop-erp/order-exports` | 留空回退到系统临时目录；多机或临时目录清理后待下载文件会丢失 |
| `AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR` | Web 与 HEAVY worker 共享的月账单 XLSX 私有目录，必须与工单导出目录分离 | 留空回退到独立系统临时目录；多机部署时会无法稳定下载 |
| `APP_PUBLIC_URL` | 应用公网根 URL（含 protocol，无尾斜线）。**生产强烈推荐显式配置**——尤其 split-origin（staff 内网 + 外协公网）；留空仅适合 dev / 单域名生产，从请求 headers 推 | 留空：**打印单二维码（师傅微信扫码报工）** 与 CDR 外协短链跟随访问域，split-origin 时师傅/外协拿到内网死链；单域名若 Nginx 漏传 `X-Forwarded-Proto` 也会退化成 localhost 死链 |
| `NOTIFICATION_MOCK_MODE` | 企业微信推送真发开关 | 生产显式设 `"false"`，使 env 检查、smoke 与真实运行口径一致。留空在 `NODE_ENV=production` 下实际也是真发，但 `deploy:smoke` 会拒绝这种含糊配置；切勿设 `"true"` |
| `WECOM_SMART_BOT_ID` / `WECOM_SMART_BOT_SECRET` | Bot ID + Secret 智能机器人长连接凭据 | 只使用旧群 Webhook 时两项都留空；启用智能机器人时必须成对配置，且生产必须 `BACKGROUND_JOBS_MODE=durable` |
| `CDR_BUNDLE_MOCK_MODE` | CDR 打包真跑开关 | 留空（按 NODE_ENV）。生产设 `"true"` 会让 CDR 汇总下载返回 mock 占位 URL |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | seed.ts 创建 / 重置 ADMIN | 详见文件顶注释 |

> [企业微信「消息推送」官方文档](https://developer.work.weixin.qq.com/document/path/99110)
> 规定群机器人 `markdown.content` 最大为 **4096 UTF-8 字节**，每个机器人
> Webhook 最多 **20 条/分钟**。当前保存模板和发送前均会按 UTF-8 字节守卫单条上限；
> 真实 `sendWebhook` 已通过 PostgreSQL `NotificationWebhookSendSlot` 按共享
> Webhook 跨事件、跨进程串行预留 3.5 秒 permit（约 17 条/分钟）。表键只保存
> 「固定端点 + 解码后 key」的 SHA-256 摘要，不复制明文 webhook/key；mock 与注入
> sender 不访问该表。生产真发前必须先执行 migration
> `20260902121100_notification_webhook_global_throttle`。响应按[官方全局错误码文档](https://developer.work.weixin.qq.com/document/path/90313)
> 的 `errcode` 判定；新通知任务最多执行 1 次初始投递 + 3 次退避重试。

Bot ID + Secret 智能机器人使用企业微信官方的
[长连接协议](https://developer.work.weixin.qq.com/document/path/101833)，并与上述群 Webhook
通道并存。运维时必须遵守以下边界：

- 本次用于接入的 Secret 曾在对话中明文暴露，已视为泄露。先在企业微信后台轮换 Secret，再把新值注入生产密钥管理/受限 `.env`；不要复用已发出的旧值，也不要把新值写入 Git、命令行或日志。
- `WECOM_SMART_BOT_ID` 和 `WECOM_SMART_BOT_SECRET` 要么都留空，要么都配置。部署前运行 `pnpm check:env`，半配置会直接阻断上线。
- 长连接只由常驻 LIGHT worker 持有；生产必须使用 `BACKGROUND_JOBS_MODE=durable`，PM2 只能运行 **1 个 LIGHT worker 进程实例**。`LIGHT_WORKER_CONCURRENCY=2` 是该单进程内的任务并发，不是启动两个机器人连接。
- 绑定群会锁定绑定时的 Bot ID。轮换同一 Bot ID 的 Secret 不需重绑；如果更换 Bot ID，必须新建通知目标并在目标群重新绑定，不会把旧 `chatid` 交给新机器人。
- 仅配置 Bot ID + Secret 还不知道收件群。LIGHT worker 认证成功后，在 `/owner/notifications` 创建智能机器人通知目标、生成一次性绑定码，再由群成员在目标企业微信群中 `@机器人` 并发送该码。后台显示已绑定后再启用通道并点“测试”；测试会由 LIGHT worker 入队真发。
- 匿名 `/api/health/jobs` 暴露 `required` / `configurationValid` / `identityMatch` / `operational` 安全状态，以及额外 LIGHT 心跳的相对过期等待提示 `recoveryWaitMs`（0–180 秒），不暴露 Bot ID、摘要、群 ID 或 worker 身份。只要存在启用中的智能机器人目标，发布门禁就要求当前版本唯一 LIGHT worker 身份一致且稳定 `CONNECTED` 6 秒；暂态恢复采用有限观察预算，默认总上限 600 秒，持续双实例不会放行。时间策略和可配置项见 [部署指南](docs/部署指南.md)。

协议和绑定前置条件以[企业微信智能机器人官方文档](https://developer.work.weixin.qq.com/document/path/101785)为准。

选填但生产建议：
| `SENTRY_DSN` | 错误监控 | 留空 → instrumentation.ts no-op，错误只进 Next 默认日志 |
| `APP_VERSION` | Sentry release / OTel 标签 | 留空 → 'dev'，无法区分版本 |
| `OSS_ACCESS_KEY_ID` etc. | 设计图 / CDR 直传（5 个变量见 `.env.example`） | 留空 → 上传按钮 disabled，UI 提示&ldquo;未配置&rdquo;（不会假成功） |

> **⚠️ OSS 手动运维（代码改不了，容易漏）：设计图/CDR 走浏览器直传 PUT，必须在阿里云 OSS 控制台给生产 bucket 配 CORS**——AllowedOrigin=`APP_PUBLIC_URL` 域名（split-origin 则 staff 域也加）、AllowedMethod=`PUT/GET/HEAD`、AllowedHeader=`*`、ExposeHeader=`ETag`。不配则上传预检失败、浏览器静默拦截，签名正常也传不上去。上线 smoke 必须真机点一次上传验证 200。

### 2. Cron 调度：服务端环境 + root-only 发送文件

P0 + P1 #2 期间建立的 cron 通道现有 10 个 endpoints，用 shared-secret + 外部 cron 调用。

> 调度时间的唯一事实源是 `deploy/crontab.example`。下方命令仅用于人工触发示例，
> 不定义生产执行时间。

> **密钥不进命令行参数**：`-H "Authorization: Bearer $CRON_SECRET"` 会把展开后的明文密钥写进
> 进程 argv 和 shell history——同机任何用户一句 `ps -efww | grep Bearer` 就能读走完整
> `CRON_SECRET`。下面统一用 `--header @-` 从 stdin 喂头（curl >= 7.55，2017 年引入；
> Ubuntu 22.04 / Debian 12 / Alibaba Cloud Linux 3 自带的 curl 都满足）。
> 生产不要手抄这些命令，直接用 `deploy/run-cron.sh`，它已经是这个写法。

```bash
# 师傅日薪（完成后推 DAILY_WORKER_SALARY 到车间群）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/daily-salary

# 扫描已到期客服周期（每条结算推 CS_PERIOD_SETTLED 到规则绑定的单个授权共享群）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/cs-settle

# 销售应收账单
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/generate-bills

# P1 #2 新增：每日扫超期外协 → OUTSOURCE_OVERDUE 推送到管理群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/outsource-overdue

# P1 #2 新增：每日扫 7 天内将到期客服周期 → CS_PERIOD_ENDING 推送到规则绑定的单个授权共享群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/cs-period-ending

# 2026-07-07 新增：每日扫承诺交期已过仍未发货的工单 → ORDER_OVERDUE 推送到管理群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/order-overdue

# 每日分批删除过期工单导出产物，终态只保留粗粒度 scope
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/order-export-cleanup

# 待工厂确认积压提醒（按日期/工单去重）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/pending-factory-backlog

# 报工超前与下发后无有效扫码认领提醒（幂等去重）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/production-alerts
```

**手工带 body 重跑日薪时会多一个 400**（2026-08-21 起）：`daily-salary` 的
`body.date` 严格晚于上海日历今天时，直接返回 `400 { "error": "future date: <date>" }`，
不入队。crontab 里不带 body 的默认调用算的是「昨天」，永远不会命中这个分支；
`202 queued` / `200` / `401` / `503` 的既有形状一律不变。

生产固定使用 `deploy/run-cron.sh` + 系统 crontab。同一个密钥必须存在两个
受限位置：应用服务端环境里的 `CRON_SECRET` 供 endpoint 验证，以及
`CRON_SECRET_FILE` 指向的 root 所有、`0600` 普通文件供主机 cron 发送。
不要把它写进 PostgreSQL 自定义 GUC，因为能建立数据库会话的
角色可通过 `current_setting()` 读取数据库级设置。
`pg_cron` + `pg_net` HTTP 调度已经退役，前向迁移会撤销遗留 ERP job 并清理旧设置。

**10 个 cron endpoints 都不走 session Proxy**（`proxy.ts` matcher 排除 `api/cron`）—— 它们用自己的 `Authorization: Bearer $CRON_SECRET` 闸口。`CRON_SECRET` 留空时 endpoint 直接 503，不会被误调用。

### 3. 备份（pgBackRest）

Pigsty 自带 pgBackRest，**不要**在应用里自己实现备份。生产基线：

- 每日 full + 连续 WAL，备份链保留 30 天。
- 本地 repository + 异地对象存储 repository，两份都要健康。
- 每日在 Pigsty 节点跑 `PGBACKREST_STANZA=<stanza> pnpm check:backup`。
- 每月恢复演练，RPO ≤ 5 分钟、RTO ≤ 60 分钟。

2026-08-02 发布前 full backup `20260802-193420F` 和连续 WAL 已验证，但生产当前只有 repo1、full retention 为 2 份。默认 `BACKUP_REQUIRED_REPOS=2` 的门禁仍应失败；这是待整改偏差，不能为了显示绿色把基线改成 1。

详见 `docs/production-slo-and-recovery.md`。

### 4. Sentry 接入

`instrumentation.ts` 已经写好；只要 `SENTRY_DSN` 喂进去就工作。**截至 2026-08-02 生产仍未配置 Sentry，当前主要依赖 PM2/Next 日志，尚未达到下面的监控目标。** 建议：
- Sentry 项目 → Settings → Client Keys 拿 DSN
- `tracesSampleRate` 当前是 0.2；观察到稳定流量后调到 0.05 ~ 0.1
- `sendDefaultPii: false`（不要把 cookies / IP 默认上报）已硬编码——薪资 / 客户 ref 都算敏感，单点 `Sentry.setExtra` 显式带上下文

### 5. OSS（设计图直传）

`lib/oss/config.ts` 接受 5 个必填 + 2 个选填环境变量。**全部填齐才启用**——任一缺失 → `signDesignUpload` 返回 `{ status: 'not-configured' }`，UI 把上传按钮置灰并提示&ldquo;未配置 OSS&rdquo;，不会出现&ldquo;假成功&rdquo;。

生产步骤：
1. 阿里云 RAM 建一个 `print-shop-erp-oss-uploader` 子账号 → 拿 AK/SK
2. RAM 建一个 role（`OSS_STS_ROLE_ARN`），给该角色 oss-bucket 写权限
3. 子账号信任策略允许 AssumeRole 到上一步的 role
4. `.env` 填 5 个变量；`OSS_PUBLIC_BASE_URL` 设成 CDN 域名（避免直链 OSS）

`OSS_ENDPOINT` 一般留空（按 region 派生）；只有 VPC 内访问 / 特殊端口才需要。

### 6. Chromium 与中文字体

Debian 生产机固定使用系统 `/usr/bin/chromium`，PM2 通过 `PUPPETEER_EXECUTABLE_PATH` 同时传给 Web 和 HEAVY worker；Puppeteer-managed Chrome 只用于本地和 CI。

```bash
sudo apt-get update
sudo apt-get install -y chromium fonts-noto-cjk
test -x /usr/bin/chromium
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium /usr/bin/chromium --version
fc-list :lang=zh | head
```

生产 smoke 必须显式传 `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` 和 `CI=true`，使浏览器以与真实渲染相同的 no-sandbox 参数启动。当前 `deploy-smoke` 只验证启动，不调用 `page.pdf()`；还要另跑部署指南 §13 的内存 PDF 命令。2026-08-02 已用该运行时生成 37,646 字节中文 PDF；只检查 HTTP 200 或 Puppeteer 缓存不算 PDF 验收。

本地/CI 若没有系统 Chromium，可运行 `npx puppeteer browsers install chrome` 安装 Puppeteer-managed Chrome。完整生产命令见 `docs/部署指南.md` §7 / §13。

### 7. 日常更新与数据库迁移边界

首次部署完成后，统一从项目根目录运行：

```bash
./deploy/update.sh
```

> 发布前必须在目标服务器确认 remote、tracking branch 和经过审核的 release SHA；
> 不得仅凭本地分支名或本文历史快照决定发布源。

脚本先在旧进程在线时完成依赖安装、生产环境预检、Prisma Client 生成和构建；随后停止 Web、LIGHT worker、HEAVY worker，执行 `prisma migrate deploy`，立即启动新版本并检查 `/api/health/ready`。进入停机窗口后的任何失败都会让三个进程保持停止，防止旧代码继续写入新数据库结构。

数据库迁移开始后禁止只 `git checkout` 旧 commit 回滚应用。应修正当前版本或补新的前向 migration 后重跑脚本；只有同时恢复匹配的数据库备份时，旧代码才可恢复。Fresh DB 必须完整应用 `prisma/migrations/` 中的全部 migration，并用 `pnpm exec prisma migrate status` 核对；不要把 README 中的固定数量当门禁。当前仓库快照、最新 migration 和完整规则见 `DATABASE.md`，发布批次的外协历史快照对账、无效索引检查和视觉 fixture 见 `docs/部署指南.md` §14 与 `docs/上线前置操作清单.md`。`20260821120100_notification_log_delivery_key_unique` 的唯一索引仍是通知重试的正确性依赖，必须验收 `indisvalid`；仓库状态不代表生产已经迁移。

### 8. 上线 smoke checklist

按顺序跑一遍（**本次发布批次另有前置排查与单向门，先过一遍 `docs/上线前置操作清单.md`**）：
- [ ] `docs/上线前置操作清单.md` §零的历史外协逐款数量已凭原始证据对账，§一的覆盖缺口也已清零
- [ ] `pnpm prisma migrate deploy`（生产 migration）
- [ ] `NotificationLog_deliveryKey_channelId_key` 的 `indisvalid` 为 `t`（`docs/上线前置操作清单.md` §二）
- [ ] `pnpm prisma db seed`（仅首次部署且确认 seed 行为后执行）
- [ ] `chromium --version`、`fc-list :lang=zh`，并按部署指南用 `/usr/bin/chromium` 真生成一份中文 PDF
- [ ] `CI=true NODE_ENV=production NOTIFICATION_MOCK_MODE=false BACKGROUND_JOBS_MODE=durable PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium DEPLOY_SMOKE_BASE_URL=https://bag.sshapi.cn pnpm deploy:smoke --skip-build --require-base-url`
- [ ] 管理员登录 `/owner/accounts` 改默认密码
- [ ] 销售 / 客服 / 师傅各创一个测试账号
- [ ] 跑通 工单创建 → 工厂确认 → 下发（`CONFIRMED → RELEASED`）→ 报工 → 生产完成 → 发货一条链
- [ ] 触发一次 `/api/cron/daily-salary` 验证 shared-secret + 入库
- [ ] 触发一次 `/api/cron/generate-bills`（建议先用 `{"period": "<上月>"}` 显式指定），验证账单生成
- [ ] ADMIN 账单页面发单 → 录入付款 → 状态切到 FULLY_PAID
- [ ] 用受控测试错误确认 Sentry 收到事件；生产未配置 `SENTRY_DSN` 时此项明确不通过，禁止临时破坏真实业务 action
- [ ] **`NOTIFICATION_MOCK_MODE=false` + 管理员在 `/owner/notifications` 建至少 1 个 channel + 逐项核对 15 条预置 rule + 按业务启用并绑定收件群 + 用&ldquo;测试&rdquo;按钮验证真发**。Webhook 通道核对 URL；智能机器人通道先轮换已暴露 Secret，成对注入两个 `WECOM_SMART_BOT_*` 变量，确认只有一个 LIGHT worker 进程，再于目标群 `@机器人` 并发送一次性绑定码。Mock-mode 还开着的话 NotificationLog 会全是 `errorMessage='MOCK'` —— 管理员会以为推送已发其实没真发。
- [ ] 真实触发一次 `ORDER_SCHEDULED`（下发 `RELEASED`）与 `ORDER_COMPLETED`（当前 work-order generation 通过生产完成闸口），核对群消息和投递日志各只有一次。
- [ ] `CS_PERIOD_ENDING` / `CS_PERIOD_SETTLED` 当前最多只能绑定 1 个授权共享群；尚未实现&ldquo;管理员群 + 对应客服&rdquo;按人双路由，不得按已完成验收。
- [ ] 触发一次 `/api/cron/outsource-overdue` + `/api/cron/cs-period-ending` 验证扫描 + 推送（dev 期 mock-mode 写 status=SUCCESS+'MOCK'；prod 期真发企业微信）
- [ ] `pm2 status` 显示 Web、LIGHT worker、HEAVY worker 三个进程都 online
- [ ] `/api/health/ready` 返回 200，且两类 worker 心跳存在
- [ ] `/api/health/jobs` 返回 200（有死信 / 卡死 RUNNING / worker 缺失会 503）；把它接进外部监控，否则「死信 30 分钟响应」这条 SLO 不生效
- [ ] `pnpm check:backup` 通过，确认两个 repo 的 full + WAL
