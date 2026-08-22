BEGIN;

-- This forward migration reconciles databases that already applied the local
-- 18000/18200 drafts. Lock before reviewing data so the checks and installed
-- fences describe the same committed row set.
LOCK TABLE "Order", "OrderItem" IN SHARE ROW EXCLUSIVE MODE;

-- A settlement direction is required from every writer. A database default
-- would silently classify old SALES/CUSTOMER_SERVICE code as FACTORY_DIRECT.
ALTER TABLE "Order"
  ALTER COLUMN "settlementType" DROP DEFAULT;

DO $$
DECLARE
  violation RECORD;
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR violation IN
    SELECT
      source_order."id",
      source_order."billingMode",
      source_order."submitterRole",
      source_order."settlementType"
    FROM "Order" AS source_order
    WHERE source_order."settlementType" IS NULL
       OR NOT (
         (
           source_order."billingMode" = 'NO_CHARGE' AND
           source_order."settlementType" = 'NO_CHARGE'
         ) OR (
           source_order."billingMode" = 'CHARGE' AND (
             (
               source_order."submitterRole" = 'SALES' AND
               source_order."settlementType" = 'EXTERNAL_SALES'
             ) OR (
               source_order."submitterRole" = 'CUSTOMER_SERVICE' AND
               source_order."settlementType" = 'INTERNAL_SALES'
             ) OR (
               source_order."submitterRole" NOT IN ('SALES', 'CUSTOMER_SERVICE') AND
               source_order."settlementType" = 'FACTORY_DIRECT'
             )
           )
         )
       )
    ORDER BY source_order."id"
  LOOP
    invalid_count := invalid_count + 1;
    IF invalid_count <= 20 THEN
      invalid_details := invalid_details
        || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
        || format(
          '%s(billing=%s, role=%s, settlement=%s)',
          violation."id",
          violation."billingMode",
          violation."submitterRole",
          COALESCE(violation."settlementType"::TEXT, 'null')
        );
    END IF;
  END LOOP;

  IF invalid_count > 0 THEN
    IF invalid_count > 20 THEN
      invalid_details := invalid_details
        || format('; ... and %s more', invalid_count - 20);
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Pricing compatibility migration blocked: %s Order row(s) have a missing or role-inconsistent settlement direction. Reconcile the financial owner explicitly before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

