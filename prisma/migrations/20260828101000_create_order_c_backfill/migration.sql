BEGIN;

-- Prevent create/update races from allocating a fig while legacy rows are
-- being deterministically projected into the canonical columns.
LOCK TABLE "Order", "OrderItem", "OrderPackagingGroupLine"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OrderItem"
    WHERE "sequence" <= 0
  ) THEN
    RAISE EXCEPTION
      'Create-order-C backfill requires every legacy OrderItem.sequence to be positive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OrderItem"
    GROUP BY "orderId"
    HAVING MAX("sequence") >= 2147483647
  ) THEN
    RAISE EXCEPTION
      'Create-order-C backfill cannot allocate nextItemFig above INTEGER range';
  END IF;
END;
$$;

-- sequence remains the compatibility display order. fig is the stable,
-- never-recycled business identifier introduced by create-order-C.
UPDATE "OrderItem"
SET "fig" = "sequence"
WHERE "fig" IS NULL;

-- Only the three routes with a one-to-one canonical meaning are mapped.
-- MANUAL_QUOTE deliberately remains NULL rather than inventing a craft.
UPDATE "OrderItem"
SET "craft" = CASE "pricingRoute"
  WHEN 'STOCK_BLANK'::"OrderItemPricingRoute"
    THEN 'PARTIAL'::"OrderCraft"
  WHEN 'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute"
    THEN 'FULL'::"OrderCraft"
  WHEN 'COLOR_PRINT'::"OrderItemPricingRoute"
    THEN 'PRINT'::"OrderCraft"
  ELSE "craft"
END
WHERE "craft" IS NULL
  AND "pricingRoute" IN (
    'STOCK_BLANK'::"OrderItemPricingRoute",
    'CUSTOM_SINGLE_FLAT_FOIL'::"OrderItemPricingRoute",
    'COLOR_PRINT'::"OrderItemPricingRoute"
  );

-- Item-level pack is only recoverable when exactly one positive packaging
-- line exists. Multiple groups remain NULL even when they happen to share a
-- value, because an item-level edit cannot faithfully represent that history.
WITH "uniquePackagingLine" AS (
  SELECT
    line."orderItemId",
    MIN(line."unitsPerBag") AS "pack"
  FROM "OrderPackagingGroupLine" line
  GROUP BY line."orderItemId"
  HAVING COUNT(*) = 1
    AND MIN(line."unitsPerBag") = MAX(line."unitsPerBag")
    AND MIN(line."unitsPerBag") > 0
)
UPDATE "OrderItem" item
SET "pack" = candidate."pack"
FROM "uniquePackagingLine" candidate
WHERE item."id" = candidate."orderItemId"
  AND item."pack" IS NULL;

UPDATE "Order" parent
SET "nextItemFig" = COALESCE(
  (
    SELECT MAX(item."fig") + 1
    FROM "OrderItem" item
    WHERE item."orderId" = parent."id"
  ),
  1
);

-- Existing charge rows all retain their amount. The new state is the only
-- legal representation of an unknown plate-making charge.
ALTER TABLE "OrderCustomerCharge"
  ADD CONSTRAINT "OrderCustomerCharge_status_amount_shape_check"
  CHECK (
    (
      "status" = 'PENDING_AMOUNT'::"OrderCustomerChargeStatus"
      AND "amount" IS NULL
    )
    OR (
      "status" <> 'PENDING_AMOUNT'::"OrderCustomerChargeStatus"
      AND "amount" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "Order"
  VALIDATE CONSTRAINT "Order_next_item_fig_positive_check",
  VALIDATE CONSTRAINT "Order_create_order_c_fees_nonnegative_check",
  VALIDATE CONSTRAINT "Order_quoted_fee_snapshot_shape_check";

ALTER TABLE "OrderItem"
  VALIDATE CONSTRAINT "OrderItem_fig_positive_check",
  VALIDATE CONSTRAINT "OrderItem_pack_positive_check",
  VALIDATE CONSTRAINT "OrderItem_quote_disposition_shape_check";

ALTER TABLE "Product"
  VALIDATE CONSTRAINT "Product_weight_positive_check";

ALTER TABLE "OrderCustomerCharge"
  VALIDATE CONSTRAINT "OrderCustomerCharge_status_amount_shape_check";

-- A lock must repeat the exact purpose/version/source evidence of the
-- referenced price book. This prevents a syntactically valid but false bundle.
CREATE OR REPLACE FUNCTION enforce_order_price_version_lock_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  "bookPurpose" "CustomerPriceBookPurpose";
  "bookVersion" INTEGER;
  "bookSourceSha256" TEXT;
BEGIN
  SELECT book."purpose", book."version", book."sourceSha256"
  INTO "bookPurpose", "bookVersion", "bookSourceSha256"
  FROM "CustomerPriceBook" book
  WHERE book."id" = NEW."priceBookId";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'OrderPriceVersionLock references missing CustomerPriceBook %',
      NEW."priceBookId";
  END IF;

  IF "bookPurpose" IS DISTINCT FROM NEW."purpose"
    OR "bookVersion" IS DISTINCT FROM NEW."priceBookVersion"
    OR "bookSourceSha256" IS DISTINCT FROM NEW."sourceSha256"
  THEN
    RAISE EXCEPTION
      'OrderPriceVersionLock must match referenced CustomerPriceBook evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrderPriceVersionLock_snapshot_match"
BEFORE INSERT ON "OrderPriceVersionLock"
FOR EACH ROW
EXECUTE FUNCTION enforce_order_price_version_lock_snapshot();

-- The submitted quote reference must point to a revision owned by this order,
-- not merely to any globally valid revision id.
CREATE OR REPLACE FUNCTION enforce_order_quoted_pricing_revision_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."quotedPricingRevisionId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "OrderPricingRevision" revision
  WHERE revision."id" = NEW."quotedPricingRevisionId"
    AND revision."orderId" = NEW."id";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Order.quotedPricingRevisionId must reference a revision of the same order';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Order_quotedPricingRevision_ownership"
BEFORE INSERT OR UPDATE OF "quotedPricingRevisionId" ON "Order"
FOR EACH ROW
EXECUTE FUNCTION enforce_order_quoted_pricing_revision_ownership();

COMMIT;
