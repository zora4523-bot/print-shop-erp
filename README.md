# 红包印刷 ERP 系统

内部工具，服务于佛山某红包印刷厂的生产、销售、薪资、库存全流程数字化。

---

## 📂 文档结构

| 文件 | 作用 | 读者 |
|---|---|---|
| **SPEC-v1.2.md** | 业务规格（冻结版，权威） | 所有人 |
| **CLAUDE.md** | 开发规范与工作准则 | Claude Code / Codex |
| **prisma/schema.prisma** | 数据库Schema | 开发 |
| **prisma/seed.ts** | 初始化种子数据 | 开发 |
| **PIGSTY-EXTENSIONS.md** | Pigsty 扩展适配与开发计划 | 开发 / 运维 |
| **docs/pigsty-production-activation-runbook.md** | Pigsty 生产扩展启用 runbook | 运维 / Owner |
| **docs/deployment-smoke-checklist.md** | 部署前 smoke 与备份检查清单 | 开发 / 运维 |
| **docs/上线前置操作清单.md** | 当前发布批次的部署前排查、单向门与人工验证 | 运维 / Owner |
| **docs/AGENT-BACKLOG.md** | Agent 自动化开发任务队列 | 开发 / Codex routines |
| **docs/规范合规审查-2026-08-19.md** | CLAUDE.md 规范合规审查快照（含 19 条待处理） | 开发 |
| **docs/AGENT-ROUTINES.md** | Agent 自动 prompt / draft PR 执行协议 | 开发 / Codex routines |
| **CHANGELOG.md** | 版本变更历史 | 所有人 |
| **SPEC-v1.0.md / v1.1.md** | 历史版本（仅归档） | 参考 |

---

## 🚀 启动开发（给Claude Code的指引）

### 环境要求

- **Node.js 24 LTS**（Krypton，支持至2028-04-30）
- **pnpm** 最新版
- **PostgreSQL 16**（开发期用本地 PG 或 Pigsty dev 实例，生产用独立 Pigsty）

### 第一次启动

```bash
# 0. 确认 Node 版本
node -v  # 必须是 v24.x

# 1. 初始化项目
pnpm create next-app@latest print-shop-erp --ts --tailwind --app --no-src-dir
cd print-shop-erp

# 2. 安装核心依赖（版本锁精确，不用 ^ 前缀 —— 安装后手动去 package.json 改）
pnpm add prisma@7 @prisma/adapter-pg
pnpm add next-auth@5 @auth/prisma-adapter
pnpm add react-hook-form zod @hookform/resolvers
pnpm add bcryptjs decimal.js
pnpm add qrcode.react qrcode
pnpm add puppeteer   # PDF生成
pnpm add @sentry/nextjs   # 错误监控
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/instrumentation-http

# 3. 安装开发依赖
pnpm add -D @types/bcryptjs @types/qrcode
pnpm add -D vitest @vitest/browser playwright-core  # 单元+组件测试
pnpm add -D @playwright/test                         # E2E+截图回归

# 4. 初始化 shadcn/ui
pnpm dlx shadcn@latest init

# 5. 装 Playwright 浏览器
pnpm exec playwright install chromium

# 6. 复制本目录下的配置文件
cp ../SPEC-v1.2.md ./
cp ../CLAUDE.md ./
cp ../prisma/schema.prisma ./prisma/
cp ../prisma/seed.ts ./prisma/
cp -r ../components-reference ./

# 7. 数据库准备
#    MVP阶段可以用本地 PostgreSQL（brew install postgresql@16 或 apt install postgresql-16）
#    生产部署请用 Pigsty 独立实例
createdb print_shop_erp
export DATABASE_URL="postgresql://localhost:5432/print_shop_erp"

# 8. 生成 Prisma Client（Prisma 7 生成到 ./generated/prisma）
pnpm prisma generate

# 9. 首次 migration
pnpm prisma migrate dev --name init

# 10. 跑种子数据（初始化管理员、工艺字典、薪资规则等）
pnpm prisma db seed

# 11. 启动开发
pnpm dev
```

### 首次启动后