ALTER TABLE "Order"
  ALTER COLUMN "settlementType" SET NOT NULL;

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "Order_settlement_role_consistent";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_settlement_role_consistent"
  CHECK (
    ("billingMode" = 'NO_CHARGE' AND "settlementType" = 'NO_CHARGE') OR
    (
      "billingMode" = 'CHARGE' AND (
        ("submitterRole" = 'SALES' AND "settlementType" = 'EXTERNAL_SALES') OR
        ("submitterRole" = 'CUSTOMER_SERVICE' AND "settlementType" = 'INTERNAL_SALES') OR
        (
          "submitterRole" NOT IN ('SALES', 'CUSTOMER_SERVICE') AND
          "settlementType" = 'FACTORY_DIRECT'
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_settlement_role_consistent";

-- Validate both legacy historical rows and every supported quote snapshot
-- before replacing the compatibility fence. Complete quotes must reconcile to
-- the explicit subtotal; incomplete manual quotes and FREE_REWORK remain valid.
DO $$
DECLARE
  violation RECORD;
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR violation IN
    SELECT
      item."id",
      CASE
        WHEN item."pricingSnapshot" IS NULL
          THEN 'historical suggestedPrice/suggestedSubtotal mismatch'
        WHEN item."pricingSnapshot" ->> 'source' = 'FREE_REWORK'
          THEN 'invalid FREE_REWORK suggestion snapshot'
        ELSE 'quote snapshot and suggestedSubtotal are inconsistent'
      END AS reason
    FROM "OrderItem" AS item
    WHERE NOT (
      CASE
        WHEN item."pricingSnapshot" IS NULL THEN
          (
            item."suggestedPrice" IS NULL AND
            item."suggestedSubtotal" IS NULL
          ) OR (
            item."suggestedPrice" IS NOT NULL AND
            item."suggestedSubtotal" IS NOT NULL AND
            item."suggestedSubtotal" = item."suggestedPrice" * item."quantity"
          )
        WHEN jsonb_typeof(item."pricingSnapshot") IS DISTINCT FROM 'object' THEN
          FALSE
        WHEN item."pricingSnapshot" ->> 'source' = 'FREE_REWORK' THEN
          jsonb_typeof(item."pricingSnapshot" -> 'version') IS NOT DISTINCT FROM 'number' AND
          item."pricingSnapshot" ->> 'version' = '1' AND
          jsonb_typeof(item."pricingSnapshot" -> 'sourceOrderId') IS NOT DISTINCT FROM 'string' AND
          btrim(COALESCE(item."pricingSnapshot" ->> 'sourceOrderId', '')) <> '' AND
          jsonb_typeof(item."pricingSnapshot" -> 'sourceOrderItemId') IS NOT DISTINCT FROM 'string' AND
          btrim(COALESCE(item."pricingSnapshot" ->> 'sourceOrderItemId', '')) <> '' AND
          item."suggestedSubtotal" IS NULL AND
          (
            NOT (item."pricingSnapshot" ? 'suggestedSubtotal') OR
            jsonb_typeof(item."pricingSnapshot" -> 'suggestedSubtotal') IS NOT DISTINCT FROM 'null'
          )
        WHEN jsonb_typeof(item."pricingSnapshot" -> 'version') IS DISTINCT FROM 'number' OR
             item."pricingSnapshot" ->> 'version' IS DISTINCT FROM '1' OR
             jsonb_typeof(item."pricingSnapshot" -> 'complete') IS DISTINCT FROM 'boolean' OR
             NOT (item."pricingSnapshot" ? 'suggestedSubtotal') THEN
          FALSE
        WHEN item."pricingSnapshot" ->> 'complete' = 'false' THEN
          jsonb_typeof(item."pricingSnapshot" -> 'suggestedSubtotal') IS NOT DISTINCT FROM 'null' AND
          item."suggestedSubtotal" IS NULL
        WHEN item."pricingSnapshot" ->> 'complete' = 'true' THEN
          CASE
            WHEN jsonb_typeof(item."pricingSnapshot" -> 'suggestedSubtotal') IS DISTINCT FROM 'string' THEN
              FALSE
            WHEN item."pricingSnapshot" ->> 'suggestedSubtotal' !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' THEN
              FALSE
            ELSE
              item."suggestedSubtotal" IS NOT NULL AND
              (item."pricingSnapshot" ->> 'suggestedSubtotal')::NUMERIC <= 9999999999.99 AND
              item."suggestedSubtotal" = (item."pricingSnapshot" ->> 'suggestedSubtotal')::NUMERIC
          END
        ELSE
          FALSE
      END
    )
    ORDER BY item."id"
  LOOP
    invalid_count := invalid_count + 1;
    IF invalid_count <= 20 THEN
      invalid_details := invalid_details
        || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
        || format('%s: %s', violation."id", violation.reason);
    END IF;
  END LOOP;

  IF invalid_count > 0 THEN
    IF invalid_count > 20 THEN
      invalid_details := invalid_details
        || format('; ... and %s more', invalid_count - 20);
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Pricing compatibility migration blocked: %s OrderItem row(s) violate the suggested-price compatibility contract. Reconcile them explicitly before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION "enforce_order_item_suggested_price_legacy"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."suggestedPrice" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'OrderItem.suggestedPrice is legacy read-only data; new rows must use suggestedSubtotal';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."suggestedPrice" IS DISTINCT FROM OLD."suggestedPrice" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'OrderItem.suggestedPrice is immutable historical unit-price evidence';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "OrderItem_suggestedPrice_insert_guard" ON "OrderItem";
DROP TRIGGER IF EXISTS "OrderItem_suggestedPrice_update_guard" ON "OrderItem";

CREATE TRIGGER "OrderItem_suggestedPrice_insert_guard"
BEFORE INSERT ON "OrderItem"
FOR EACH ROW
EXECUTE FUNCTION "enforce_order_item_suggested_price_legacy"();

CREATE TRIGGER "OrderItem_suggestedPrice_update_guard"
BEFORE UPDATE OF "suggestedPrice" ON "OrderItem"
FOR EACH ROW
EXECUTE FUNCTION "enforce_order_item_suggested_price_legacy"();

ALTER TABLE "OrderItem"
  DROP CONSTRAINT IF EXISTS "OrderItem_suggested_snapshot_consistent";

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_suggested_snapshot_consistent"
  CHECK (
    CASE
      WHEN "pricingSnapshot" IS NULL THEN
        (
          "suggestedPrice" IS NULL AND
          "suggestedSubtotal" IS NULL
        ) OR (
          "suggestedPrice" IS NOT NULL AND
          "suggestedSubtotal" IS NOT NULL AND
          "suggestedSubtotal" = "suggestedPrice" * "quantity"
        )
      WHEN jsonb_typeof("pricingSnapshot") IS DISTINCT FROM 'object' THEN
        FALSE
      WHEN "pricingSnapshot" ->> 'source' = 'FREE_REWORK' THEN
        jsonb_typeof("pricingSnapshot" -> 'version') IS NOT DISTINCT FROM 'number' AND
        "pricingSnapshot" ->> 'version' = '1' AND
        jsonb_typeof("pricingSnapshot" -> 'sourceOrderId') IS NOT DISTINCT FROM 'string' AND
        btrim(COALESCE("pricingSnapshot" ->> 'sourceOrderId', '')) <> '' AND
        jsonb_typeof("pricingSnapshot" -> 'sourceOrderItemId') IS NOT DISTINCT FROM 'string' AND
        btrim(COALESCE("pricingSnapshot" ->> 'sourceOrderItemId', '')) <> '' AND
        "suggestedSubtotal" IS NULL AND
        (
          NOT ("pricingSnapshot" ? 'suggestedSubtotal') OR
          jsonb_typeof("pricingSnapshot" -> 'suggestedSubtotal') IS NOT DISTINCT FROM 'null'
        )
      WHEN jsonb_typeof("pricingSnapshot" -> 'version') IS DISTINCT FROM 'number' OR
           "pricingSnapshot" ->> 'version' IS DISTINCT FROM '1' OR
           jsonb_typeof("pricingSnapshot" -> 'complete') IS DISTINCT FROM 'boolean' OR
           NOT ("pricingSnapshot" ? 'suggestedSubtotal') THEN
        FALSE
      WHEN "pricingSnapshot" ->> 'complete' = 'false' THEN
        jsonb_typeof("pricingSnapshot" -> 'suggestedSubtotal') IS NOT DISTINCT FROM 'null' AND
        "suggestedSubtotal" IS NULL
      WHEN "pricingSnapshot" ->> 'complete' = 'true' THEN
        CASE
          WHEN jsonb_typeof("pricingSnapshot" -> 'suggestedSubtotal') IS DISTINCT FROM 'string' THEN
            FALSE
          WHEN "pricingSnapshot" ->> 'suggestedSubtotal' !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' THEN
            FALSE
          ELSE
            "suggestedSubtotal" IS NOT NULL AND
            ("pricingSnapshot" ->> 'suggestedSubtotal')::NUMERIC <= 9999999999.99 AND
            "suggestedSubtotal" = ("pricingSnapshot" ->> 'suggestedSubtotal')::NUMERIC
        END
      ELSE
        FALSE
    END
  ) NOT VALID;

ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_suggested_snapshot_consistent";

COMMIT;
