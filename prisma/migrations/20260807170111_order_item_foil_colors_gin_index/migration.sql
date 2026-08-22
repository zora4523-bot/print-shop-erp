CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_foilColors_gin_idx"
  ON "OrderItem" USING gin ("foilColors");
