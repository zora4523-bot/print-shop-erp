-- CRON_SECRET must not be stored in a database-wide custom GUC. Every role
-- that can open a session can read such a setting with current_setting(), so
-- pg_cron + pg_net cannot safely share the application's bearer secret.
--
-- Retire the database HTTP scheduler, remove its jobs/config, and leave host
-- cron + deploy/run-cron.sh as the only supported scheduler. This migration is
-- deliberately fail-closed: a role that cannot remove production state must
-- not record a successful migration.

DO $migration$
DECLARE
  scheduled_job_id bigint;
  setting_role record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR scheduled_job_id IN EXECUTE $sql$
      SELECT jobid
        FROM cron.job
       WHERE jobname = ANY (ARRAY[
         'erp-daily-salary',
         'erp-hourly-payroll',
         'erp-cs-settle',
         'erp-generate-bills',
         'erp-outsource-overdue',
         'erp-cs-period-ending',
         'erp-order-overdue',
         'erp-order-export-cleanup'
       ]::text[])
          OR command LIKE '%app.cron_secret%'
          OR command LIKE '%/api/cron/%'
    $sql$
    LOOP
      BEGIN
        PERFORM cron.unschedule(scheduled_job_id);
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE EXCEPTION
            'cannot retire ERP pg_cron job %; run this migration as the scheduler owner or unschedule it as DBA first',
            scheduled_job_id;
      END;
    END LOOP;

    IF EXISTS (
      SELECT 1
        FROM cron.job
       WHERE jobname = ANY (ARRAY[
         'erp-daily-salary',
         'erp-hourly-payroll',
         'erp-cs-settle',
         'erp-generate-bills',
         'erp-outsource-overdue',
         'erp-cs-period-ending',
         'erp-order-overdue',
         'erp-order-export-cleanup'
       ]::text[])
          OR command LIKE '%app.cron_secret%'
          OR command LIKE '%/api/cron/%'
    ) THEN
      RAISE EXCEPTION 'ERP pg_cron jobs remain after unschedule';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_db_role_setting settings
      JOIN pg_database databases ON databases.oid = settings.setdatabase
     WHERE databases.datname = current_database()
       AND settings.setrole = 0
       AND EXISTS (
         SELECT 1
           FROM unnest(settings.setconfig) AS config(value)
          WHERE config.value LIKE 'app.cron_secret=%'
             OR config.value LIKE 'app.erp_base_url=%'
       )
  ) THEN
    BEGIN
      EXECUTE format(
        'ALTER DATABASE %I RESET app.cron_secret',
        current_database()
      );
      EXECUTE format(
        'ALTER DATABASE %I RESET app.erp_base_url',
        current_database()
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'cannot clear database scheduler settings; DBA must RESET app.cron_secret and app.erp_base_url before retrying this migration';
    END;
  END IF;

  -- Also remove role-in-database variants if an operator created them while
  -- following an early draft of the runbook. Never include the setting value
  -- in an error or log message.
  FOR setting_role IN
    SELECT roles.rolname
      FROM pg_db_role_setting settings
      JOIN pg_database databases ON databases.oid = settings.setdatabase
      JOIN pg_roles roles ON roles.oid = settings.setrole
     WHERE databases.datname = current_database()
       AND EXISTS (
         SELECT 1
           FROM unnest(settings.setconfig) AS config(value)
          WHERE config.value LIKE 'app.cron_secret=%'
             OR config.value LIKE 'app.erp_base_url=%'
       )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER ROLE %I IN DATABASE %I RESET app.cron_secret',
        setting_role.rolname,
        current_database()
      );
      EXECUTE format(
        'ALTER ROLE %I IN DATABASE %I RESET app.erp_base_url',
        setting_role.rolname,
        current_database()
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'cannot clear scheduler settings for database role %; DBA must reset them before retrying this migration',
          setting_role.rolname;
    END;
  END LOOP;

  -- ALTER ROLE ... SET applies to every database (`setdatabase = 0`). It is
  -- easy to use this variant while adapting the runbook, and leaving it behind
  -- would expose the bearer to every future session opened as that role.
  FOR setting_role IN
    SELECT roles.rolname
      FROM pg_db_role_setting settings
      JOIN pg_roles roles ON roles.oid = settings.setrole
     WHERE settings.setdatabase = 0
       AND settings.setrole <> 0
       AND EXISTS (
         SELECT 1
           FROM unnest(settings.setconfig) AS config(value)
          WHERE config.value LIKE 'app.cron_secret=%'
             OR config.value LIKE 'app.erp_base_url=%'
       )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER ROLE %I RESET app.cron_secret',
        setting_role.rolname
      );
      EXECUTE format(
        'ALTER ROLE %I RESET app.erp_base_url',
        setting_role.rolname
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'cannot clear role-wide scheduler settings for role %; DBA must reset them before retrying this migration',
          setting_role.rolname;
    END;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_db_role_setting settings
      LEFT JOIN pg_database databases ON databases.oid = settings.setdatabase
     WHERE (settings.setdatabase = 0 OR databases.datname = current_database())
       AND EXISTS (
         SELECT 1
           FROM unnest(settings.setconfig) AS config(value)
          WHERE config.value LIKE 'app.cron_secret=%'
             OR config.value LIKE 'app.erp_base_url=%'
       )
  ) THEN
    RAISE EXCEPTION
      'database or role scheduler settings remain after reset; DBA must remove app.cron_secret and app.erp_base_url before retrying this migration';
  END IF;
