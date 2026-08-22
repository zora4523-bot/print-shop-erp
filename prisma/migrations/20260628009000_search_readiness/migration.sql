-- PR-2/PR-6: search extension and index readiness.
--
-- The search migrations create pg_trgm/pg_bigm/pg_pinyin-backed indexes, but
-- production rollout still needs an auditable checklist: required extensions
-- installed, required indexes present, and the exact EXPLAIN statement to run
-- before accepting a search path. This app_ops view is read-only metadata; it
-- does not execute EXPLAIN or change planner settings.

CREATE SCHEMA IF NOT EXISTS app_ops;

CREATE TABLE IF NOT EXISTS app_ops.search_surface_candidate (
  surface_key text PRIMARY KEY,
  route_path text NOT NULL,
  business_area text NOT NULL,
  sample_query text NOT NULL,
  required_extensions text[] NOT NULL DEFAULT ARRAY[]::text[],
  optional_extensions text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_indexes text[] NOT NULL DEFAULT ARRAY[]::text[],
  optional_indexes text[] NOT NULL DEFAULT ARRAY[]::text[],
  explain_sql text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_ops.search_surface_candidate (
  surface_key,
  route_path,
  business_area,
  sample_query,
  required_extensions,
  optional_extensions,
  required_indexes,
  optional_indexes,
  explain_sql,
  priority,
  rationale
) VALUES
  (
    'order-search-v1',
    '/orders?q=...',
    '工单搜索',
    '苹果福',
    ARRAY['pg_trgm', 'pg_pinyin'],
    ARRAY['pg_bigm'],
    ARRAY[
      'public."Order_orderNo_trgm_idx"',
      'public."Order_customerRef_trgm_idx"',
      'public."Order_receiverName_trgm_idx"',
      'public."Order_receiverPhone_trgm_idx"',
      'public."Order_trackingNo_trgm_idx"',
      'public."Order_expressCode_trgm_idx"',
      'public."Order_searchPinyin_trgm_idx"',
      'public."Order_searchPinyinInitials_trgm_idx"'
    ],
    ARRAY[
      'public."Order_orderNo_bigm_idx"',
      'public."Order_customerRef_bigm_idx"',
      'public."Order_receiverName_bigm_idx"',
      'public."Order_receiverPhone_bigm_idx"',
      'public."Order_trackingNo_bigm_idx"',
      'public."Order_expressCode_bigm_idx"'
    ],
    $$EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "orderNo", "customerRef", "receiverName", "status", "isUrgent", "createdAt"
FROM public."Order"
WHERE
  "orderNo" ILIKE '%苹果福%' OR
  "customerRef" ILIKE '%苹果福%' OR
  "receiverName" ILIKE '%苹果福%' OR
  "receiverPhone" ILIKE '%苹果福%' OR
  "trackingNo" ILIKE '%苹果福%' OR
  "expressCode" ILIKE '%苹果福%' OR
  "searchPinyin" ILIKE '%苹果福%' OR
  "searchPinyinInitials" ILIKE '%苹果福%'
ORDER BY "isUrgent" DESC, "createdAt" DESC
LIMIT 50;$$,
    10,
    '客户代号、收货人、电话、快递单号、订单号是最高频工单检索字段；上线前必须确认 required GIN indexes 存在并用 EXPLAIN 检查是否 seq scan。'
  ),
  (
    'product-search-v1',
    '/owner/products?q=...',
    '商品搜索',
    '红包',
    ARRAY['pg_trgm', 'citext', 'pg_pinyin'],
    ARRAY['pg_bigm'],
    ARRAY[
      'public."Product_name_trgm_idx"',
      'public."Product_specification_trgm_idx"',
      'public."Product_paperType_trgm_idx"',
      'public."Product_code_trgm_idx"',
      'public."Product_searchPinyin_trgm_idx"',
      'public."Product_searchPinyinInitials_trgm_idx"'
    ],
    ARRAY[
      'public."Product_name_bigm_idx"',
      'public."Product_specification_bigm_idx"',
      'public."Product_paperType_bigm_idx"',
      'public."Product_code_bigm_idx"'
    ],
    $$EXPLAIN (ANALYZE, BUFFERS)
SELECT p."id", p."code", p."name", p."specification", p."paperType", p."isActive"
FROM public."Product" p
LEFT JOIN public."ProductCategoryNode" c ON c."id" = p."categoryNodeId"
WHERE
  p."name" ILIKE '%红包%' OR
  p."code"::text ILIKE '%红包%' OR
  c."name" ILIKE '%红包%' OR
  p."specification" ILIKE '%红包%' OR
  p."paperType" ILIKE '%红包%' OR
  p."searchPinyin" ILIKE '%红包%' OR
  p."searchPinyinInitials" ILIKE '%红包%'
ORDER BY p."isActive" DESC, p."category" ASC, p."name" ASC
LIMIT 50;$$,
    20,
    '商品搜索覆盖产品编码、品名、分类、规格、纸张和拼音列；Product.code 是 citext，搜索索引用 code::text 表达式。'
  ),
  (
    'material-search-v1',
    '/foreman/materials?q=...',
    '物料库存搜索',
    '铜版纸',
    ARRAY['pg_trgm', 'citext', 'pg_pinyin'],
    ARRAY['pg_bigm'],
    ARRAY[
      'public."Material_code_trgm_idx"',
      'public."Material_name_trgm_idx"',
      'public."Material_specification_trgm_idx"',
      'public."Material_unit_trgm_idx"',
      'public."Material_searchPinyin_trgm_idx"',
      'public."Material_searchPinyinInitials_trgm_idx"'
    ],
    ARRAY[
      'public."Material_code_bigm_idx"',
      'public."Material_name_bigm_idx"',
      'public."Material_specification_bigm_idx"',
      'public."Material_unit_bigm_idx"'
    ],
    $$EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "code", "name", "category", "specification", "unit", "currentStock", "isActive"
FROM public."Material"
WHERE
  "code"::text ILIKE '%铜版纸%' OR
  "name" ILIKE '%铜版纸%' OR
  "specification" ILIKE '%铜版纸%' OR
  "unit" ILIKE '%铜版纸%' OR
  "searchPinyin" ILIKE '%铜版纸%' OR
  "searchPinyinInitials" ILIKE '%铜版纸%'
ORDER BY "isActive" DESC, "category" ASC, "name" ASC
LIMIT 50;$$,
    30,
    '物料库存页按物料编码、名称、规格、单位和拼音搜索；Material.code 是 citext，搜索索引用 code::text 表达式。'
  )
ON CONFLICT (surface_key) DO UPDATE
SET
  route_path = EXCLUDED.route_path,
  business_area = EXCLUDED.business_area,
  sample_query = EXCLUDED.sample_query,
  required_extensions = EXCLUDED.required_extensions,
  optional_extensions = EXCLUDED.optional_extensions,
  required_indexes = EXCLUDED.required_indexes,
  optional_indexes = EXCLUDED.optional_indexes,
  explain_sql = EXCLUDED.explain_sql,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

CREATE OR REPLACE VIEW app_ops.search_index_readiness AS
SELECT
  c.surface_key,
  c.route_path,
  c.business_area,
  c.sample_query,
  c.required_extensions,
  c.optional_extensions,
  c.required_indexes,
  c.optional_indexes,
  missing_required_extensions.items AS missing_required_extensions,
  missing_optional_extensions.items AS missing_optional_extensions,
  missing_required_indexes.items AS missing_required_indexes,
  missing_optional_indexes.items AS missing_optional_indexes,
  (
    cardinality(missing_required_extensions.items) = 0
    AND cardinality(missing_required_indexes.items) = 0
  ) AS ready_for_search,
  ARRAY(
    SELECT 'required_extension_not_installed:' || ext
    FROM unnest(missing_required_extensions.items) AS ext
    UNION ALL
    SELECT 'required_index_missing:' || idx
    FROM unnest(missing_required_indexes.items) AS idx
  ) AS blockers,
  c.explain_sql,
  c.priority,
  c.rationale
FROM app_ops.search_surface_candidate c
CROSS JOIN LATERAL (
  SELECT COALESCE(array_agg(ext ORDER BY ext), ARRAY[]::text[]) AS items
  FROM unnest(c.required_extensions) AS ext
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = ext
  )
) AS missing_required_extensions
CROSS JOIN LATERAL (
  SELECT COALESCE(array_agg(ext ORDER BY ext), ARRAY[]::text[]) AS items
  FROM unnest(c.optional_extensions) AS ext
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = ext
  )
) AS missing_optional_extensions
CROSS JOIN LATERAL (
  SELECT COALESCE(array_agg(idx ORDER BY idx), ARRAY[]::text[]) AS items
  FROM unnest(c.required_indexes) AS idx
  WHERE to_regclass(idx) IS NULL
) AS missing_required_indexes
CROSS JOIN LATERAL (
  SELECT COALESCE(array_agg(idx ORDER BY idx), ARRAY[]::text[]) AS items
  FROM unnest(c.optional_indexes) AS idx
  WHERE to_regclass(idx) IS NULL
) AS missing_optional_indexes;
