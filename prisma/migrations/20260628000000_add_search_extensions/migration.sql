-- Pigsty-backed search indexes for PR-2 Search V1.
--
-- pg_trgm is PostgreSQL contrib and available in Pigsty; it accelerates
-- ILIKE/contains search for order/product fields. pg_bigm is Pigsty-packaged
-- and improves short CJK keyword search, but local non-Pigsty PostgreSQL
-- installs may not have it. Keep pg_bigm optional so local development does
-- not block on Pigsty packages.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm'
  ) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_bigm';
  ELSE
    RAISE NOTICE 'pg_bigm extension is not available; skipping pg_bigm indexes';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Order_orderNo_trgm_idx"
  ON "Order" USING gin ("orderNo" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_customerRef_trgm_idx"
  ON "Order" USING gin ("customerRef" gin_trgm_ops)
  WHERE "customerRef" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Order_receiverName_trgm_idx"
  ON "Order" USING gin ("receiverName" gin_trgm_ops)
  WHERE "receiverName" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Order_receiverPhone_trgm_idx"
  ON "Order" USING gin ("receiverPhone" gin_trgm_ops)
  WHERE "receiverPhone" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Order_trackingNo_trgm_idx"
  ON "Order" USING gin ("trackingNo" gin_trgm_ops)
  WHERE "trackingNo" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Order_expressCode_trgm_idx"
  ON "Order" USING gin ("expressCode" gin_trgm_ops)
  WHERE "expressCode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_specification_trgm_idx"
  ON "Product" USING gin ("specification" gin_trgm_ops)
  WHERE "specification" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Product_paperType_trgm_idx"
  ON "Product" USING gin ("paperType" gin_trgm_ops)
  WHERE "paperType" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_orderNo_bigm_idx" ON "Order" USING gin ("orderNo" gin_bigm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_customerRef_bigm_idx" ON "Order" USING gin ("customerRef" gin_bigm_ops) WHERE "customerRef" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_receiverName_bigm_idx" ON "Order" USING gin ("receiverName" gin_bigm_ops) WHERE "receiverName" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_receiverPhone_bigm_idx" ON "Order" USING gin ("receiverPhone" gin_bigm_ops) WHERE "receiverPhone" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_trackingNo_bigm_idx" ON "Order" USING gin ("trackingNo" gin_bigm_ops) WHERE "trackingNo" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Order_expressCode_bigm_idx" ON "Order" USING gin ("expressCode" gin_bigm_ops) WHERE "expressCode" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Product_name_bigm_idx" ON "Product" USING gin ("name" gin_bigm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Product_specification_bigm_idx" ON "Product" USING gin ("specification" gin_bigm_ops) WHERE "specification" IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Product_paperType_bigm_idx" ON "Product" USING gin ("paperType" gin_bigm_ops) WHERE "paperType" IS NOT NULL';
  END IF;
END
$$;
