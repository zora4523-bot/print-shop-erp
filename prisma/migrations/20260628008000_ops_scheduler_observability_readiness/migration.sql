-- PR-10: Pigsty scheduler and observability readiness.
--
-- pg_cron, pg_net, pg_stat_statements, and auto_explain require PostgreSQL
-- cluster/session configuration. This migration records the ERP job manifest
-- and diagnostic candidates, and exposes readiness views plus explicit
-- operator SQL. It does not silently schedule production jobs.

CREATE SCHEMA IF NOT EXISTS app_ops;

DO $$
DECLARE
  shared_libraries text[] := regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND 'pg_cron' = ANY(shared_libraries) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  ELSE
    RAISE NOTICE 'pg_cron is not available or not preloaded; app_ops readiness views will report the blocker';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')
     AND 'pg_net' = ANY(shared_libraries) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  ELSE
    RAISE NOTICE 'pg_net is not available or not preloaded; app_ops readiness views will report the blocker';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements')
     AND 'pg_stat_statements' = ANY(shared_libraries) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements';
  ELSE
    RAISE NOTICE 'pg_stat_statements is not available or not preloaded; app_ops readiness views will report the blocker';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'index_advisor') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS index_advisor CASCADE';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'index_advisor could not be created automatically: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'index_advisor is not available; app_ops readiness views will report the blocker';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_ops.cron_http_job_candidate (
  job_name text PRIMARY KEY,
  endpoint_path text NOT NULL,
  schedule_expr text NOT NULL,
  schedule_note text NOT NULL,
  request_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 30000,
  is_enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cron_http_job_endpoint_ck CHECK (endpoint_path ~ '^/api/cron/[a-z0-9-]+$'),
  CONSTRAINT cron_http_job_timeout_ck CHECK (timeout_ms BETWEEN 1000 AND 120000)
);

INSERT INTO app_ops.cron_http_job_candidate (
  job_name,
  endpoint_path,
  schedule_expr,
  schedule_note,
  request_body,
  timeout_ms,
  priority,
  rationale
)
VALUES
  (
    'erp-daily-salary',
    '/api/cron/daily-salary',
    '5 0 * * *',
    '每日 00:05 Asia/Shanghai，处理昨日机器师傅日薪；body 留空让 endpoint 自算昨日日期',
    '{}'::jsonb,
    45000,
    10,
    'daily salary is the highest-risk missed payroll batch and already returns counts only'
  ),
  (
    'erp-hourly-payroll',
    '/api/cron/hourly-payroll',
    '5 0 1 * *',
    '每月 1 日 00:05 Asia/Shanghai，结算上月时薪工月结',
    '{}'::jsonb,
    60000,
    20,
    'hourly payroll endpoint defaults to previous Shanghai month and returns counts only'
  ),
  (
    'erp-cs-settle',
    '/api/cron/cs-settle',
    '10 0 * * *',
    '每日 00:10 Asia/Shanghai，结算已到期客服周期',
    '{}'::jsonb,
    60000,
    30,
    'customer-service period settlement must run after the date boundary and returns counts only'
  ),
  (
    'erp-generate-bills',
    '/api/cron/generate-bills',
    '30 0 1 * *',
    '每月 1 日 00:30 Asia/Shanghai，生成上月销售应收账单',
    '{}'::jsonb,
    60000,
    40,
    'billing generation endpoint defaults to previous Shanghai month and returns counts only'
  ),
  (
    'erp-outsource-overdue',
    '/api/cron/outsource-overdue',
    '0 9 * * *',
    '每日 09:00 Asia/Shanghai，工作时间开始时扫描超期外协',
    '{}'::jsonb,
    30000,
    50,
    'overdue outsourcing is operational alerting and should run during the workday'
  ),
  (
    'erp-cs-period-ending',
    '/api/cron/cs-period-ending',
    '10 9 * * *',
    '每日 09:10 Asia/Shanghai，扫描 7 天内将到期客服周期',
    '{}'::jsonb,
    30000,
    60,
    'customer-service ending-period reminders should run during the workday'
  )
