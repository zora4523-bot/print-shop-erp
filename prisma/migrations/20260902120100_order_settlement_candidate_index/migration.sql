CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_settlement_candidate_idx"
  ON "Order"("settlementType", "settledAt", "submitterId")
  WHERE "settledFee" IS NOT NULL;
