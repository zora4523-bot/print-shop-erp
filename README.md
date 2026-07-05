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
| **docs/AGENT-BACKLOG.md** | Agent 自动化开发任务队列 | 开发 / Codex routines |
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
   - 老板管账号（增删改）、角色选择

2. **工艺字典与产品字典**（3天）
   - 工艺管理页面
   - 产品基础管理

3. **工单核心**（2周）
   - 销售/客服：创建工单、多款式、双面双色、工艺多选
   - 上传JPG设计图 + CDR源文件（OSS）
   - 工单列表、详情、修改（按状态限制）
   - 状态机严格落地

4. **生产流程**（1周）
   - 车间主管：排产、派师傅（按工艺推荐）
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
   - 销售查看、老板登记收款

7. **CDR汇总**（2天）
   - 车间主管勾选打包
   - 24小时临时链接

8. **推送与Dashboard**（1周）
   - 企业微信Webhook配置
   - 10个预置事件
   - 老板Dashboard

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

**薪资算法错1元，老板的信任会崩塌**。所以：

- 所有薪资算法必须100%单元测试覆盖
- 所有薪资记录必须快照化（改规则不影响历史）
- 所有边界case都要测（小单、超大单、档位边界）

---

## 🎯 验收标准

### 功能验收

- [ ] 销售能在手机上10秒内录完一张简单工单
- [ ] 师傅能在30秒内完成扫码报工
- [ ] 车间主管能30秒内汇总当日CDR并拿到分享链接
- [ ] 客服能实时看到自己当前周期的业绩和距离下一档的差额
- [ ] 老板能在Dashboard上一眼看到今日工单、产量、待发货
- [ ] 急单提交后企业微信群3秒内收到推送

### 技术验收

- [ ] 核心算法测试覆盖率 100%
- [ ] E2E测试覆盖关键路径
- [ ] 所有Server Action有权限检查
- [ ] 所有金额字段用Decimal或integer
- [ ] 所有薪资记录有快照
- [ ] 数据库有每日备份脚本

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

P0 完成后上线前需要补齐的运维项。代码本身已就绪（`.env.example` 列了所有变量，cron endpoints 都有 shared-secret 闸口，instrumentation.ts 是 SENTRY_DSN-gated 的 graceful no-op），运维只需要把环境变量喂进去即可。

### 1. 必填环境变量（`.env`）

| 变量 | 用途 | 不配会怎样 |
|---|---|---|
| `DATABASE_URL` | Pigsty PG 连接串 | 应用起不来 |
| `AUTH_SECRET` | Auth.js 会话签名 | Auth.js 拒启 |
| `AUTH_TRUST_HOST` | Nginx 反代场景必填 `"true"` | 登录跳转失败 |
| `CRON_SECRET` | cron endpoints `Authorization: Bearer <secret>` | 6 个 `/api/cron/*` 全部 503 |
| `APP_PUBLIC_URL` | 应用公网根 URL（含 protocol，无尾斜线）。**生产强烈推荐显式配置**——尤其 split-origin（staff 内网 + 外协公网）；留空仅适合 dev / 单域名生产，从请求 headers 推 | 留空：CDR 短链跟随访问域，split-origin 时外协拿到内网链接 |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | seed.ts 创建 / 重置 OWNER | 详见文件顶注释 |

选填但生产建议：
| `SENTRY_DSN` | 错误监控 | 留空 → instrumentation.ts no-op，错误只进 Next 默认日志 |
| `APP_VERSION` | Sentry release / OTel 标签 | 留空 → 'dev'，无法区分版本 |
| `OSS_ACCESS_KEY_ID` etc. | 设计图 / CDR 直传（5 个变量见 `.env.example`） | 留空 → 上传按钮 disabled，UI 提示&ldquo;未配置&rdquo;（不会假成功） |

### 2. Cron 切换：`Bearer` → `pg_cron`

P0 + P1 #2 期间 6 个 cron endpoints 用 shared-secret + 外部 cron 调用：

```bash
# 每日 24:00 师傅日薪（P1 #2 起：完成后推 DAILY_WORKER_SALARY 到车间群）
curl -X POST https://host/api/cron/daily-salary \
  -H "Authorization: Bearer $CRON_SECRET"

# 月初 00:00 时薪工月结
curl -X POST https://host/api/cron/hourly-payroll \
  -H "Authorization: Bearer $CRON_SECRET"

# 每日扫描已到期客服周期（P1 #2 起：每条结算推 CS_PERIOD_SETTLED 到老板群+客服）
curl -X POST https://host/api/cron/cs-settle \
  -H "Authorization: Bearer $CRON_SECRET"

# 月初 00:30 销售应收账单
curl -X POST https://host/api/cron/generate-bills \
  -H "Authorization: Bearer $CRON_SECRET"

# P1 #2 新增：每日扫超期外协 → OUTSOURCE_OVERDUE 推送到管理群
curl -X POST https://host/api/cron/outsource-overdue \
  -H "Authorization: Bearer $CRON_SECRET"

# P1 #2 新增：每日扫 7 天内将到期客服周期 → CS_PERIOD_ENDING 推送到老板群
curl -X POST https://host/api/cron/cs-period-ending \
  -H "Authorization: Bearer $CRON_SECRET"
```

