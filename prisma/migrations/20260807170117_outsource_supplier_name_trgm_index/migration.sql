CREATE INDEX CONCURRENTLY IF NOT EXISTS "OutsourceOrder_supplierName_trgm_idx"
  ON "OutsourceOrder" USING gin ("supplierName" gin_trgm_ops);
