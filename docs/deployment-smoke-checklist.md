# Backup And Deployment Smoke Checklist

Use this checklist before deployment. The local smoke script does not require
production secrets and does not run production database operations.

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
pnpm prisma validate
pnpm prisma migrate status
pnpm tsc --noEmit --pretty false
pnpm eslint .
pnpm vitest run --reporter=dot --testTimeout=10000
pnpm build
```

For production route checks, point the script to a deployed staging or
post-deploy production URL and keep seed disabled:

```bash
NODE_ENV=production \
NOTIFICATION_MOCK_MODE=false \
DEPLOY_SMOKE_BASE_URL=https://erp.example.com \
pnpm deploy:smoke --require-base-url
```

The script uses an invalid cron token on purpose. A healthy production cron
endpoint should return `401`; if `CRON_SECRET` is missing it returns `503`.
Both responses prove the endpoint did not execute the job.

## PDF Browser

PDF generation uses Puppeteer-managed Chrome. Install during image build or
server provisioning:

```bash
npx puppeteer browsers install chrome
```

Smoke check:

```bash
pnpm deploy:smoke --skip-build --require-base-url
```

If Puppeteer cannot launch Chrome, PDF download routes can fail with
`Could not find Chrome`.

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

After Pigsty `pg_cron` activation, copy `schedule_sql` only from ready rows:

```sql
SELECT job_name, ready_to_schedule, blockers, schedule_sql, unschedule_sql
FROM app_ops.cron_http_job_readiness
ORDER BY priority, job_name;
```

## pgBackRest Placeholders

Pigsty owns backups through pgBackRest. This repository does not run backup
commands automatically.

Production checklist for operations:

```bash
pgbackrest --stanza=<stanza> check
pgbackrest --stanza=<stanza> info
```

Before high-risk migrations:

- Confirm latest full or differential backup exists.
- Confirm WAL archiving is current.
- Confirm a restore drill has succeeded recently.
- Record the stanza name, backup label, and target restore time.

Do not add pgBackRest credentials to `.env`, CI variables for this app, or git.

## App Readiness SQL

Open `/owner/pigsty` after deploy or run:

```sql
SELECT surface_key, ready_for_search, blockers
FROM app_ops.search_index_readiness
ORDER BY priority, surface_key;

SELECT ready_for_pg_cron_http, ready_for_query_stats, blockers
FROM app_ops.ops_extension_readiness;

SELECT anon_installed, pgaudit_installed, blockers
FROM app_ops.security_extension_readiness;

SELECT parent_table, blockers
FROM app_ops.partition_readiness
ORDER BY priority, parent_table;
```

Partition blockers are expected until a manual A09 cutover plan exists.
