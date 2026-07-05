-- PR-8: pg_partman readiness plan for long-growing ledger/log tables.
--
-- Do not convert existing Prisma-managed tables to partitioned tables here.
-- PostgreSQL requires unique constraints on partitioned tables to include the
-- partition key; the current tables use a single-column `id` primary key.
-- This migration installs pg_partman when available and exposes a readiness
-- view that lists the exact blockers before an ops-led repartitioning cutover.

CREATE SCHEMA IF NOT EXISTS app_ops;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS partman;
    CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman;
  ELSE
    RAISE NOTICE 'pg_partman extension is not available; partition readiness view will still be created';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app_ops.partition_candidate (
  parent_table TEXT PRIMARY KEY,
  control_column TEXT NOT NULL,
  partition_interval TEXT NOT NULL DEFAULT '1 month',
  retention TEXT,
  retention_keep_table BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 100,
  rationale TEXT NOT NULL
);

INSERT INTO app_ops.partition_candidate (
  parent_table,
  control_column,
  partition_interval,
  retention,
  retention_keep_table,
  priority,
  rationale
) VALUES
  (
    'public."MaterialTransaction"',
    'occurredAt',
    '1 month',
    '36 months',
    true,
    10,
    '物料流水长期增长；按发生时间做月分区，保留归档分区表。'
  ),
  (
    'public."OrderLog"',
    'createdAt',
    '1 month',
    '36 months',
    true,
    20,
    '工单操作日志持续增长；按创建时间做月分区，保留审计证据。'
  ),
  (
    'public."NotificationLog"',
    'createdAt',
    '1 month',
    '18 months',
    true,
    30,
    '推送日志增长快但业务价值衰减；按创建时间做月分区，先保留归档表。'
  )
ON CONFLICT (parent_table) DO UPDATE
SET
  control_column = EXCLUDED.control_column,
  partition_interval = EXCLUDED.partition_interval,
  retention = EXCLUDED.retention,
  retention_keep_table = EXCLUDED.retention_keep_table,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale;

CREATE OR REPLACE VIEW app_ops.partition_readiness AS
WITH relation_info AS (
  SELECT
    candidate.*,
    to_regclass(candidate.parent_table) AS parent_oid,
    EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'pg_partman'
    ) AS pg_partman_available,
    EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_partman'
    ) AS pg_partman_installed
  FROM app_ops.partition_candidate candidate
),
primary_keys AS (
  SELECT
    con.conrelid,
    array_agg(att.attname::TEXT ORDER BY key.ordinality) AS pk_columns
  FROM pg_constraint con
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality)
    ON true
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = key.attnum
  WHERE con.contype = 'p'
  GROUP BY con.conrelid
),
incoming_foreign_keys AS (
  SELECT confrelid, count(*)::INTEGER AS fk_count
  FROM pg_constraint
  WHERE contype = 'f'
  GROUP BY confrelid
)
SELECT
  relation_info.parent_table,
  relation_info.control_column,
  relation_info.partition_interval,
  relation_info.retention,
  relation_info.retention_keep_table,
  relation_info.priority,
  relation_info.rationale,
  relation_info.pg_partman_available,
  relation_info.pg_partman_installed,
  relation_info.parent_oid IS NOT NULL AS parent_exists,
  cls.relkind = 'p' AS parent_is_partitioned,
  ctrl.attname IS NOT NULL AS control_column_exists,
  COALESCE(primary_keys.pk_columns, ARRAY[]::TEXT[]) AS primary_key_columns,
  COALESCE(relation_info.control_column = ANY(primary_keys.pk_columns), false)
    AS primary_key_includes_control_column,
  COALESCE(incoming_foreign_keys.fk_count, 0) AS incoming_foreign_key_count,
  array_remove(ARRAY[
    CASE
      WHEN relation_info.parent_oid IS NULL
      THEN 'parent_table_missing'
    END,
    CASE
      WHEN relation_info.parent_oid IS NOT NULL AND cls.relkind <> 'p'
      THEN 'parent_table_is_not_partitioned'
    END,
    CASE
      WHEN relation_info.parent_oid IS NOT NULL AND ctrl.attname IS NULL
      THEN 'control_column_missing'
    END,
    CASE
      WHEN COALESCE(array_length(primary_keys.pk_columns, 1), 0) > 0
       AND NOT COALESCE(relation_info.control_column = ANY(primary_keys.pk_columns), false)
      THEN 'primary_key_does_not_include_control_column'
    END,
    CASE
      WHEN COALESCE(incoming_foreign_keys.fk_count, 0) > 0
      THEN 'incoming_foreign_keys_need_cutover_plan'
    END,
    CASE
      WHEN NOT relation_info.pg_partman_available
      THEN 'pg_partman_not_available'
    END,
    CASE
      WHEN relation_info.pg_partman_available
       AND NOT relation_info.pg_partman_installed
      THEN 'pg_partman_not_installed'
    END
  ], NULL) AS blockers,
  CASE
    WHEN cls.relkind = 'p'
     AND ctrl.attname IS NOT NULL
     AND relation_info.pg_partman_installed
    THEN format(
      'SELECT partman.create_parent(p_parent_table := %L, p_control := %L, p_interval := %L);',
      relation_info.parent_table,
      relation_info.control_column,
      relation_info.partition_interval
    )
    ELSE NULL
  END AS create_parent_sql,
  CASE
    WHEN relation_info.pg_partman_installed
    THEN 'SELECT partman.run_maintenance(p_parent_table := '
      || quote_literal(relation_info.parent_table)
      || ');'
    ELSE NULL
  END AS run_maintenance_sql
FROM relation_info
LEFT JOIN pg_class cls
  ON cls.oid = relation_info.parent_oid
LEFT JOIN pg_attribute ctrl
  ON ctrl.attrelid = relation_info.parent_oid
 AND ctrl.attname = relation_info.control_column
 AND NOT ctrl.attisdropped
LEFT JOIN primary_keys
  ON primary_keys.conrelid = relation_info.parent_oid
LEFT JOIN incoming_foreign_keys
  ON incoming_foreign_keys.confrelid = relation_info.parent_oid;
