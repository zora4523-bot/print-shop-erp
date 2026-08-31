BEGIN;

ALTER TABLE "Order"
  ADD COLUMN "packagingAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "OrderPackagingGroup"
  ADD COLUMN "unitPrice" DECIMAL(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "subtotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "suggestedSubtotal" DECIMAL(12, 2),
  ADD COLUMN "pricingSnapshot" JSONB,
  ADD COLUMN "priceOverrideReason" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_packaging_amount_nonnegative_check"
    CHECK ("packagingAmount" >= 0);

ALTER TABLE "OrderPackagingGroup"
  ADD CONSTRAINT "OrderPackagingGroup_unit_price_nonnegative_check"
    CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "OrderPackagingGroup_subtotal_nonnegative_check"
    CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "OrderPackagingGroup_suggested_subtotal_nonnegative_check"
    CHECK ("suggestedSubtotal" IS NULL OR "suggestedSubtotal" >= 0),
  ADD CONSTRAINT "OrderPackagingGroup_pricing_snapshot_object_check"
    CHECK (
      "pricingSnapshot" IS NULL OR
      jsonb_typeof("pricingSnapshot") = 'object'
    );

-- Do not rewrite published price-book rules while introducing the order-side
-- packaging schema.  `20260826170000_rule_center_domain_consolidation` clones
-- the source book first and upgrades only the new `next_book_id` rules to the
-- explicit ITEM / PACKAGING_GROUP contract.  A later scoped restore migration
-- repairs installations that ran the earlier mutating form of this migration.

COMMIT;
