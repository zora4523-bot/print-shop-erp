CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_specification_trgm_idx"
  ON "OrderItem" USING gin ("specification" gin_trgm_ops)
  WHERE "specification" IS NOT NULL;
