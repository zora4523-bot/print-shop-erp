-- PR-7: inventory movement summaries backed by Pigsty pg_ivm when available.
--
-- pg_ivm must be preloaded to maintain IMMVs correctly. In a Pigsty cluster
-- configured with `shared_preload_libraries = 'pg_ivm'` (or session preload),
-- this migration creates incrementally maintained materialized views. In local
-- PostgreSQL without pg_ivm preload/packages, it creates ordinary views with
-- the same names so read paths keep working during development.

DO $$
DECLARE
  preload_libraries TEXT := COALESCE(current_setting('shared_preload_libraries', true), '')
    || ','
    || COALESCE(current_setting('session_preload_libraries', true), '');
  pg_ivm_ready BOOLEAN := EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_ivm'
  ) AND preload_libraries ~ '(^|,)\s*pg_ivm\s*(,|$)';
  movement_query TEXT := $query$
    SELECT
      "materialId" AS material_id,
      count(*) AS transaction_count,
      sum(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE 0 END) AS total_in,
      sum(CASE WHEN "direction" = 'OUT' THEN "quantity" ELSE 0 END) AS total_out,
      sum(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS net_quantity
    FROM "MaterialTransaction"
    GROUP BY "materialId"
  $query$;
  daily_query TEXT := $query$
    SELECT
      "materialId" AS material_id,
      ("occurredAt" + INTERVAL '8 hours')::date AS shanghai_date,
      count(*) AS transaction_count,
      sum(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE 0 END) AS total_in,
      sum(CASE WHEN "direction" = 'OUT' THEN "quantity" ELSE 0 END) AS total_out,
      sum(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS net_quantity
    FROM "MaterialTransaction"
    GROUP BY "materialId", ("occurredAt" + INTERVAL '8 hours')::date
  $query$;
BEGIN
  IF pg_ivm_ready THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_ivm';
    EXECUTE format(
      'SELECT pgivm.create_immv(%L, %L)',
      'material_inventory_movement_summary',
      movement_query
    );
    EXECUTE format(
      'SELECT pgivm.create_immv(%L, %L)',
      'material_inventory_daily_summary',
      daily_query
    );
    RAISE NOTICE 'created pg_ivm inventory IMMVs';
  ELSE
    EXECUTE 'CREATE VIEW material_inventory_movement_summary AS ' || movement_query;
    EXECUTE 'CREATE VIEW material_inventory_daily_summary AS ' || daily_query;
    RAISE NOTICE 'pg_ivm is not available or not preloaded; created ordinary inventory summary views';
  END IF;
END
$$;
