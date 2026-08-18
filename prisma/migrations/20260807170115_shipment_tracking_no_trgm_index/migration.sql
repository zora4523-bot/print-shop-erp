CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderShipment_trackingNo_trgm_idx"
  ON "OrderShipment" USING gin ("trackingNo" gin_trgm_ops)
  WHERE "trackingNo" IS NOT NULL;
