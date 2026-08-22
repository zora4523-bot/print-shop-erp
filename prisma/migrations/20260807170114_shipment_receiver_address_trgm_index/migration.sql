CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderShipment_receiverAddress_trgm_idx"
  ON "OrderShipment" USING gin ("receiverAddress" gin_trgm_ops)
  WHERE "receiverAddress" IS NOT NULL;
