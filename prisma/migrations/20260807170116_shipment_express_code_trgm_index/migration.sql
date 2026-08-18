CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderShipment_expressCode_trgm_idx"
  ON "OrderShipment" USING gin ("expressCode" gin_trgm_ops)
  WHERE "expressCode" IS NOT NULL;
