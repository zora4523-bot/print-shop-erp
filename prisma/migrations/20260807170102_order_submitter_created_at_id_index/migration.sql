CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_submitterId_createdAt_id_idx"
  ON "Order"("submitterId", "createdAt" DESC, "id" DESC);