1. 打开 `http://localhost:3000`
2. 用种子数据创建的账号登录：`admin` / `admin@2026`
3. **立刻改默认密码**
4. 开始按 P0 清单开发第一个功能（认证与用户管理）

### 开发路径（P0优先级）

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
   - 开机师傅日薪计算（每日24:00定时任务）
   - 客服业绩周期累计 + 结算
   - 时薪工工时录入 + 月结

6. **应收账单**（3天）
   - 月度自动生成销售账单
   - 销售查看、管理员登记收款

7. **CDR汇总**（2天）
   - 管理员勾选打包
   - 24小时临时链接

8. **推送与Dashboard**（1周）
   - 企业微信Webhook配置
   - 10个预置事件
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

截至 2026-08-02，`aa42ba0` 已运行在 <https://bag.sshapi.cn>，生产数据库为 45 / 45 migrations。本节记录当前生产口径和后续发布门禁，不再把“首次生产激活”当作待办。

> 当前已确认 Web、LIGHT worker、HEAVY worker、ready 和系统 Chromium PDF 正常；仍需补异地备份 repo2、30 天保留与恢复演练、`SENTRY_DSN / APP_VERSION`，并将 1.6 GiB 应用机升级到至少 4 GiB。生产只有 repo1 不能算备份基线通过。

### 1. 必填环境变量（`.env`）

| 变量 | 用途 | 不配会怎样 |
|---|---|---|
| `DATABASE_URL` | Pigsty PG 连接串 | 应用起不来 |
| `AUTH_SECRET` | Auth.js 会话签名 | Auth.js 拒启 |
| `AUTH_TRUST_HOST` | Nginx 反代场景必填 `"true"` | 登录跳转失败 |
| `CRON_SECRET` | cron endpoints `Authorization: Bearer <secret>` | 8 个 `/api/cron/*` 全部 503 |
| `BACKGROUND_JOBS_MODE` | 生产设 `durable`，通知/cron/PDF/CDR/工单导出进 PostgreSQL 任务账本 | `inline` 会失去持久重试和资源隔离 |
| `ORDER_EXPORT_ARTIFACT_DIR` | Web 与 HEAVY worker 共享的私有 XLSX 目录，单机建议 `/var/tmp/print-shop-erp/order-exports` | 留空回退到系统临时目录；多机或临时目录清理后待下载文件会丢失 |
| `APP_PUBLIC_URL` | 应用公网根 URL（含 protocol，无尾斜线）。**生产强烈推荐显式配置**——尤其 split-origin（staff 内网 + 外协公网）；留空仅适合 dev / 单域名生产，从请求 headers 推 | 留空：**打印单二维码（师傅微信扫码报工）** 与 CDR 外协短链跟随访问域，split-origin 时师傅/外协拿到内网死链；单域名若 Nginx 漏传 `X-Forwarded-Proto` 也会退化成 localhost 死链 |
| `NOTIFICATION_MOCK_MODE` | 企业微信推送真发开关 | 生产显式设 `"false"`，使 env 检查、smoke 与真实运行口径一致。留空在 `NODE_ENV=production` 下实际也是真发，但发布门禁会拒绝这种含糊配置；切勿设 `"true"` |
| `CDR_BUNDLE_MOCK_MODE` | CDR 打包真跑开关 | 留空（按 NODE_ENV）。生产设 `"true"` 会让 CDR 汇总下载返回 mock 占位 URL |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | seed.ts 创建 / 重置 ADMIN | 详见文件顶注释 |

选填但生产建议：
| `SENTRY_DSN` | 错误监控 | 留空 → instrumentation.ts no-op，错误只进 Next 默认日志 |
| `APP_VERSION` | Sentry release / OTel 标签 | 留空 → 'dev'，无法区分版本 |
| `OSS_ACCESS_KEY_ID` etc. | 设计图 / CDR 直传（5 个变量见 `.env.example`） | 留空 → 上传按钮 disabled，UI 提示&ldquo;未配置&rdquo;（不会假成功） |

