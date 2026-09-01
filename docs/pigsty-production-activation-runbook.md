# Pigsty Production Activation Runbook

This runbook activates the Pigsty PostgreSQL extensions already planned for this
ERP. It is an operations guide only. Do not run these commands against
production without a backup, maintenance window, and owner approval.

Primary references:

- Pigsty extension management:
  https://pigsty.io/docs/pgsql/admin/ext/
- Pigsty extension parameters:
  https://pigsty.io/docs/pgsql/param/#pg_extensions
- Pigsty extension creation:
  https://pigsty.io/docs/pgsql/ext/create/
- Pigsty preload configuration:
  https://pigsty.io/docs/pgsql/ext/config/

## Scope

Covered extensions:

- Search: `pg_pinyin`, `pg_bigm`
- Inventory summaries: `pg_ivm`
- Scheduler is intentionally out of scope: production uses host crontab with a
  root-only secret file. Database HTTP scheduling is retired.
- Query observability: `pg_stat_statements`
- Masked test/demo export: `anon`
- DBA audit logging: `pgaudit`
- Future partition maintenance: `pg_partman`

Not covered:

- Production partition cutover. See A09 before changing table structures.
- Applying anonymization to a real production database.
- Replacing Auth.js, app RBAC, or Server Action permission checks.

## Safety Gates

Before any production activation:

1. Confirm current app revision includes the readiness migrations.
2. Confirm pgBackRest backup is green and a restore drill has been tested.
3. Apply and verify this runbook on staging restored from production-like data.
4. Confirm `/owner/pigsty` can be opened by an ADMIN user.
5. Keep `CRON_SECRET` and webhook/OSS secrets outside git and PostgreSQL.
6. Do not create `pg_cron` + `pg_net` HTTP schedules for this application.

## Extension Classes

Cluster restart or preload-sensitive:

| Extension | Why | Preload target |
|---|---|---|
| `pg_ivm` | Incrementally maintained inventory summaries | `shared_preload_libraries` before creating IMMVs |
| `pg_stat_statements` | Query statistics | `shared_preload_libraries` |
| `pgaudit` | Database audit logging | `shared_preload_libraries` |
| `anon` | Dynamic masking for test/demo export role | `shared_preload_libraries` or database/session preload |

No cluster restart normally required:

| Extension | Why |
|---|---|
| `pg_pinyin` | Generated pinyin search columns |
| `pg_bigm` | Optional short Chinese fuzzy search indexes |
| `pg_partman` | Partition maintenance extension; table cutover remains manual |

## Phase 1: Install Packages

For new Pigsty clusters, add packages to `pg_extensions` before cluster
initialization. For existing clusters, install the packages on all PostgreSQL
nodes first, then configure preload libraries through Pigsty/Patroni.

Example Pigsty config fragment:

```yaml
pg_extensions:
  - pg_bigm pg_pinyin pg_ivm pg_stat_statements anon pgaudit pg_partman
```

Pigsty package aliases vary by OS and PostgreSQL major version. Verify package
availability on the actual target OS/PG version before applying.

## Phase 2: Configure Preload And Restart

Use Pigsty/Patroni config for existing clusters. Avoid changing one instance
with ad hoc `ALTER SYSTEM` while replicas use different settings.

Example for an existing cluster:

```bash
pg edit-config <pg_cluster> --force \
  -p shared_preload_libraries='pg_stat_statements,auto_explain,pg_ivm,pgaudit,anon'

pg restart <pg_cluster>
```

If the cluster already preloads other libraries, merge rather than replace the
list. Keep `pg_stat_statements` before diagnostic/statistics extensions.

Recommended PostgreSQL parameters:

```yaml
pg_parameters:
  compute_query_id: 'on'
  pgaudit.log: 'write, ddl, role'
  pgaudit.log_parameter: 'off'
  pgaudit.log_relation: 'on'
```

Do not set `pgaudit.log_parameter = on` for this ERP. It can leak customer,
salary, bill, or price data into PostgreSQL logs.

## Phase 3: Create Database Extensions

Run in the ERP database after the package and preload step is complete:

```sql
CREATE EXTENSION IF NOT EXISTS pg_bigm;
CREATE EXTENSION IF NOT EXISTS pg_pinyin;
CREATE EXTENSION IF NOT EXISTS pg_ivm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman;

CREATE EXTENSION IF NOT EXISTS anon CASCADE;
SELECT anon.init();

CREATE EXTENSION IF NOT EXISTS pgaudit;
DO $$
BEGIN
  CREATE ROLE erp_auditor;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
```

Do **not** store scheduler credentials as PostgreSQL settings. If an earlier
runbook was applied, remove its jobs and settings as DBA before (or while)
applying `20260822102000_retire_database_http_scheduler`:

