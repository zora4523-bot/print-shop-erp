CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderShipment_receiverPhone_trgm_idx"
  ON "OrderShipment" USING gin ("receiverPhone" gin_trgm_ops)
  WHERE "receiverPhone" IS NOT NULL;