ON CONFLICT (job_name) DO UPDATE
SET
  endpoint_path = EXCLUDED.endpoint_path,
  schedule_expr = EXCLUDED.schedule_expr,
  schedule_note = EXCLUDED.schedule_note,
  request_body = EXCLUDED.request_body,
  timeout_ms = EXCLUDED.timeout_ms,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

CREATE TABLE IF NOT EXISTS app_ops.query_observation_candidate (
  candidate_key text PRIMARY KEY,
  route_path text NOT NULL,
  business_area text NOT NULL,
  suggested_extension text NOT NULL,
  representative_sql text NOT NULL,
  match_pattern text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT query_observation_extension_ck CHECK (
    suggested_extension IN ('pg_stat_statements', 'auto_explain', 'index_advisor')
  )
);

INSERT INTO app_ops.query_observation_candidate (
  candidate_key,
  route_path,
  business_area,
  suggested_extension,
  representative_sql,
  match_pattern,
  priority,
  rationale
)
VALUES
  (
    'order-search',
    '/orders?q=...',
    '工单搜索',
    'pg_stat_statements',
    'SELECT id FROM public."Order" WHERE "orderNo" ILIKE $1 OR "customerRef" ILIKE $1 OR "receiverName" ILIKE $1 OR "receiverPhone" ILIKE $1 OR "trackingNo" ILIKE $1 OR "expressCode" ILIKE $1;',
    '%"Order"%',
    10,
    '工单搜索是高频入口，pg_trgm/pg_bigm/pg_pinyin 上线后需要持续看 calls、mean_exec_time、rows'
  ),
  (
    'product-search-index-advisor',
    '/owner/products?q=...',
    '商品搜索',
    'index_advisor',
    'SELECT id FROM public."Product" WHERE name ILIKE ''%红包%'' OR code ILIKE ''%红包%'' OR specification ILIKE ''%红包%'' OR "paperType" ILIKE ''%红包%'';',
    '%"Product"%',
    20,
    '商品字典会继续增加分类、编码、拼音检索；诊断环境用 index_advisor 复核是否还缺组合索引'
  ),
  (
    'owner-dashboard',
    '/owner',
    '老板 Dashboard',
    'pg_stat_statements',
    'SELECT count(*) FROM public."Order" WHERE "createdAt" >= $1 AND "createdAt" < $2;',
    '%"Order"%',
    30,
    'Dashboard 多个日期范围统计会在首页反复执行，适合用 pg_stat_statements 观察总耗时'
  ),
  (
    'bill-list',
    '/owner/bills',
    '账单列表',
    'pg_stat_statements',
    'SELECT id FROM public."Bill" WHERE period = $1 ORDER BY "createdAt" DESC;',
    '%"Bill"%',
    40,
    '账单列表和月度生成依赖 period/status 查询，生产数据增长后要确认索引命中'
  ),
  (
    'material-inventory-dashboard',
    'future material dashboard',
    '库存看板',
    'auto_explain',
    'SELECT * FROM public.material_inventory_movement_summary;',
    '%material_inventory_movement_summary%',
    50,
    '库存看板从 pg_ivm/fallback view 读取，慢计划需要 auto_explain 捕捉真实执行计划'
  ),
  (
    'salary-summary',
    '/owner/salary',
    '薪资汇总',
    'auto_explain',
    'SELECT count(*) FROM public."DailyWorkerSalary" WHERE date >= $1 AND date < $2;',
    '%"DailyWorkerSalary"%',
    60,
    '薪资页涉及金额快照与日期过滤，慢查询要记录计划但避免记录参数值'
  )
ON CONFLICT (candidate_key) DO UPDATE
SET
  route_path = EXCLUDED.route_path,
  business_area = EXCLUDED.business_area,
  suggested_extension = EXCLUDED.suggested_extension,
  representative_sql = EXCLUDED.representative_sql,
  match_pattern = EXCLUDED.match_pattern,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