```sql
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname LIKE 'erp-%'
   OR command LIKE '%app.cron_secret%'
   OR command LIKE '%/api/cron/%';
ALTER DATABASE print_shop_erp RESET app.erp_base_url;
ALTER DATABASE print_shop_erp RESET app.cron_secret;
```

The migration fails loudly if its role can see this legacy state but cannot
remove it. Resolve the ownership/privilege issue and retry; do not mark the
migration applied manually while jobs or settings remain.

`RESET` only changes settings inherited by **new** database sessions. Sessions
that connected before the reset can retain the old `app.cron_secret`, so the
database-stored value must never be reused. Immediately after this retirement,
generate a new secret and update both restricted locations before starting the
new app revision:

1. Set application-server `CRON_SECRET` for the endpoint verifier. Restrict the
   service environment or `.env` to the application service account.
2. Write the exact same value to the host scheduler's `CRON_SECRET_FILE` as a
   root-owned regular file with mode `0600`.
3. Restart/reload the Web and worker processes with the new environment, then
   trigger one endpoint and confirm it reaches `SUCCEEDED`.

This rotation invalidates the value retained by any old PostgreSQL session.
The secret must not appear in PostgreSQL, git, crontab, process arguments, or
shell history.

## Phase 4: Apply App Migrations

Run the normal application migration workflow only after the cluster restart
and extension creation are complete:

```bash
pnpm prisma migrate deploy
pnpm prisma validate
```

If `20260628005000_inventory_ivm_summary` already ran before `pg_ivm` was
preloaded, it created ordinary views instead of IMMVs. In that case, schedule a
separate maintenance change to drop and recreate
`material_inventory_movement_summary` and `material_inventory_daily_summary`
after `pg_ivm` is ready. Do not do this during an ordinary deploy.

## Phase 5: Readiness SQL

These checks are the SQL backing `/owner/pigsty`.

### Search

```sql
SELECT
  surface_key,
  route_path,
  ready_for_search,
  missing_required_extensions,
  missing_optional_extensions,
  missing_required_indexes,
  missing_optional_indexes,
  blockers,
  explain_sql
FROM app_ops.search_index_readiness
ORDER BY priority, surface_key;
```

`pg_pinyin` is required for pinyin search readiness. `pg_bigm` is optional but
recommended for short Chinese terms.

### Inventory `pg_ivm`

```sql
SELECT
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_ivm') AS pg_ivm_installed,
  'pg_ivm' = ANY(regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*'))
    OR 'pg_ivm' = ANY(regexp_split_to_array(coalesce(current_setting('session_preload_libraries', true), ''), '\s*,\s*'))
    AS pg_ivm_preloaded,
  to_regclass('material_inventory_movement_summary') AS movement_summary,
  to_regclass('material_inventory_daily_summary') AS daily_summary;
```

```sql
SELECT
  c.relname,
  c.relkind
FROM pg_class c
WHERE c.relname IN (
  'material_inventory_movement_summary',
  'material_inventory_daily_summary'
)
ORDER BY c.relname;
```

Expected production target after the dedicated IVM activation is incrementally
maintained views. If ordinary views are present, the app still works but does
not get `pg_ivm` write-time maintenance benefits.

### Scheduler And Observability

```sql
SELECT
  ready_for_query_stats,
  ready_for_auto_explain,
  ready_for_index_advisor,
  blockers,
  recommended_scheduler_steps,
  recommended_observability_steps
FROM app_ops.ops_extension_readiness;
```

```sql
SELECT
  job_name,
  endpoint_path,
  schedule_expr,
  ready_to_schedule,
  blockers,
  schedule_sql,
  manual_curl
FROM app_ops.cron_http_job_readiness
ORDER BY priority, job_name;
```

`ready_to_schedule` is always false, `schedule_sql` is null, and `manual_curl`
is now the safe host command (`/usr/local/sbin/print-shop-erp-cron <endpoint>`).
This retained view is an inventory/retirement aid, not an activation surface.

```sql
SELECT
  candidate_key,
  route_path,
  business_area,
  suggested_extension,
  blockers,
  diagnostic_sql
FROM app_ops.query_observability_readiness
ORDER BY priority, candidate_key;
```

### Security: `anon` And `pgaudit`

```sql
SELECT
  anon_available,
  anon_installed,
  anon_preloaded,
  pgaudit_available,
  pgaudit_installed,
  pgaudit_preloaded,
  policy_count,
  anon_label_policy_count,
  anon_label_applied_count,
  manual_redact_policy_count,
  audit_only_policy_count,
  missing_column_count,
  audit_table_count,
  blockers,
  recommended_anon_steps,
  recommended_pgaudit_steps
FROM app_ops.security_extension_readiness;
```

```sql
SELECT
  table_schema,
  table_name,
  column_name,
  masking_strategy,
  column_exists,
  anon_label_applied,
  apply_anon_label_sql,
  handling_note
FROM app_ops.sensitive_column_readiness
ORDER BY priority, table_name, column_name;
```

