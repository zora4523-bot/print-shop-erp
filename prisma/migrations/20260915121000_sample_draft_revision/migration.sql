-- Samples, including administrator-created ones, acquire their first price
-- revision at submission, just like external-sales production drafts.
ALTER TABLE "Order" DROP CONSTRAINT "Order_priceRevision_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_priceRevision_check" CHECK (
  "priceRevision" >= 1 OR (
    "priceRevision" = 0 AND "status" = 'DRAFT' AND "quotedPricingRevisionId" IS NULL
    AND ("settlementType" = 'EXTERNAL_SALES' OR "purpose" IN ('SAMPLE_SHIPMENT', 'PROOF'))
  )
);
