CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductionTask_workerId_status_orderItemId_idx"
  ON "ProductionTask"("workerId", "status", "orderItemId");
