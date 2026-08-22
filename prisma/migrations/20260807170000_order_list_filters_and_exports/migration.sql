BEGIN;

-- Indexes on existing, write-active tables are intentionally absent here.
-- Each one is built by its own following CREATE INDEX CONCURRENTLY migration,
-- because PostgreSQL forbids CONCURRENTLY inside this transactional ledger DDL.

-- Durable export ledger. filters + snapshotAt preserve the normalized query
-- contract and the newest eligible creation timestamp; the worker materializes
-- the matching order IDs once at job start so every workbook sheet uses the
-- same membership. schemaVersion preserves the workbook column contract.
CREATE TYPE "OrderExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "OrderExport" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "OrderExportStatus" NOT NULL DEFAULT 'PENDING',
  "backgroundJobId" TEXT,
  "matchedOrderCount" INTEGER NOT NULL DEFAULT 0,
  "rowCounts" JSONB,
  "artifactName" TEXT,
  "fileName" TEXT NOT NULL,
  "byteSize" BIGINT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderExport_backgroundJobId_key"
  ON "OrderExport"("backgroundJobId");
CREATE UNIQUE INDEX "OrderExport_requestKey_key"
  ON "OrderExport"("requestKey");
CREATE INDEX "OrderExport_createdById_createdAt_idx"
  ON "OrderExport"("createdById", "createdAt");
CREATE INDEX "OrderExport_status_createdAt_idx"
  ON "OrderExport"("status", "createdAt");
CREATE INDEX "OrderExport_expiresAt_idx"
  ON "OrderExport"("expiresAt");

ALTER TABLE "OrderExport"
  ADD CONSTRAINT "OrderExport_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shipment addresses and supplier contacts were introduced after the original
-- masking registry. Register them so masked exports and pgaudit readiness do
-- not silently omit the newer PII columns.
INSERT INTO app_ops.sensitive_column_policy (
  table_name,
  column_name,
  data_class,
  masking_strategy,
  anon_mask_expression,
  audit_scope,
  priority,
  rationale
)
VALUES
  (
    'OrderShipment',
    'receiverName',
    'pii',
    'anon_security_label',
    'anon.partial("receiverName", 1, $$**$$, 0)',
    'READ_WRITE',
    35,
    'shipment receiver name is personal information and must be masked outside production'
  ),
  (
    'OrderShipment',
    'receiverPhone',
    'pii',
    'anon_security_label',
    'anon.partial("receiverPhone", 3, $$****$$, 4)',
    'READ_WRITE',
    36,
    'shipment receiver phone is searchable but must be masked outside production'
  ),
  (
    'OrderShipment',
    'receiverAddress',
    'pii',
    'anon_security_label',
    'anon.partial("receiverAddress", 6, $$...$$, 0)',
    'READ_WRITE',
    37,
    'shipment delivery address must not appear in unmasked demo datasets'
  ),
  (
    'OutsourceOrder',
    'supplierContact',
    'pii',
    'anon_security_label',
    'anon.partial("supplierContact", 3, $$****$$, 4)',
    'READ_WRITE',
    38,
    'supplier contact details are personal information and must be masked outside production'
  ),
  (
    'OrderExport',
    'filters',
    'pii',
    'anon_security_label',
    'jsonb_build_object(''scope'', CASE WHEN "filters"->>''scope'' = ''all'' THEN ''all'' ELSE ''filtered'' END)',
    'READ_WRITE',
    39,
    'normalized export filters can contain customer, receiver, shipment and supplier search terms; masked datasets retain only normalized scope because deterministic hashes of enumerable filters are searchable'
  )
ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
SET
  data_class = EXCLUDED.data_class,
  masking_strategy = EXCLUDED.masking_strategy,
  anon_mask_expression = EXCLUDED.anon_mask_expression,
  audit_scope = EXCLUDED.audit_scope,
  priority = EXCLUDED.priority,
  rationale = EXCLUDED.rationale,
  updated_at = now();

