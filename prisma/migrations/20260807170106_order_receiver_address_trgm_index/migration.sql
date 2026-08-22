CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_receiverAddress_trgm_idx"
  ON "Order" USING gin ("receiverAddress" gin_trgm_ops)
  WHERE "receiverAddress" IS NOT NULL;
