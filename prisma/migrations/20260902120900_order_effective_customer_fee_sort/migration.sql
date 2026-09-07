-- Keep the user-visible customer amount order aligned with the same immutable
-- precedence used by list display and amount filters. A stored generated
-- column lets PostgreSQL apply the order before OFFSET/LIMIT pagination.
ALTER TABLE "Order"
  ADD COLUMN "effectiveCustomerFee" DECIMAL(12,2)
  GENERATED ALWAYS AS (
    COALESCE("settledFee", "confirmedFee", "quotedFee", "totalAmount")
  ) STORED;

CREATE INDEX "Order_effectiveCustomerFee_createdAt_id_idx"
  ON "Order"("effectiveCustomerFee", "createdAt" DESC, "id" DESC);
