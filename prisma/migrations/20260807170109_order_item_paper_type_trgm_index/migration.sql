CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_paperType_trgm_idx"
  ON "OrderItem" USING gin ("paperType" gin_trgm_ops)
  WHERE "paperType" IS NOT NULL;
