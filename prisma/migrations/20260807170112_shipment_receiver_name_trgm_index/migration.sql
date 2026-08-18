CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderShipment_receiverName_trgm_idx"
  ON "OrderShipment" USING gin ("receiverName" gin_trgm_ops)
  WHERE "receiverName" IS NOT NULL;