> **⚠️ OSS 手动运维（代码改不了，容易漏）：设计图/CDR 走浏览器直传 PUT，必须在阿里云 OSS 控制台给生产 bucket 配 CORS**——AllowedOrigin=`APP_PUBLIC_URL` 域名（split-origin 则 staff 域也加）、AllowedMethod=`PUT/GET/HEAD`、AllowedHeader=`*`、ExposeHeader=`ETag`。不配则上传预检失败、浏览器静默拦截，签名正常也传不上去。上线 smoke 必须真机点一次上传验证 200。

### 2. Cron 切换：`Bearer` → `pg_cron`

P0 + P1 #2 期间建立的 cron 通道现有 8 个 endpoints，用 shared-secret + 外部 cron 调用。

> **密钥不进命令行参数**：`-H "Authorization: Bearer $CRON_SECRET"` 会把展开后的明文密钥写进
> 进程 argv 和 shell history——同机任何用户一句 `ps -efww | grep Bearer` 就能读走完整
> `CRON_SECRET`。下面统一用 `--header @-` 从 stdin 喂头（curl >= 7.55，2017 年引入；
> Ubuntu 22.04 / Debian 12 / Alibaba Cloud Linux 3 自带的 curl 都满足）。
> 生产不要手抄这些命令，直接用 `deploy/run-cron.sh`，它已经是这个写法。

```bash
# 每日 24:00 师傅日薪（P1 #2 起：完成后推 DAILY_WORKER_SALARY 到车间群）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/daily-salary

# 月初 00:00 时薪工月结
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/hourly-payroll

# 每日扫描已到期客服周期（P1 #2 起：每条结算推 CS_PERIOD_SETTLED 到管理员群+客服）
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/cs-settle

# 月初 00:30 销售应收账单
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/generate-bills

# P1 #2 新增：每日扫超期外协 → OUTSOURCE_OVERDUE 推送到管理群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/outsource-overdue

# P1 #2 新增：每日扫 7 天内将到期客服周期 → CS_PERIOD_ENDING 推送到管理员群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/cs-period-ending

# 2026-07-07 新增：每日扫承诺交期已过仍未发货的工单 → ORDER_OVERDUE 推送到管理群
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/order-overdue

# 每日分批删除过期工单导出产物，终态只保留粗粒度 scope
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -X POST --header @- https://host/api/cron/order-export-cleanup
```

**手工带 body 重跑日薪 / 月结时会多一个 400**（2026-08-21 起）：`daily-salary` 的
`body.date` 严格晚于上海日历今天、`hourly-payroll` 的 `body.month` 严格晚于上海本月时，
直接返回 `400 { "error": "future date: <date>" }` / `{ "error": "future month: <month>" }`，
不入队。crontab 里不带 body 的默认调用算的是「昨天 / 上月」，永远不会命中这个分支；
`202 queued` / `200` / `401` / `503` 的既有形状一律不变。

上线后切到 Pigsty 的 `pg_cron`（DECISIONS 2026-04-22 已启用扩展）。每个 endpoint 在 PG 侧用 `cron.schedule` + `pg_net` 发 HTTP 请求即可。响应已经统一是 **COUNTS ONLY**（不返回金额 / 销售名 / per-worker 错误明细），所以可以安全地把 cron 输出落到 PG 日志。

**8 个 cron endpoints 都不走 session Proxy**（`proxy.ts` matcher 排除 `api/cron`）—— 它们用自己的 `Authorization: Bearer $CRON_SECRET` 闸口。`CRON_SECRET` 留空时 endpoint 直接 503，不会被误调用。

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

> **当前发布源例外（2026-08-03）**：生产 `aa42ba0` 来自本地 `codex/complex-client-data-layer-poc`，而本地 `main` 仍为 `245be5c`，仓库也没有 Git remote。配置远端并明确合并策略前，不能依赖脚本中的默认 `git pull`，更不能从旧 `main` 发版。

脚本先在旧进程在线时完成依赖安装、生产环境预检、Prisma Client 生成和构建；随后停止 Web、LIGHT worker、HEAVY worker，执行 `prisma migrate deploy`，立即启动新版本并检查 `/api/health/ready`。进入停机窗口后的任何失败都会让三个进程保持停止，防止旧代码继续写入新数据库结构。

