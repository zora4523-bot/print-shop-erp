# Backup And Deployment Smoke Checklist

Use this checklist before deployment. The local smoke script does not require
production secrets and does not run production database operations.

> 本清单只覆盖**每次发布都要跑**的自动化自检。当前发布批次另有一次性的部署前排查、
> 单向门与人工验证，见 `docs/上线前置操作清单.md`（外协覆盖的两段只读 SQL、
> `NotificationLog_deliveryKey_channelId_key` 的 `indisvalid` 验收等）。

## One Local Command Sequence

Terminal 1:

```bash
pnpm dev -- -p 3003
```

Terminal 2:

```bash
pnpm test:e2e:install
npx puppeteer browsers install chrome
DEPLOY_SMOKE_RUN_SEED=true \
DEPLOY_SMOKE_BASE_URL=http://localhost:3003 \
pnpm deploy:smoke
```

What the script checks:

- `prisma validate`
- `prisma migrate status`
- optional `prisma db seed` when `DEPLOY_SMOKE_RUN_SEED=true`
- `NOTIFICATION_MOCK_MODE` expectation
- Puppeteer can launch the PDF browser
- `next build`
- `/login` route responds
- `/owner/pigsty` redirects unauthenticated users to `/login`
- `/api/cron/daily-salary` rejects invalid cron auth with `401` or `503`

Useful variants:

```bash
pnpm deploy:smoke --dry-run
pnpm deploy:smoke --skip-pdf-browser
pnpm deploy:smoke --skip-build
DEPLOY_SMOKE_BASE_URL=http://localhost:3003 pnpm deploy:smoke --require-base-url
```

`DEPLOY_SMOKE_RUN_SEED` defaults to false so the command is safe to run against
non-empty databases unless explicitly opted in.

## Production Preflight

Do not run `prisma db seed` against production unless this is the first
deployment and the owner has approved the seed behavior.

Required before `prisma migrate deploy`:

```bash
NODE_ENV=production pnpm check:env
pnpm prisma validate
pnpm prisma migrate status
pnpm typecheck
pnpm eslint .
pnpm vitest run --reporter=dot --testTimeout=10000
pnpm build
```

For production route checks, point the script to a deployed staging or
post-deploy production URL and keep seed disabled:

```bash
CI=true \
NODE_ENV=production \
NOTIFICATION_MOCK_MODE=false \
BACKGROUND_JOBS_MODE=durable \
ORDER_EXPORT_ARTIFACT_DIR=/var/tmp/print-shop-erp/order-exports \
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
DEPLOY_SMOKE_BASE_URL=https://bag.sshapi.cn \
pnpm deploy:smoke --skip-build --require-base-url
```

`CI=true` is required by the current smoke script on the root-run production
host so Chromium receives `--no-sandbox` and `--disable-setuid-sandbox`.
`PUPPETEER_EXECUTABLE_PATH` is also explicit because the script does not load
the PM2 ecosystem environment. `--skip-build` only avoids rebuilding after the
full preflight above has already passed.

The script uses an invalid cron token on purpose. A configured production cron
endpoint must return `401`. A `503` also proves the job did not execute, but it
means `CRON_SECRET` is missing and the production release gate has failed.

## PDF Browser

Production PDF generation uses the Debian system Chromium selected by PM2:

```bash
sudo apt-get install -y chromium fonts-noto-cjk
test -x /usr/bin/chromium
CI=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm deploy:smoke --skip-build
```

Local development and CI may use Puppeteer-managed Chrome instead:

```bash
npx puppeteer browsers install chrome
```

The browser-launch smoke is necessary but not sufficient: production acceptance
must also generate a non-empty PDF with `page.pdf()` and inspect one downloaded
order containing Chinese text and a real OSS design image. On 2026-08-02,
`/usr/bin/chromium` generated a 37,646-byte Chinese test PDF in production.
Use the in-memory `page.pdf()` command in `docs/部署指南.md` §13 until
`scripts/deploy-smoke.mjs` performs that assertion itself.

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
- Use the Owner UI test button to confirm the real webhook.
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

Since 2026-08-21 two endpoints have one extra rejection: `daily-salary` returns
`400 { "error": "future date: <date>" }` when `body.date` is strictly after
today in Shanghai, and `hourly-payroll` returns
`400 { "error": "future month: <month>" }` when `body.month` is strictly after
the current Shanghai month. The scheduled calls carry no body and settle
yesterday / last month, so they never hit this branch; only a manual re-run with
an explicit body can. All other response shapes (`202`, `200`, `401`, `500`,
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

Current production deviation recorded on 2026-08-02: backup
`20260802-193420F` and continuous WAL are healthy, but only repo1 exists and
full retention is 2. Keep `BACKUP_REQUIRED_REPOS=2`; using `1` may diagnose the
existing repository but must not be reported as passing the production baseline.

## Current Release Source

Production runs `aa42ba0` from local branch
`codex/complex-client-data-layer-poc`. As of 2026-08-03, local `main` is still
`245be5c` and the development repository has no Git remote. Do not run a default
`git pull` or deploy `main` until the merge and remote recovery strategy is
explicitly resolved.

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
