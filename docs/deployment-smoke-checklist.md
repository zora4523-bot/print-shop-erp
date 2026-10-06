---
status: maintained
owner: project-maintainers
last_verified: 2026-09-10
sections_verified: 2026-09-11 local inline gate and production cron acceptance
applies_to: deploy smoke script and repository test configuration; production state not reverified
---

# 备份与部署 Smoke 清单

本文维护 [`scripts/deploy-smoke.mjs`](../scripts/deploy-smoke.mjs) 的运行方式与能力边界；本次只核对仓库代码，未复验生产环境。发布总入口见 [DEPLOYMENT.md](../DEPLOYMENT.md)，各项所需测试以 [CONTRIBUTING.md](../CONTRIBUTING.md#测试要求) 为准；现行命令见 [常用命令](../DEVELOPMENT.md#常用命令)，CI 实际覆盖与待补项见 [当前 CI 与发布验证缺口](../DEVELOPMENT.md#当前-ci-与发布验证缺口)。

本清单不能替代 [上线前置操作清单](上线前置操作清单.md) 中的历史迁移证据、无效索引与业务前置验收。生产写入、真实通知、cron 任务触发、迁移与恢复操作仍须按已有授权和 runbook 执行；文档示例不是执行这些操作的授权。

## 本地诊断

只使用专用本地或可丢弃测试数据库，并设置测试专用环境。先按 [本地开发指南](../DEVELOPMENT.md#首次启动) 完成该库迁移；默认不运行 seed。首次初始化需要 seed 时，先确认目标库再单独执行 `pnpm db:seed`，不要把 `DEPLOY_SMOKE_RUN_SEED=true` 作为日常 smoke 默认值。

终端 1（开发模式诊断）：

```bash
NOTIFICATION_MOCK_MODE=true BACKGROUND_JOBS_MODE=inline pnpm dev --port 3003
```

终端 2：

```bash
pnpm exec puppeteer browsers install chrome
DEPLOY_SMOKE_RUN_SEED=false \
NOTIFICATION_MOCK_MODE=true \
BACKGROUND_JOBS_MODE=inline \
DEPLOY_SMOKE_BASE_URL=http://localhost:3003 \
pnpm deploy:smoke --skip-build --require-base-url
```

这里刻意使用 `--skip-build`，避免运行中的 `next dev` 与 `next build` 共用同一工作目录的产物。此命令是开发环境诊断，不能证明生产构建可用。若需要验证本地构建产物，先停止开发服务，执行 `pnpm build`，再用 `pnpm start --port 3003` 启动，确保服务和检查进程采用相同测试库、mock 及后台模式；也可使用独立工作目录。默认 Playwright 启动开发服务器；生产构建使用 `pnpm test:release`，隔离前置见 [开发指南](../DEVELOPMENT.md#测试环境约束)。

本地 `development` / `test` 的 inline 响应只有在完整健康字段合法、无机器人要求、配置有效、运行正常且无恢复等待时，才接受 `smartBot.status=null`。生产 null、缺 worker、身份不符和缺必需配置仍阻断。契约回归见 [整改执行记录](audits/2026-09-11-remediation-validation.md)；通过脚本测试不等于目标环境已验收。

## 脚本实际检查与限制

| 检查 | 现行行为与限制 |
|---|---|
| Prisma | `validate`、`migrate status`；不会自动应用迁移；仅显式 `DEPLOY_SMOKE_RUN_SEED=true` 时运行 seed |
| 通知/后台环境 | production 要求 `NOTIFICATION_MOCK_MODE=false`，拒绝显式 inline；不等于真实消息链已经验证 |
| PDF 浏览器 | 实际生成中文 PDF，验证字体加载、单页结构和配置的私有产物读写；仍需人工检查真实工单与 OSS 图稿 |
| 构建 | 未带 `--skip-build` 时运行 `next build`；必须确保没有共享产物的开发服务 |
| HTTP | 有 base URL 才检查 login、live/ready/jobs、受保护页面跳转和无效 cron token；发布使用 `--require-base-url`，禁止以跳过路由检查代替通过 |
| jobs | 调用真实部署 gate 校验机器人状态、必需配置和身份；HTTP 200 本身不足以通过。旧非通知死信等可能使健康响应为 503，脚本按既有 gate 规则记录警告，不等于所有队列任务已处理 |
| cron | production 仅接受无效 token 返回 401；503 立即失败。development/test 允许 401 或 503 |

`--skip-build` 仅在同一候选已完成构建时作为发布复查选项；`--skip-pdf-browser` 仅用于故障定位，不能据此记 PDF 通过。`--dry-run` 仅预览子命令和 PDF 检查，配置 base URL 后仍会执行 HTTP 检查，不能当作完整验证结果。

## 发布前检查与生产探针

冻结候选 SHA 后，先在隔离测试库按 [贡献指南](../CONTRIBUTING.md#测试要求) 完成所需门禁，使用 [开发指南](../DEVELOPMENT.md#常用命令) 的完整 lint、覆盖率和分层浏览器命令。不要在配置生产 `DATABASE_URL` 的进程中运行单测、E2E 或测试 seed。新库迁移通过和零样本数据审计也不能替代生产存量检查。

部署前由授权运维执行生产环境预检、迁移状态及 [部署指南](部署指南.md) 的备份/历史数据检查。本文不再复制另一套开发测试命令，以免绕过完整 lint 的文案/令牌检查或漏掉覆盖率。

以下用于已部署的预发布或生产服务，只做脚本定义的探针，保持 seed 禁用；目标 URL 和变量应来自该环境的受控配置：

```bash
CI=true \
NODE_ENV=production \
NOTIFICATION_MOCK_MODE=false \
BACKGROUND_JOBS_MODE=durable \
DEPLOY_SMOKE_RUN_SEED=false \
ORDER_EXPORT_ARTIFACT_DIR=/var/tmp/print-shop-erp/order-exports \
AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR=/var/tmp/print-shop-erp/agent-monthly-bill-exports \
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
E2E_BASE_URL= \
DEPLOY_SMOKE_BASE_URL="$APP_PUBLIC_URL" \
pnpm deploy:smoke --skip-build --require-base-url
```

当前脚本在 `CI` 环境变量非空时向 Chromium 传递 `--no-sandbox` 与 `--disable-setuid-sandbox`；示例设为 `true`，但 `CI=false` 或 `CI=0` 同样会关闭 sandbox。该示例适配仓库既有的 root 运行方案，不代表本次重新确认了生产主机状态。脚本不会加载 PM2 ecosystem 环境，因此 Chromium 路径及相关变量需明确注入。运行前确认 `APP_PUBLIC_URL` 为本次验收环境；示例清空 `E2E_BASE_URL` 回退值，目标空值会由 `--require-base-url` 拒绝。通过记录必须关联已验证的构建 SHA，不能只留一行 completed。

无效 cron token 在配置正确的生产环境必须返回 **401**。脚本现已按 `NODE_ENV=production` 拒绝表示缺少 `CRON_SECRET` 的 **503**；非生产保留 401/503 诊断。仍需对本次目标环境保存真实状态码与 release SHA，不能用本机回归替代生产证据。

## PDF Browser

仓库的生产部署方案使用 PM2 指定的 Debian 系统 Chromium；安装检查须在授权运维环境执行：

```bash
sudo apt-get install -y chromium fonts-noto-cjk
test -x /usr/bin/chromium
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm deploy:smoke --skip-build
```

Local development and CI may use Puppeteer-managed Chrome instead:

```bash
pnpm exec puppeteer browsers install chrome
```

The PDF runtime smoke is necessary but not sufficient: it
now generates a Chinese PDF and verifies its private storage round trip; additionally inspect one downloaded
order containing Chinese text and a real OSS design image. On 2026-08-02,
`/usr/bin/chromium` generated a 37,646-byte Chinese test PDF in production.
That dated observation is historical evidence, not acceptance of the current release.
Use `pnpm check:pdf` for the same runtime probe independently; the manual
`page.pdf()` command in `docs/部署指南.md` §13 remains available for diagnosis.

## Notification Mode

Development and tests normally use mock mode:

```env
NOTIFICATION_MOCK_MODE=true
```

Production must explicitly disable mock mode:

```env
NOTIFICATION_MOCK_MODE=false
```

Before production rollout:

- Create at least one enabled notification channel in `/owner/notifications`.
- Enable the required notification rules.
- 仅在已获真实发送授权后，用 Owner UI 测试按钮验收实际通知通道；不要把默认 mock 测试当作真实发送通过。
- Confirm new production `NotificationLog` rows do not have
  `errorMessage = 'MOCK'`.

## Cron Auth

Cron endpoints are protected by `Authorization: Bearer $CRON_SECRET`.

Never pass a real secret with `-H "Authorization: Bearer $CRON_SECRET"`: the
expanded plaintext lands in the process argv and in shell history, so any local
user can read it with `ps -efww | grep Bearer`. Feed the header from stdin with
`--header @-` (curl >= 7.55) instead — that is what `deploy/run-cron.sh` does.
The literal `Bearer invalid` below is a deliberate negative test and carries no
secret, so it stays on the command line.

Preflight checks:

```bash
curl -i -X POST "$APP_PUBLIC_URL/api/cron/daily-salary" \
  -H "Authorization: Bearer invalid" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected:

- `401` when `CRON_SECRET` is configured.
- `503` when `CRON_SECRET` is missing.
- Never `200` for an invalid token.

Since 2026-08-21 `daily-salary` rejects dates that are not yet closed: it
returns `400 { "error": "open date: <date>" }` when `body.date` is today in
Shanghai and `400 { "error": "future date: <date>" }` when it is strictly after
today. The scheduled call carries no body and settles yesterday, so
it never hits this branch; only a manual re-run with an explicit body can.
The `hourly-payroll`, `cs-settle` and `cs-period-ending` endpoints were removed
on 2026-09-24 (no customer-service role, cleaners or cooks remain; SPEC §L);
make sure the installed crontab no longer calls any of them. All other response shapes (`202`, `200`, `401`, `500`,
`503`) are unchanged.

After deployment, trigger the daily export-retention job once and confirm the
returned job reaches `SUCCEEDED` on `/owner/background-jobs`:

```bash
printf '%s\n' "Authorization: Bearer $CRON_SECRET" |
  curl -i -X POST --header @- "$APP_PUBLIC_URL/api/cron/order-export-cleanup"
```

The HTTP response is `202 queued`; the eventual result contains counts only.
Any filesystem permission failure must leave the job retryable/DEAD instead of
being reported as a successful cleanup.

Confirm the database HTTP scheduler is retired and no schedule SQL is exposed:

```sql
SELECT job_name, ready_to_schedule, blockers, schedule_sql, unschedule_sql
FROM app_ops.cron_http_job_readiness
ORDER BY priority, job_name;
```

Every row must have `ready_to_schedule = false`,
`blockers = {database_http_scheduler_retired}`, and `schedule_sql IS NULL`.
Then confirm the host scheduler is installed with `sudo crontab -l`; its secret
must come from the root-only `CRON_SECRET_FILE` used by `deploy/run-cron.sh`.

## pgBackRest 自动验收

Pigsty owns backups through pgBackRest. This repository does not create or
delete backups; it now includes a read-only readiness gate:

Production checklist for operations:

```bash
PGBACKREST_STANZA=<stanza> BACKUP_REQUIRED_REPOS=2 pnpm check:backup
```

Before high-risk migrations:

- Confirm latest full or differential backup exists.
- Confirm WAL archiving is current.
- Confirm a restore drill has succeeded recently.
- Record the stanza name, backup label, and target restore time.

Do not add pgBackRest credentials to `.env`, CI variables for this app, or git.

历史记录（2026-08-02，尚未在本次复核）：当时备份 `20260802-193420F` 与连续 WAL 正常，但只有 repo1，full retention 为 2。每次发布需重新查询现状，不能沿用该记录证明今天的恢复能力。保持 `BACKUP_REQUIRED_REPOS=2`；使用 `1` 可用于诊断，但不能记为生产基线通过。

## 发布来源记录

历史记录（2026-08-03）：当时生产运行本地分支 `codex/complex-client-data-layer-poc` 的 `aa42ba0`；本地 `main` 为 `245be5c`，仓库没有 remote。该记录不代表当前生产版本或仓库状态，本次未重新验证生产 SHA。

每次发布前重新核对候选 SHA、部署主机实际版本、数据库迁移状态与构建产物，并保存记录；不能根据默认分支名、旧 SHA 或未提交工作区推断当前发布来源。来源未确认时停止放行，按受控发布流程解决，不直接执行默认 `git pull` 或部署 `main`。

## App Readiness SQL

Open `/owner/pigsty` after deploy or run:

```sql
SELECT surface_key, ready_for_search, blockers
FROM app_ops.search_index_readiness
ORDER BY priority, surface_key;

SELECT ready_for_pg_cron_http, ready_for_query_stats, blockers,
       recommended_scheduler_steps
FROM app_ops.ops_extension_readiness;

SELECT anon_installed, pgaudit_installed, blockers
FROM app_ops.security_extension_readiness;

SELECT parent_table, blockers
FROM app_ops.partition_readiness
ORDER BY priority, parent_table;
```

Partition blockers are expected until a manual A09 cutover plan exists.