数据库迁移开始后禁止只 `git checkout` 旧 commit 回滚应用。应修正当前版本或补新的前向 migration 后重跑脚本；只有同时恢复匹配的数据库备份时，旧代码才可恢复。当前工作区的 Fresh DB 验证必须完整应用 **77 项 migration** 到尾部 `20260821120100_notification_log_delivery_key_unique`，并检查无效并发索引为 0（2026-08-21 顺带订正此前已漂掉的 3 项：原文的 71 / `pricing_compatibility_fence` 早在那一轮之前就落后于仓库实际的 74 项）；完整命令、视觉 fixture 和故障处理见 `docs/部署指南.md` §14。其中 `20260821120100_notification_log_delivery_key_unique` 的唯一索引是**通知重试的正确性依赖**（INVALID 索引不能当 `ON CONFLICT` 的 arbiter），迁移后必须单独验收 `indisvalid`，SQL 见 `docs/上线前置操作清单.md` §二。这是本地发布候选口径，不表示生产已从 `aa42ba0` / 45 项 migration 升级。

### 8. 上线 smoke checklist

按顺序跑一遍（**本次发布批次另有前置排查与单向门，先过一遍 `docs/上线前置操作清单.md`**）：
- [ ] `docs/上线前置操作清单.md` §一的两段只读 SQL 已跑，外协覆盖存量缺口清零（否则不要上闸口那一步）
- [ ] `pnpm prisma migrate deploy`（生产 migration）
- [ ] `NotificationLog_deliveryKey_channelId_key` 的 `indisvalid` 为 `t`（`docs/上线前置操作清单.md` §二）
- [ ] `pnpm prisma db seed`（仅首次部署且确认 seed 行为后执行）
- [ ] `chromium --version`、`fc-list :lang=zh`，并按部署指南用 `/usr/bin/chromium` 真生成一份中文 PDF
- [ ] `CI=true NODE_ENV=production NOTIFICATION_MOCK_MODE=false BACKGROUND_JOBS_MODE=durable PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium DEPLOY_SMOKE_BASE_URL=https://bag.sshapi.cn pnpm deploy:smoke --skip-build --require-base-url`
- [ ] 管理员登录 `/owner/accounts` 改默认密码
- [ ] 销售 / 客服 / 师傅各创一个测试账号
- [ ] 跑通 工单创建 → 排产 → 报工 → 完工 一条链
- [ ] 触发一次 `/api/cron/daily-salary` 验证 shared-secret + 入库
- [ ] 触发一次 `/api/cron/generate-bills`（建议先用 `{"period": "<上月>"}` 显式指定），验证账单生成
- [ ] ADMIN 账单页面发单 → 录入付款 → 状态切到 FULLY_PAID
- [ ] 用受控测试错误确认 Sentry 收到事件；生产未配置 `SENTRY_DSN` 时此项明确不通过，禁止临时破坏真实业务 action
- [ ] **`NOTIFICATION_MOCK_MODE=false` + 管理员在 `/owner/notifications` 建至少 1 个 channel + 启用 9 条 rule + 用&ldquo;测试&rdquo;按钮验证 webhook 通**（DECISIONS 2026-04-27 / P1 #2）。Mock-mode 还开着的话 NotificationLog 会全是 `errorMessage='MOCK'` —— 管理员会以为推送已发其实没真发。
- [ ] 触发一次 `/api/cron/outsource-overdue` + `/api/cron/cs-period-ending` 验证扫描 + 推送（dev 期 mock-mode 写 status=SUCCESS+'MOCK'；prod 期真发企业微信）
- [ ] `pm2 status` 显示 Web、LIGHT worker、HEAVY worker 三个进程都 online
- [ ] `/api/health/ready` 返回 200，且两类 worker 心跳存在
- [ ] `/api/health/jobs` 返回 200（有死信 / 卡死 RUNNING / worker 缺失会 503）；把它接进外部监控，否则「死信 30 分钟响应」这条 SLO 不生效
- [ ] `pnpm check:backup` 通过，确认两个 repo 的 full + WAL
