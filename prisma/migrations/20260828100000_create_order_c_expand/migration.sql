BEGIN;

-- Canonical create-order-C states and facts are additive. Legacy enum values
-- and legacy amount/route columns remain available to rolling readers.
ALTER TYPE "OrderStatus"
  ADD VALUE IF NOT EXISTS 'PENDING_FACTORY' AFTER 'DRAFT';
ALTER TYPE "OrderCustomerChargeStatus"
  ADD VALUE IF NOT EXISTS 'PENDING_AMOUNT' AFTER 'ESTIMATED';

CREATE TYPE "OrderCraft" AS ENUM (
  'PARTIAL',
  'FULL',
  'PRINT'
);

CREATE TYPE "OrderQuotedFeeCompleteness" AS ENUM (
  'COMPLETE',
  'EXCLUDES_MANUAL_ITEMS'
);

CREATE TYPE "OrderItemQuoteDisposition" AS ENUM (
  'PRICED',
  'MANUAL_PRICING_REQUIRED'
);

ALTER TABLE "Order"
  ADD COLUMN "nextItemFig" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "clientSubmissionId" TEXT,
  ADD COLUMN "quotedFee" DECIMAL(12,2),
  ADD COLUMN "confirmedFee" DECIMAL(12,2),
  ADD COLUMN "settledFee" DECIMAL(12,2),
  ADD COLUMN "quotedFeeCompleteness" "OrderQuotedFeeCompleteness",
  ADD COLUMN "quotedPricingRevisionId" TEXT;

ALTER TABLE "OrderItem"
  ADD COLUMN "fig" INTEGER,
  ADD COLUMN "craft" "OrderCraft",
  ADD COLUMN "pack" INTEGER,
  ADD COLUMN "quoteDisposition" "OrderItemQuoteDisposition",
  ADD COLUMN "quotedAmount" DECIMAL(12,2);

ALTER TABLE "Product"
  ADD COLUMN "paperMaterialId" TEXT,
  ADD COLUMN "weight" INTEGER;

ALTER TABLE "Material"
  ADD COLUMN "outOfStock" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "displayColor" TEXT,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- A pending plate-making fee is unknown, not zero.
ALTER TABLE "OrderCustomerCharge"
  ALTER COLUMN "amount" DROP NOT NULL;

CREATE TABLE "OrderPriceVersionLock" (
  "id" TEXT NOT NULL,
  "pricingRevisionId" TEXT NOT NULL,
  "purpose" "CustomerPriceBookPurpose" NOT NULL,
  "priceBookId" TEXT NOT NULL,
  "priceBookVersion" INTEGER NOT NULL,
  "sourceSha256" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderPriceVersionLock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPriceVersionLock_price_book_version_check"
    CHECK ("priceBookVersion" >= 1),
  CONSTRAINT "OrderPriceVersionLock_source_sha256_check"
    CHECK (char_length("sourceSha256") = 64)
);

CREATE UNIQUE INDEX "Order_clientSubmissionId_key"
  ON "Order"("clientSubmissionId");
CREATE INDEX "Order_quotedPricingRevisionId_idx"
  ON "Order"("quotedPricingRevisionId");

CREATE UNIQUE INDEX "OrderItem_orderId_fig_key"
  ON "OrderItem"("orderId", "fig");
CREATE INDEX "OrderItem_craft_idx"
  ON "OrderItem"("craft");
CREATE INDEX "OrderItem_quoteDisposition_idx"
  ON "OrderItem"("quoteDisposition");

CREATE INDEX "Product_paperMaterialId_idx"
  ON "Product"("paperMaterialId");
CREATE INDEX "Material_category_isActive_sortOrder_idx"
  ON "Material"("category", "isActive", "sortOrder");

CREATE UNIQUE INDEX "OrderPriceVersionLock_pricingRevisionId_purpose_key"
  ON "OrderPriceVersionLock"("pricingRevisionId", "purpose");
CREATE INDEX "OrderPriceVersionLock_priceBookId_idx"
  ON "OrderPriceVersionLock"("priceBookId");
CREATE INDEX "OrderPriceVersionLock_purpose_createdAt_idx"
  ON "OrderPriceVersionLock"("purpose", "createdAt");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_quotedPricingRevisionId_fkey"
  FOREIGN KEY ("quotedPricingRevisionId")
  REFERENCES "OrderPricingRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_paperMaterialId_fkey"
  FOREIGN KEY ("paperMaterialId")
  REFERENCES "Material"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderPriceVersionLock"
  ADD CONSTRAINT "OrderPriceVersionLock_pricingRevisionId_fkey"
  FOREIGN KEY ("pricingRevisionId")
  REFERENCES "OrderPricingRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderPriceVersionLock_priceBookId_fkey"
  FOREIGN KEY ("priceBookId")
  REFERENCES "CustomerPriceBook"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The new checks guard future writes immediately; legacy rows are validated
-- after the deterministic backfill in the following migration.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_next_item_fig_positive_check"
    CHECK ("nextItemFig" > 0) NOT VALID,
  ADD CONSTRAINT "Order_create_order_c_fees_nonnegative_check"
    CHECK (
      ("quotedFee" IS NULL OR "quotedFee" >= 0)
      AND ("confirmedFee" IS NULL OR "confirmedFee" >= 0)
      AND ("settledFee" IS NULL OR "settledFee" >= 0)
    ) NOT VALID,
  ADD CONSTRAINT "Order_quoted_fee_snapshot_shape_check"
    CHECK (
      (
        "quotedFee" IS NULL
        AND "quotedFeeCompleteness" IS NULL
        AND "quotedPricingRevisionId" IS NULL
      )
      OR (
        "quotedFee" IS NOT NULL
        AND "quotedFeeCompleteness" IS NOT NULL
        AND "quotedPricingRevisionId" IS NOT NULL
      )
    ) NOT VALID;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_fig_positive_check"
    CHECK ("fig" IS NULL OR "fig" > 0) NOT VALID,
  ADD CONSTRAINT "OrderItem_pack_positive_check"
    CHECK ("pack" IS NULL OR "pack" > 0) NOT VALID,
  ADD CONSTRAINT "OrderItem_quote_disposition_shape_check"
    CHECK (
      ("quoteDisposition" IS NULL AND "quotedAmount" IS NULL)
      OR (
        "quoteDisposition" = 'PRICED'::"OrderItemQuoteDisposition"
        AND "quotedAmount" IS NOT NULL
        AND "quotedAmount" >= 0
      )
      OR (
        "quoteDisposition" = 'MANUAL_PRICING_REQUIRED'::"OrderItemQuoteDisposition"
        AND "quotedAmount" IS NULL
      )
    ) NOT VALID;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_weight_positive_check"
    CHECK ("weight" IS NULL OR "weight" > 0) NOT VALID;

CREATE OR REPLACE FUNCTION prevent_order_price_version_lock_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OrderPriceVersionLock rows are immutable';
END;
$$;

CREATE TRIGGER "OrderPriceVersionLock_immutable"
BEFORE UPDATE OR DELETE ON "OrderPriceVersionLock"
FOR EACH ROW
EXECUTE FUNCTION prevent_order_price_version_lock_mutation();

COMMIT;
