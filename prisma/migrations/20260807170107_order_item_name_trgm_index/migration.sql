CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_name_trgm_idx"
  ON "OrderItem" USING gin ("name" gin_trgm_ops);