-- Keep Pigsty scheduler readiness in sync with all eight authenticated cron
-- endpoints. Do not overwrite is_enabled on conflict: an operator may have
-- deliberately paused a candidate while investigating an incident.
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
    'erp-order-export-cleanup',
    '/api/cron/order-export-cleanup',
    '15 2 * * *',
    '每日 02:15 Asia/Shanghai，清理过期工单导出产物并移除筛选隐私明文',
    '{}'::jsonb,
    60000,
    25,
    'export retention is a bounded daily maintenance job; the durable worker result exposes counts only and never filter values or artifact names'
  ),
  (
    'erp-order-overdue',
    '/api/cron/order-overdue',
    '20 8 * * *',
    '每日 08:20 Asia/Shanghai，扫描已超承诺交期且尚未完成的工单',
    '{}'::jsonb,
    30000,
    55,
    'overdue order alerting runs after the outsource scan and returns counts only'
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

-- Keep the operational readiness contract aligned with buildOrderWhere. The
-- probe deliberately combines independent filters with AND. Each shipment,
-- item and task group is kept in one correlated EXISTS so separate child rows
-- cannot satisfy different fields of the same filter group.
UPDATE app_ops.search_surface_candidate
SET
  route_path = '/orders?q=...&status=...&receiverAddress=...&trackingNo=...&itemName=...&productName=...&craftId=...&foilColor=...&workerId=...&taskStatus=...&machineType=...&outsourceStatus=...&supplierName=...',
  business_area = '工单搜索与逐项筛选',
  sample_query = '苹果福 + 状态/同一地址/同一款式与任务/外协供应商',
  required_indexes = ARRAY[
    'public."Order_orderNo_trgm_idx"',
    'public."Order_customName_trgm_idx"',
    'public."Order_customerRef_trgm_idx"',
    'public."Order_receiverName_trgm_idx"',
    'public."Order_receiverPhone_trgm_idx"',
    'public."Order_receiverAddress_trgm_idx"',
    'public."Order_trackingNo_trgm_idx"',
    'public."Order_expressCode_trgm_idx"',
    'public."Order_searchPinyin_trgm_idx"',
    'public."Order_searchPinyinInitials_trgm_idx"',
    'public."Order_status_createdAt_id_idx"',
    'public."OrderItem_orderId_idx"',
    'public."OrderItem_name_trgm_idx"',
    'public."OrderItem_specification_trgm_idx"',
    'public."OrderItem_paperType_trgm_idx"',
    'public."OrderItem_crafts_gin_idx"',
    'public."OrderItem_foilColors_gin_idx"',
    'public."ProductionTask_orderItemId_craftId_key"',
    'public."ProductionTask_workerId_status_orderItemId_idx"',
    'public."OrderShipment_orderId_status_idx"',
    'public."OrderShipment_receiverName_trgm_idx"',
    'public."OrderShipment_receiverPhone_trgm_idx"',
    'public."OrderShipment_receiverAddress_trgm_idx"',
    'public."OrderShipment_trackingNo_trgm_idx"',
    'public."OrderShipment_expressCode_trgm_idx"',
    'public."Product_name_trgm_idx"',
    'public."OutsourceOrder_orderId_idx"',
    'public."OutsourceOrder_supplierName_trgm_idx"',
    'public."User_displayName_trgm_idx"'
  ],
  optional_indexes = ARRAY[
    'public."Order_orderNo_bigm_idx"',
    'public."Order_customName_bigm_idx"',
    'public."Order_customerRef_bigm_idx"',
    'public."Order_receiverName_bigm_idx"',
    'public."Order_receiverPhone_bigm_idx"',
    'public."Order_trackingNo_bigm_idx"',
    'public."Order_expressCode_bigm_idx"'
  ],
  explain_sql = $$EXPLAIN (ANALYZE, BUFFERS)
SELECT
  o."id",
  o."orderNo",
  o."customName",
  o."customerRef",
  o."receiverName",
  o."status",
  o."createdAt"
FROM public."Order" AS o
WHERE
  o."status" = 'SUBMITTED'::"OrderStatus"
  AND (
    o."orderNo" ILIKE '%苹果福%' OR
    o."customName" ILIKE '%苹果福%' OR
    o."customerRef" ILIKE '%苹果福%' OR
    o."receiverName" ILIKE '%苹果福%' OR
    o."receiverPhone" ILIKE '%苹果福%' OR
    o."receiverAddress" ILIKE '%苹果福%' OR
    o."trackingNo" ILIKE '%苹果福%' OR
    o."expressCode" ILIKE '%苹果福%' OR
    EXISTS (
      SELECT 1
      FROM public."User" AS submitter
      WHERE
        submitter."id" = o."submitterId"
        AND submitter."displayName" ILIKE '%苹果福%'
    ) OR
    EXISTS (
      SELECT 1
      FROM public."OrderShipment" AS qs
      WHERE
        qs."orderId" = o."id"
        AND (
          qs."receiverName" ILIKE '%苹果福%' OR
          qs."receiverPhone" ILIKE '%苹果福%' OR
          qs."receiverAddress" ILIKE '%苹果福%' OR
          qs."trackingNo" ILIKE '%苹果福%' OR
          qs."expressCode" ILIKE '%苹果福%'
        )
    ) OR
    EXISTS (
      SELECT 1
      FROM public."OrderItem" AS qi
      WHERE
        qi."orderId" = o."id"
        AND (
          qi."name" ILIKE '%苹果福%' OR
          qi."specification" ILIKE '%苹果福%' OR
          qi."paperType" ILIKE '%苹果福%' OR
          qi."foilColors" @> ARRAY['苹果福']::text[] OR
          EXISTS (
            SELECT 1
            FROM public."Product" AS qp
            WHERE
              qp."id" = qi."productId"
              AND qp."name" ILIKE '%苹果福%'
          ) OR
          EXISTS (
            SELECT 1
            FROM public."ProductionTask" AS qt
            JOIN public."User" AS qw ON qw."id" = qt."workerId"
            WHERE
              qt."orderItemId" = qi."id"
              AND qt."status" <> 'CANCELLED'::"TaskStatus"
              AND qw."displayName" ILIKE '%苹果福%'
          )
        )
    ) OR
    o."searchPinyin" ILIKE '%苹果福%' OR
    o."searchPinyinInitials" ILIKE '%苹果福%'
  )
  AND EXISTS (
    SELECT 1
    FROM public."OrderShipment" AS fs
    WHERE
      fs."orderId" = o."id"
      AND fs."receiverAddress" ILIKE '%广东省佛山市%'
      AND fs."trackingNo" ILIKE '%SF%'
      AND fs."status" IN (
        'PLANNED'::"ShipmentStatus",
        'SHIPPED'::"ShipmentStatus"
      )
  )
  AND EXISTS (
    SELECT 1
    FROM public."OrderItem" AS fi
    WHERE
      fi."orderId" = o."id"
      AND fi."name" ILIKE '%红包%'
      AND EXISTS (
        SELECT 1
        FROM public."Product" AS fp
        WHERE
          fp."id" = fi."productId"
          AND fp."name" ILIKE '%珠光%'
      )
      AND fi."specification" ILIKE '%中号%'
      AND fi."paperType" ILIKE '%艳红%'
      AND fi."quantity" BETWEEN 500 AND 5000
      AND fi."crafts" && ARRAY['craft-id']::text[]
      AND fi."foilColors" && ARRAY['哑金']::text[]
      AND EXISTS (
        SELECT 1
        FROM public."ProductionTask" AS ft
        WHERE
          ft."orderItemId" = fi."id"
          AND ft."workerId" = 'worker-id'
          AND ft."status" IN (
            'PENDING'::"TaskStatus",
            'IN_PROGRESS'::"TaskStatus"
          )
          AND ft."machineType" IN (
            'HAND_PRESS'::"MachineType",
            'WINDMILL'::"MachineType"
          )
      )
  )
  AND EXISTS (
    SELECT 1
    FROM public."OutsourceOrder" AS fo
    WHERE
      fo."orderId" = o."id"
      AND fo."status" IN (
        'SENT'::"OutsourceStatus",
        'IN_PROGRESS'::"OutsourceStatus"
      )
      AND fo."supplierName" ILIKE '%印刷厂%'
  )
ORDER BY o."createdAt" DESC, o."id" DESC
LIMIT 50;$$,
  rationale = '探针忠实复制 buildOrderWhere：q 保留主表、提交人、物流、款式+产品+任务师傅的 OR；独立物流、款式/任务和外协筛选与 q 做顶层 AND，并分别限定在同一条子记录。默认顺序严格使用 createdAt DESC, id DESC。',
  updated_at = now()
WHERE surface_key = 'order-search-v1';

-- to_regclass alone reports a failed CREATE INDEX CONCURRENTLY artifact as
-- present. Require the catalog flags that make an index safe for planner use,
-- so an INVALID/unfinished index cannot turn the readiness screen green.
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
    SELECT 'required_index_missing_or_invalid:' || idx
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
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index AS pi
    WHERE
      pi.indexrelid = to_regclass(idx)
      AND pi.indisready
      AND pi.indisvalid
      AND pi.indislive
  )
) AS missing_required_indexes
CROSS JOIN LATERAL (
  SELECT COALESCE(array_agg(idx ORDER BY idx), ARRAY[]::text[]) AS items
  FROM unnest(c.optional_indexes) AS idx
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index AS pi
    WHERE
      pi.indexrelid = to_regclass(idx)
      AND pi.indisready
      AND pi.indisvalid
      AND pi.indislive
  )
) AS missing_optional_indexes;

COMMIT;