CREATE OR REPLACE VIEW app_ops.ops_extension_readiness AS
WITH settings AS (
  SELECT
    regexp_split_to_array(coalesce(current_setting('shared_preload_libraries', true), ''), '\s*,\s*') AS shared_libs,
    regexp_split_to_array(coalesce(current_setting('session_preload_libraries', true), ''), '\s*,\s*') AS session_libs,
    regexp_split_to_array(coalesce(current_setting('local_preload_libraries', true), ''), '\s*,\s*') AS local_libs,
    nullif(current_setting('cron.database_name', true), '') AS cron_database_name,
    nullif(current_setting('app.erp_base_url', true), '') AS app_erp_base_url,
    nullif(current_setting('app.cron_secret', true), '') AS app_cron_secret,
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
    settings.app_erp_base_url IS NOT NULL AS app_erp_base_url_set,
    settings.app_cron_secret IS NOT NULL AS app_cron_secret_set,

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
  (
    ext.pg_cron_available
    AND ext.pg_cron_installed
    AND ext.pg_cron_preloaded
    AND ext.cron_database_name_set
    AND ext.pg_net_available
    AND ext.pg_net_installed
    AND ext.pg_net_preloaded
    AND ext.app_erp_base_url_set
    AND ext.app_cron_secret_set
  ) AS ready_for_pg_cron_http,
  (
    ext.pg_stat_statements_available
    AND ext.pg_stat_statements_installed
    AND ext.pg_stat_statements_preloaded
    AND ext.compute_query_id_enabled
  ) AS ready_for_query_stats,
  ext.auto_explain_loaded AS ready_for_auto_explain,
  (ext.index_advisor_available AND ext.index_advisor_installed) AS ready_for_index_advisor,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_cron_available THEN 'pg_cron_not_available' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_cron_installed THEN 'pg_cron_not_installed' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_cron_preloaded THEN 'pg_cron_not_preloaded' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.cron_database_name_set THEN 'cron_database_name_not_set' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_net_available THEN 'pg_net_not_available' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_net_installed THEN 'pg_net_not_installed' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.pg_net_preloaded THEN 'pg_net_not_preloaded' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.app_erp_base_url_set THEN 'app_erp_base_url_not_set' END,
    CASE WHEN counts.enabled_cron_job_count > 0 AND NOT ext.app_cron_secret_set THEN 'app_cron_secret_not_set' END,
    CASE WHEN NOT ext.pg_stat_statements_available THEN 'pg_stat_statements_not_available' END,
    CASE WHEN NOT ext.pg_stat_statements_installed THEN 'pg_stat_statements_not_installed' END,
    CASE WHEN NOT ext.pg_stat_statements_preloaded THEN 'pg_stat_statements_not_preloaded' END,
    CASE WHEN NOT ext.compute_query_id_enabled THEN 'compute_query_id_not_enabled' END,
    CASE WHEN NOT ext.auto_explain_loaded THEN 'auto_explain_not_loaded' END,
    CASE WHEN NOT ext.index_advisor_available THEN 'index_advisor_not_available' END,
    CASE WHEN NOT ext.index_advisor_installed THEN 'index_advisor_not_installed' END
  ], NULL)::text[] AS blockers,
  ARRAY[
    'Pigsty cluster config: include pg_cron, pg_net, and pg_stat_statements in shared_preload_libraries, then restart PostgreSQL.',
    format('ALTER SYSTEM SET cron.database_name = %L;', current_database()),
    'CREATE EXTENSION IF NOT EXISTS pg_cron;',
    'CREATE EXTENSION IF NOT EXISTS pg_net;',
    'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;',
    'CREATE EXTENSION IF NOT EXISTS index_advisor CASCADE;',
    'ALTER SYSTEM SET compute_query_id = on;',
    format('ALTER DATABASE %I SET app.erp_base_url = %L;', current_database(), 'https://erp.example.com'),
    format('ALTER DATABASE %I SET app.cron_secret = %L;', current_database(), '<same value as CRON_SECRET>')
  ]::text[] AS recommended_scheduler_steps,
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
  (
    c.is_enabled
    AND r.pg_cron_available
    AND r.pg_cron_installed
    AND r.pg_cron_preloaded
    AND r.cron_database_name_set
    AND r.pg_net_available
    AND r.pg_net_installed
    AND r.pg_net_preloaded
    AND r.app_erp_base_url_set
    AND r.app_cron_secret_set
  ) AS ready_to_schedule,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT c.is_enabled THEN 'job_disabled' END,
    CASE WHEN NOT r.pg_cron_available THEN 'pg_cron_not_available' END,
    CASE WHEN NOT r.pg_cron_installed THEN 'pg_cron_not_installed' END,
    CASE WHEN NOT r.pg_cron_preloaded THEN 'pg_cron_not_preloaded' END,
    CASE WHEN NOT r.cron_database_name_set THEN 'cron_database_name_not_set' END,
    CASE WHEN NOT r.pg_net_available THEN 'pg_net_not_available' END,
    CASE WHEN NOT r.pg_net_installed THEN 'pg_net_not_installed' END,
    CASE WHEN NOT r.pg_net_preloaded THEN 'pg_net_not_preloaded' END,
    CASE WHEN NOT r.app_erp_base_url_set THEN 'app_erp_base_url_not_set' END,
    CASE WHEN NOT r.app_cron_secret_set THEN 'app_cron_secret_not_set' END
  ], NULL)::text[] AS blockers,
  format(
    'SELECT cron.schedule(%L, %L, %L);',
    c.job_name,
    c.schedule_expr,
    format(
      'SELECT net.http_post(url := current_setting(''app.erp_base_url'', true) || %L, body := %L::jsonb, headers := jsonb_build_object(''Authorization'', ''Bearer '' || current_setting(''app.cron_secret'', true), ''Content-Type'', ''application/json''), timeout_milliseconds := %s);',
      c.endpoint_path,
      c.request_body::text,
      c.timeout_ms
    )
  ) AS schedule_sql,
  format('SELECT cron.unschedule(%L);', c.job_name) AS unschedule_sql,
  format(
    'curl -X POST "$ERP_BASE_URL%s" -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d %L',
    c.endpoint_path,
    c.request_body::text
  ) AS manual_curl
