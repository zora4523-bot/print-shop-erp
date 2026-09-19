CREATE TYPE "OrderPurpose" AS ENUM ('STANDARD', 'SAMPLE_SHIPMENT', 'PROOF');
CREATE TYPE "OrderPricingMode" AS ENUM ('ITEMIZED', 'MANUAL_TOTAL');
ALTER TABLE "Order"
  ADD COLUMN "samplePackagingRuleCode" TEXT,
  ADD COLUMN "purpose" "OrderPurpose" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "pricingMode" "OrderPricingMode" NOT NULL DEFAULT 'ITEMIZED',
  ADD CONSTRAINT "Order_purpose_pricing_mode_check" CHECK (
    ("purpose" = 'PROOF' AND "pricingMode" = 'MANUAL_TOTAL') OR
    ("purpose" <> 'PROOF' AND "pricingMode" = 'ITEMIZED')
  );
CREATE INDEX "Order_purpose_createdAt_idx" ON "Order" ("purpose", "createdAt");
