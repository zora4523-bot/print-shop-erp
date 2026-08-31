BEGIN;

-- An external-sales DRAFT contains production facts only. Its first immutable
-- pricing revision is created atomically by submit finalization, so the parent
-- revision counter is 0 until that transaction succeeds. Every other order
-- shape keeps the historical >= 1 invariant.
ALTER TABLE "Order"
  DROP CONSTRAINT "Order_priceRevision_check";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_priceRevision_check"
  CHECK (
    "priceRevision" >= 1
    OR (
      "priceRevision" = 0
      AND "settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND "status" = 'DRAFT'::"OrderStatus"
      AND "quotedPricingRevisionId" IS NULL
    )
  );

COMMIT;
