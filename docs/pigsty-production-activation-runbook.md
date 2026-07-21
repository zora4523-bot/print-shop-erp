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
- Scheduler: `pg_cron`, `pg_net`
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
5. Keep `CRON_SECRET` and webhook/OSS secrets outside git.
6. Do not enable cron schedules until the app deployment is live and healthy.

## Extension Classes

Cluster restart or preload-sensitive:

| Extension | Why | Preload target |
|---|---|---|
| `pg_ivm` | Incrementally maintained inventory summaries | `shared_preload_libraries` before creating IMMVs |
| `pg_cron` | PostgreSQL scheduled HTTP calls | `shared_preload_libraries` |
| `pg_net` | HTTP calls from `pg_cron` jobs | `shared_preload_libraries` |
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
  - pg_bigm pg_pinyin pg_ivm pg_cron pg_net pg_stat_statements anon pgaudit pg_partman
```

Pigsty package aliases vary by OS and PostgreSQL major version. Verify package
availability on the actual target OS/PG version before applying.

## Phase 2: Configure Preload And Restart

Use Pigsty/Patroni config for existing clusters. Avoid changing one instance
with ad hoc `ALTER SYSTEM` while replicas use different settings.

Example for an existing cluster:

```bash
pg edit-config <pg_cluster> --force \
  -p shared_preload_libraries='pg_stat_statements,auto_explain,pg_cron,pg_net,pg_ivm,pgaudit,anon'

pg restart <pg_cluster>
```

If the cluster already preloads other libraries, merge rather than replace the
list. Keep `pg_stat_statements` before diagnostic/statistics extensions.

Recommended PostgreSQL parameters:

```yaml
pg_parameters:
  compute_query_id: 'on'
  cron.database_name: 'print_shop_erp'
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
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
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

Then set app-local scheduler settings. Prefer Pigsty-managed parameters for
cluster-level settings; these database settings are application secrets/config:

```sql
ALTER DATABASE print_shop_erp SET app.erp_base_url = 'https://erp.example.com';
ALTER DATABASE print_shop_erp SET app.cron_secret = '<same value as CRON_SECRET>';
```

Reconnect sessions after `ALTER DATABASE ... SET` before checking readiness.

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
  ready_for_pg_cron_http,
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
  unschedule_sql,
  manual_curl
FROM app_ops.cron_http_job_readiness
ORDER BY priority, job_name;
```

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

Only execute `schedule_sql` rows where `ready_to_schedule = true`, and only
after the app deployment and `CRON_SECRET` are confirmed.

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

## Phase 6: Enable Cron Jobs

After all scheduler readiness rows are ready, copy each `schedule_sql` from
`app_ops.cron_http_job_readiness` and execute it once.

Check scheduled jobs:

```sql
SELECT jobid, schedule, command, active, jobname
FROM cron.job
ORDER BY jobname;
```

Keep the `manual_curl` values from the readiness view as the break-glass
fallback if cron is temporarily disabled.

## Rollback

### Cron Jobs

Use generated rollback SQL:

```sql
SELECT job_name, unschedule_sql
FROM app_ops.cron_http_job_readiness
ORDER BY priority, job_name;
```

Then execute the `unschedule_sql` rows. Confirm:

```sql
SELECT jobname, active FROM cron.job ORDER BY jobname;
```

Optional after rollback:

```sql
ALTER DATABASE print_shop_erp RESET app.erp_base_url;
ALTER DATABASE print_shop_erp RESET app.cron_secret;
```

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
- `app_ops.ops_extension_readiness.ready_for_pg_cron_http = true` before cron
  scheduling.
- `cron.job` contains only the expected ERP jobs.
- `app_ops.security_extension_readiness.blockers` is empty or every remaining
  blocker has an explicit owner-approved exception.
- `app_ops.partition_readiness` is reviewed but no partition cutover is executed.
- Application checks pass:

```bash
pnpm prisma validate
pnpm tsc --noEmit --pretty false
pnpm eslint .
pnpm vitest run --reporter=dot --testTimeout=10000
```
