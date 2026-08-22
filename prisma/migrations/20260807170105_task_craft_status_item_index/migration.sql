CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductionTask_craftId_status_orderItemId_idx"
  ON "ProductionTask"("craftId", "status", "orderItemId");