END
$migration$;

UPDATE app_ops.cron_http_job_candidate
   SET is_enabled = false,
       updated_at = now()
 WHERE is_enabled;

CREATE OR REPLACE VIEW app_ops.ops_extension_readiness AS
WITH settings AS (
  SELECT
    regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*') AS shared_libs,
    regexp_split_to_array(coalesce(current_setting('session_preload_libraries', true), ''), '\s*,\s*') AS session_libs,
    regexp_split_to_array(coalesce(current_setting('local_preload_libraries', true), ''), '\s*,\s*') AS local_libs,
    nullif(current_setting('cron.database_name', true), '') AS cron_database_name,
    nullif(current_setting('compute_query_id', true), '') AS compute_query_id
),
ext AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') AS pg_cron_available,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS pg_cron_installed,
    'pg_cron' = ANY(settings.shared_libs) AS pg_cron_preloaded,
    settings.cron_database_name IS NOT NULL AS cron_database_name_set,
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') AS pg_net_available,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS pg_net_installed,
    'pg_net' = ANY(settings.shared_libs) AS pg_net_preloaded,
    false AS app_erp_base_url_set,
    false AS app_cron_secret_set,
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements') AS pg_stat_statements_available,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS pg_stat_statements_installed,
    'pg_stat_statements' = ANY(settings.shared_libs) AS pg_stat_statements_preloaded,
    settings.compute_query_id IN ('on', 'auto') AS compute_query_id_enabled,
    (
      'auto_explain' = ANY(settings.shared_libs)
      OR 'auto_explain' = ANY(settings.session_libs)
      OR 'auto_explain' = ANY(settings.local_libs)
    ) AS auto_explain_loaded,
    EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'index_advisor') AS index_advisor_available,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'index_advisor') AS index_advisor_installed
  FROM settings
),
counts AS (
  SELECT
    (SELECT count(*)::integer FROM app_ops.cron_http_job_candidate WHERE is_enabled) AS enabled_cron_job_count,
    (SELECT count(*)::integer FROM app_ops.query_observation_candidate) AS query_observation_candidate_count
)
SELECT
  ext.*,
  counts.enabled_cron_job_count,
  counts.query_observation_candidate_count,
  false AS ready_for_pg_cron_http,
  (
    ext.pg_stat_statements_available
    AND ext.pg_stat_statements_installed
    AND ext.pg_stat_statements_preloaded
    AND ext.compute_query_id_enabled
  ) AS ready_for_query_stats,
  ext.auto_explain_loaded AS ready_for_auto_explain,
  (ext.index_advisor_available AND ext.index_advisor_installed) AS ready_for_index_advisor,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT ext.pg_stat_statements_available THEN 'pg_stat_statements_not_available' END,
    CASE WHEN NOT ext.pg_stat_statements_installed THEN 'pg_stat_statements_not_installed' END,
    CASE WHEN NOT ext.pg_stat_statements_preloaded THEN 'pg_stat_statements_not_preloaded' END,
    CASE WHEN NOT ext.compute_query_id_enabled THEN 'compute_query_id_not_enabled' END,
    CASE WHEN NOT ext.auto_explain_loaded THEN 'auto_explain_not_loaded' END,
    CASE WHEN NOT ext.index_advisor_available THEN 'index_advisor_not_available' END,
    CASE WHEN NOT ext.index_advisor_installed THEN 'index_advisor_not_installed' END
  ], NULL)::text[] AS blockers,
  ARRAY[
    'Database HTTP scheduling is retired: install deploy/run-cron.sh and deploy/crontab.example on the application host.',
    'Keep CRON_SECRET only in the root-readable CRON_SECRET_FILE; never store it in a PostgreSQL custom GUC.'
  ]::text[] COLLATE "C" AS recommended_scheduler_steps,
  ARRAY[
    'Use pg_stat_statements for aggregate latency/call-count diagnostics on dashboard, search, billing, and salary queries.',
    'Use auto_explain through session_preload_libraries or LOAD for short diagnostic windows only.',
    'Set auto_explain.log_parameter_max_length = 0 before collecting plans for salary or customer data paths.',
    'Use index_advisor only in diagnostic environments before creating new indexes in migrations.'
  ]::text[] AS recommended_observability_steps
FROM ext
CROSS JOIN counts;

CREATE OR REPLACE VIEW app_ops.cron_http_job_readiness AS
SELECT
  c.job_name,
  c.endpoint_path,
  c.schedule_expr,
  c.schedule_note,
  c.request_body,
  c.timeout_ms,
  c.is_enabled,
  c.priority,
  c.rationale,
  r.pg_cron_available,
  r.pg_cron_installed,
  r.pg_cron_preloaded,
  r.cron_database_name_set,
  r.pg_net_available,
  r.pg_net_installed,
  r.pg_net_preloaded,
  r.app_erp_base_url_set,
  r.app_cron_secret_set,
  false AS ready_to_schedule,
  ARRAY['database_http_scheduler_retired']::text[] AS blockers,
  NULL::text AS schedule_sql,
  format('SELECT cron.unschedule(%L);', c.job_name) AS unschedule_sql,
  format('/usr/local/sbin/print-shop-erp-cron %s', regexp_replace(c.endpoint_path, '^/api/cron/', '')) AS manual_curl
FROM app_ops.cron_http_job_candidate c
CROSS JOIN app_ops.ops_extension_readiness r
ORDER BY c.priority ASC, c.job_name ASC;