FROM app_ops.cron_http_job_candidate c
CROSS JOIN app_ops.ops_extension_readiness r
ORDER BY c.priority ASC, c.job_name ASC;

CREATE OR REPLACE VIEW app_ops.query_observability_readiness AS
SELECT
  q.candidate_key,
  q.route_path,
  q.business_area,
  q.suggested_extension,
  q.representative_sql,
  q.match_pattern,
  q.priority,
  q.rationale,
  r.ready_for_query_stats,
  r.ready_for_auto_explain,
  r.ready_for_index_advisor,
  CASE q.suggested_extension
    WHEN 'pg_stat_statements' THEN
      format(
        'SELECT queryid, calls, mean_exec_time, rows, query FROM pg_stat_statements WHERE query ILIKE %L ORDER BY total_exec_time DESC LIMIT 20;',
        q.match_pattern
      )
    WHEN 'auto_explain' THEN
      'LOAD ''auto_explain''; SET auto_explain.log_min_duration = ''1s''; SET auto_explain.log_analyze = true; SET auto_explain.log_parameter_max_length = 0;'
    WHEN 'index_advisor' THEN
      format('SELECT * FROM index_advisor(%L);', q.representative_sql)
  END AS diagnostic_sql,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN q.suggested_extension = 'pg_stat_statements' AND NOT r.ready_for_query_stats THEN 'pg_stat_statements_not_ready' END,
    CASE WHEN q.suggested_extension = 'auto_explain' AND NOT r.ready_for_auto_explain THEN 'auto_explain_not_loaded' END,
    CASE WHEN q.suggested_extension = 'index_advisor' AND NOT r.ready_for_index_advisor THEN 'index_advisor_not_ready' END
  ], NULL)::text[] AS blockers
FROM app_ops.query_observation_candidate q
CROSS JOIN app_ops.ops_extension_readiness r
ORDER BY q.priority ASC, q.candidate_key ASC;