上线后切到 Pigsty 的 `pg_cron`（DECISIONS 2026-04-22 已启用扩展）。每个 endpoint 在 PG 侧用 `cron.schedule` + `pg_net` 发 HTTP 请求即可。响应已经统一是 **COUNTS ONLY**（不返回金额 / 销售名 / per-worker 错误明细），所以可以安全地把 cron 输出落到 PG 日志。

**6 个 cron endpoints 都不走 session 中间件**（middleware.ts matcher 排除 `api/cron`）—— 它们用自己的 `Authorization: Bearer $CRON_SECRET` 闸口。`CRON_SECRET` 留空时 endpoint 直接 503，不会被误调用。

### 3. 备份（pgbackrest）

Pigsty 自带 pgbackrest，**不要**自己写 cron 备份脚本。配置点：
- `/etc/pgbackrest/pgbackrest.conf` 指 stanza
- 全量 + 增量两条 cron（`pgbackrest --stanza=main backup --type=full` 周末 / `--type=incr` 每天）
- 异地：S3 / OSS / 本地磁盘 + rsync 至少二选一

恢复演练每季一次。生产数据丢失的代价远大于演练时间。

### 4. Sentry 接入

`instrumentation.ts` 已经写好；只要 `SENTRY_DSN` 喂进去就工作。建议：
- Sentry 项目 → Settings → Client Keys 拿 DSN
- `tracesSampleRate` 当前是 0.2（pre-launch 看清楚问题用）；流量起来后调到 0.05 ~ 0.1
- `sendDefaultPii: false`（不要把 cookies / IP 默认上报）已硬编码——薪资 / 客户 ref 都算敏感，单点 `Sentry.setExtra` 显式带上下文

### 5. OSS（设计图直传）

`lib/oss/config.ts` 接受 5 个必填 + 2 个选填环境变量。**全部填齐才启用**——任一缺失 → `signDesignUpload` 返回 `{ status: 'not-configured' }`，UI 把上传按钮置灰并提示&ldquo;未配置 OSS&rdquo;，不会出现&ldquo;假成功&rdquo;。

生产步骤：
1. 阿里云 RAM 建一个 `print-shop-erp-oss-uploader` 子账号 → 拿 AK/SK
2. RAM 建一个 role（`OSS_STS_ROLE_ARN`），给该角色 oss-bucket 写权限
3. 子账号信任策略允许 AssumeRole 到上一步的 role
4. `.env` 填 5 个变量；`OSS_PUBLIC_BASE_URL` 设成 CDN 域名（避免直链 OSS）

`OSS_ENDPOINT` 一般留空（按 region 派生）；只有 VPC 内访问 / 特殊端口才需要。

### 6. Puppeteer Chrome 安装

PDF 生成用 Puppeteer 自带的 Chromium（不复用系统 Chrome）。pnpm 默认会跳过 puppeteer 的 postinstall，所以需要**手动**触发：

```bash
npx puppeteer browsers install chrome
```

下载到 `~/.cache/puppeteer/`，约 200MB。CI / 生产部署里要把这一步显式写进 build 脚本。第一次点 PDF 下载报 `Could not find Chrome` 即此问题。

如果不想下载 Puppeteer 自己的浏览器，想用系统 Chrome，设置 `PUPPETEER_SKIP_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH=/path/to/chrome`（MVP 没做这个分支，需要时再说）。

### 7. 上线 smoke checklist

按顺序跑一遍：
- [ ] `pnpm prisma migrate deploy`（生产 migration）
- [ ] `pnpm prisma db seed`（首次创建 admin / 工艺字典 / 薪资规则）
- [ ] `npx puppeteer browsers install chrome`（PDF 生成依赖）
- [ ] 老板登录 `/owner/accounts` 改默认密码
- [ ] 销售 / 客服 / 师傅各创一个测试账号
- [ ] 跑通 工单创建 → 排产 → 报工 → 完工 一条链
- [ ] 触发一次 `/api/cron/daily-salary` 验证 shared-secret + 入库
- [ ] 触发一次 `/api/cron/generate-bills`（建议先用 `{"period": "<上月>"}` 显式指定），验证账单生成
- [ ] OWNER 账单页面发单 → 录入付款 → 状态切到 FULLY_PAID
- [ ] 故意挂掉一个 Server Action（临时改个抛错），确认 Sentry 收到事件后还原
- [ ] **`NOTIFICATION_MOCK_MODE=false` + 老板在 `/owner/notifications` 建至少 1 个 channel + 启用 9 条 rule + 用&ldquo;测试&rdquo;按钮验证 webhook 通**（DECISIONS 2026-04-27 / P1 #2）。Mock-mode 还开着的话 NotificationLog 会全是 `errorMessage='MOCK'` —— 老板会以为推送已发其实没真发。
- [ ] 触发一次 `/api/cron/outsource-overdue` + `/api/cron/cs-period-ending` 验证扫描 + 推送（dev 期 mock-mode 写 status=SUCCESS+'MOCK'；prod 期真发企业微信）
- [ ] pgbackrest 跑一次 full backup，确认目标位置有文件
