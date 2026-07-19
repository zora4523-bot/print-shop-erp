-- Reconcile automatic master-data counters with existing codes and introduce
-- short-lived daily document counters. Number reservations may leave gaps when
-- a later business transaction rolls back; uniqueness and concurrency safety
-- take precedence over gapless human-readable identifiers.

WITH existing_codes("key", "value") AS (
  SELECT 'PRODUCT', COALESCE(MAX(substring(upper(code::text) from '^PRD-([0-9]{6})$')::INTEGER), 0)
    FROM "Product"
  UNION ALL
  SELECT 'CRAFT', COALESCE(MAX(substring(upper(code::text) from '^CRF_([0-9]{6})$')::INTEGER), 0)
    FROM "Craft"
  UNION ALL
  SELECT 'PARTY', COALESCE(MAX(substring(upper(code::text) from '^PTY-([0-9]{6})$')::INTEGER), 0)
    FROM "Party"
  UNION ALL
  SELECT 'MATERIAL', COALESCE(MAX(substring(upper(code::text) from '^MAT-([0-9]{6})$')::INTEGER), 0)
    FROM "Material"
  UNION ALL
  SELECT 'WAREHOUSE', COALESCE(MAX(substring(upper(code::text) from '^WH-([0-9]{6})$')::INTEGER), 0)
    FROM "Warehouse"
  UNION ALL
  SELECT 'LOCATION', COALESCE(MAX(substring(upper(code::text) from '^LOC-([0-9]{6})$')::INTEGER), 0)
    FROM "WarehouseLocation"
)
INSERT INTO "BusinessCodeSequence" ("key", "value", "updatedAt")
SELECT "key", "value", NOW()
  FROM existing_codes
ON CONFLICT ("key") DO UPDATE
   SET "value" = GREATEST("BusinessCodeSequence"."value", EXCLUDED."value"),
       "updatedAt" = NOW();

CREATE TABLE "DailyDocumentSequence" (
  "key" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyDocumentSequence_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "DailyDocumentSequence_value_check"
    CHECK ("value" >= 0 AND "value" <= 9999)
);

WITH existing_documents("key", "value") AS (
  SELECT 'PURCHASE_ORDER:' || substring("purchaseNo" from 3 for 8),
         LEAST(MAX(substring("purchaseNo" from 12)::INTEGER), 9999)
    FROM "PurchaseOrder"
   WHERE "purchaseNo" ~ '^PO[0-9]{8}-[0-9]+$'
   GROUP BY substring("purchaseNo" from 3 for 8)
  UNION ALL
  SELECT 'PURCHASE_RECEIPT:' || substring("receiptNo" from 3 for 8),
         LEAST(MAX(substring("receiptNo" from 12)::INTEGER), 9999)
    FROM "PurchaseReceipt"
   WHERE "receiptNo" ~ '^PR[0-9]{8}-[0-9]+$'
   GROUP BY substring("receiptNo" from 3 for 8)
  UNION ALL
  SELECT 'STOCK_TRANSFER:' || substring("transferNo" from 3 for 8),
         LEAST(MAX(substring("transferNo" from 12)::INTEGER), 9999)
    FROM "StockTransfer"
   WHERE "transferNo" ~ '^ST[0-9]{8}-[0-9]+$'
   GROUP BY substring("transferNo" from 3 for 8)
  UNION ALL
  SELECT 'INVENTORY_COUNT:' || substring("countNo" from 3 for 8),
         LEAST(MAX(substring("countNo" from 12)::INTEGER), 9999)
    FROM "InventoryCount"
   WHERE "countNo" ~ '^IC[0-9]{8}-[0-9]+$'
   GROUP BY substring("countNo" from 3 for 8)
)
INSERT INTO "DailyDocumentSequence" ("key", "value", "updatedAt")
SELECT "key", "value", NOW()
  FROM existing_documents;