```sql
SELECT
  table_schema,
  table_name,
  audit_operations,
  all_columns_exist,
  sensitive_columns,
  audit_grant_sql
FROM app_ops.security_audit_table_readiness
ORDER BY table_schema, table_name;
```

Apply `anon` labels only for masked test/demo export roles. Do not run
`anon.anonymize_database()` or `anon.anonymize_table()` against production.

### Partition Readiness

```sql
SELECT
  parent_table,
  control_column,
  partition_interval,
  retention,
  pg_partman_available,
  pg_partman_installed,
  parent_exists,
  parent_is_partitioned,
  primary_key_columns,
  primary_key_includes_control_column,
  incoming_foreign_key_count,
  blockers,
  create_parent_sql,
  run_maintenance_sql
FROM app_ops.partition_readiness
ORDER BY priority, parent_table;
```

Do not execute `create_parent_sql` until A09 has a table-by-table cutover plan.
Current Prisma tables still have single-column primary keys and incoming foreign
keys that need a manual migration strategy.

## Phase 6: Enable Host Cron Jobs

Follow `docs/部署指南.md` §10: install `deploy/run-cron.sh`; place the
rotated bearer value in application-server `CRON_SECRET` for verification and
in the root-owned `0600` `CRON_SECRET_FILE` for the host scheduler; then install
`deploy/crontab.example` with `sudo crontab`. Verify PostgreSQL contains no
legacy ERP HTTP jobs:

```sql
SELECT jobid, jobname
FROM cron.job
WHERE jobname LIKE 'erp-%'
   OR command LIKE '%app.cron_secret%'
   OR command LIKE '%/api/cron/%';
```

The query must return zero rows. `deploy/run-cron.sh` rejects symlinks,
non-regular files, non-root owners, and any mode other than `0600`; neither the
secret nor an expanded Authorization header may appear in crontab, process
arguments, PostgreSQL settings, or shell history.

## Rollback

### Cron Jobs

To pause scheduling, remove or comment the ERP entries with `sudo crontab -e`.
Keep the root-only secret file for a short rollback window, then rotate/delete
it through the normal secret-management procedure. Do not roll back to the
database HTTP scheduler.

### Audit Logging

To disable database audit logging:

1. Remove `pgaudit` from `shared_preload_libraries` through Pigsty/Patroni.
2. Reset audit parameters through Pigsty config.
3. Restart PostgreSQL.
4. Optionally run:

```sql
REVOKE ALL ON SCHEMA public FROM erp_auditor;
DROP ROLE IF EXISTS erp_auditor;
DROP EXTENSION IF EXISTS pgaudit;
```

Do not delete retained PostgreSQL logs during incident review.

### Dynamic Masking

To disable masked export behavior:

```sql
ALTER DATABASE print_shop_erp RESET session_preload_libraries;
ALTER DATABASE print_shop_erp RESET anon.transparent_dynamic_masking;
DROP ROLE IF EXISTS erp_masked_export;
```

Remove `anon` from `shared_preload_libraries` only through Pigsty/Patroni and
restart. Dropping `anon` is optional and should be done only after checking no
masked export role depends on it.

### Inventory Summaries

If `pg_ivm` causes write performance issues, disable by a planned migration that
replaces IMMVs with ordinary views. Do not drop summary objects during business
hours; `/foreman/materials` reads them.

### Search Extensions

Do not drop `pg_pinyin`, `pg_bigm`, or search indexes as a rollback shortcut.
Missing search extensions can break readiness and generated pinyin behavior.
Disable UI rollout or revert the application deploy instead.

### Partition Maintenance

If only `pg_partman` was installed, rollback is simply:

```sql
DROP EXTENSION IF EXISTS pg_partman;
```

If partitioned tables were already cut over, do not use this runbook. Follow the
A09 cutover rollback plan.

## Final Acceptance Checklist

- `/owner/pigsty` shows no blockers for search required extensions/indexes.
- Host crontab contains exactly the expected ERP jobs and uses
  `/usr/local/sbin/print-shop-erp-cron`.
- `cron.job` contains no ERP HTTP jobs, and PostgreSQL has no
  `app.cron_secret` setting.
- The pre-retirement cron secret was rotated; application-server `CRON_SECRET`
  and the root-owned `0600` `CRON_SECRET_FILE` contain the same new value.
- `app_ops.security_extension_readiness.blockers` is empty or every remaining
  blocker has an explicit owner-approved exception.
- `app_ops.partition_readiness` is reviewed but no partition cutover is executed.
- Application checks pass:

```bash
pnpm prisma validate
pnpm typecheck
pnpm eslint .
pnpm vitest run --reporter=dot --testTimeout=10000
```
