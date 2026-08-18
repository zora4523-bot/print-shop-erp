CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_crafts_gin_idx"
  ON "OrderItem" USING gin ("crafts");
