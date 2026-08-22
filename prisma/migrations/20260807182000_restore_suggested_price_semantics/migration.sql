BEGIN;

-- The preflights and backfill must observe one stable order/item set. This
-- also prevents an older application process from inserting the transitional
-- suggestedPrice shape between validation and trigger installation.
LOCK TABLE "Order", "OrderItem" IN SHARE ROW EXCLUSIVE MODE;

-- suggestedPrice has always meant the historical suggested unit price. The
-- quote rollout briefly reused that column name for a subtotal in application
-- code after pricingSnapshot was introduced. Rows without a snapshot predate
-- that rollout; rows with a snapshot must prove their subtotal from the
-- immutable JSON and agree with the temporarily misused column.
DO $$
DECLARE
  violation RECORD;
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR violation IN
    SELECT
      item."id" AS item_id,
      item."quantity" AS quantity_value,
      item."suggestedPrice" AS suggested_price_value,
      concat_ws(', ',
        CASE
          WHEN item."quantity" < 1 OR item."quantity" > 9999999
          THEN 'quantity must be between 1 and 9999999'
        END,
        CASE
          WHEN item."pricingSnapshot" IS NULL
           AND item."suggestedPrice" IS NOT NULL
           AND item."suggestedPrice" < 0
          THEN 'historical suggestedPrice must be non-negative'
        END,
        CASE
          WHEN item."pricingSnapshot" IS NULL
           AND item."suggestedPrice" IS NOT NULL
           AND item."suggestedPrice" * item."quantity" > 9999999999.99
          THEN 'historical suggestedPrice * quantity exceeds DECIMAL(12,2)'
        END
      ) AS reason
    FROM "OrderItem" AS item
    WHERE item."quantity" < 1
       OR item."quantity" > 9999999
       OR (
         item."pricingSnapshot" IS NULL
         AND item."suggestedPrice" IS NOT NULL
         AND item."suggestedPrice" < 0
       )
       OR (
         item."pricingSnapshot" IS NULL
         AND item."suggestedPrice" IS NOT NULL
         AND item."suggestedPrice" * item."quantity" > 9999999999.99
       )
    ORDER BY item."id"
  LOOP
    invalid_count := invalid_count + 1;
    IF invalid_count <= 20 THEN
      invalid_details := invalid_details
        || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
        || format(
          '%s(quantity=%s, suggestedPrice=%s): %s',
          violation.item_id,
          violation.quantity_value,
          COALESCE(violation.suggested_price_value::TEXT, 'null'),
          violation.reason
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
        'Suggested-price migration blocked: %s OrderItem row(s) have an invalid quantity, negative historical suggested unit price, or historical subtotal overflow. Repair them before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

-- A non-null pricingSnapshot identifies the short-lived rollout rows. Never
-- multiply their temporarily repurposed suggestedPrice by quantity. For quote
-- snapshots, suggestedSubtotal must be a canonical two-decimal JSON string (or
-- JSON null for an incomplete quote) and must exactly equal the current
-- suggestedPrice value. The only non-quote snapshot emitted in that window is
-- FREE_REWORK; it is accepted only when both the snapshot and order/item money
-- fields prove that no suggestion existed. Anything else blocks the migration.
DO $$
DECLARE
  transition RECORD;
  validation_errors TEXT[];
  snapshot_value JSONB;
  snapshot_text TEXT;
  snapshot_subtotal NUMERIC;
  invalid_count INTEGER := 0;
  invalid_details TEXT := '';
BEGIN
  FOR transition IN
    SELECT
      item."id" AS item_id,
      item."pricingSnapshot" AS pricing_snapshot,
      item."suggestedPrice" AS current_suggested_price,
      item."unitPrice" AS unit_price,
      item."fixedFee" AS fixed_fee,
      item."subtotal" AS actual_subtotal,
      source_order."kind" AS order_kind,
      source_order."billingMode" AS billing_mode,
      source_order."settlementType" AS settlement_type
    FROM "OrderItem" AS item
    JOIN "Order" AS source_order ON source_order."id" = item."orderId"
    WHERE item."pricingSnapshot" IS NOT NULL
    ORDER BY item."id"
  LOOP
    validation_errors := ARRAY[]::TEXT[];

    IF jsonb_typeof(transition.pricing_snapshot) IS DISTINCT FROM 'object' THEN
      validation_errors := array_append(
        validation_errors,
        'pricingSnapshot must be a JSON object'
      );
    ELSIF transition.pricing_snapshot ->> 'source' = 'FREE_REWORK' THEN
      IF jsonb_typeof(transition.pricing_snapshot -> 'version')
           IS DISTINCT FROM 'number'
         OR transition.pricing_snapshot ->> 'version' IS DISTINCT FROM '1'
         OR jsonb_typeof(transition.pricing_snapshot -> 'sourceOrderId')
           IS DISTINCT FROM 'string'
         OR jsonb_typeof(transition.pricing_snapshot -> 'sourceOrderItemId')
           IS DISTINCT FROM 'string'
         OR COALESCE(transition.pricing_snapshot ->> 'sourceOrderId', '') = ''
         OR COALESCE(transition.pricing_snapshot ->> 'sourceOrderItemId', '') = ''
         OR transition.order_kind::TEXT <> 'REWORK'
         OR transition.billing_mode::TEXT <> 'NO_CHARGE'
         OR transition.settlement_type::TEXT <> 'NO_CHARGE'
         OR transition.unit_price <> 0
         OR transition.fixed_fee <> 0
         OR transition.actual_subtotal <> 0
         OR transition.current_suggested_price IS NOT NULL
         OR (
           transition.pricing_snapshot ? 'suggestedSubtotal'
           AND jsonb_typeof(
             transition.pricing_snapshot -> 'suggestedSubtotal'
           ) <> 'null'
         ) THEN
        validation_errors := array_append(
          validation_errors,
          'FREE_REWORK snapshot does not prove a zero-value no-suggestion item'
        );
      END IF;
    ELSIF jsonb_typeof(transition.pricing_snapshot -> 'version')
         IS DISTINCT FROM 'number'
       OR transition.pricing_snapshot ->> 'version' IS DISTINCT FROM '1'
       OR jsonb_typeof(transition.pricing_snapshot -> 'complete')
         IS DISTINCT FROM 'boolean' THEN
      validation_errors := array_append(
        validation_errors,
        'quote snapshot must have version 1 and a boolean complete flag'
      );
    ELSIF NOT (transition.pricing_snapshot ? 'suggestedSubtotal') THEN
      validation_errors := array_append(
        validation_errors,
        'quote snapshot is missing suggestedSubtotal'
      );
    ELSE
      snapshot_value := transition.pricing_snapshot -> 'suggestedSubtotal';
      IF jsonb_typeof(snapshot_value) = 'null' THEN
        IF transition.pricing_snapshot ->> 'complete' <> 'false' THEN
          validation_errors := array_append(
            validation_errors,
            'complete quote snapshot cannot have a null suggestedSubtotal'
          );
        ELSIF transition.current_suggested_price IS NOT NULL THEN
          validation_errors := array_append(
            validation_errors,
            'snapshot suggestedSubtotal is null but suggestedPrice is not null'
          );
        END IF;
      ELSIF jsonb_typeof(snapshot_value) <> 'string' THEN
        validation_errors := array_append(
          validation_errors,
          'snapshot suggestedSubtotal must be a two-decimal string or null'
        );
      ELSE
        snapshot_text := snapshot_value #>> '{}';
        IF transition.pricing_snapshot ->> 'complete' <> 'true' THEN
          validation_errors := array_append(
            validation_errors,
            'incomplete quote snapshot cannot have a suggestedSubtotal amount'
          );
        ELSIF snapshot_text !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' THEN
          validation_errors := array_append(
            validation_errors,
            'snapshot suggestedSubtotal is not a canonical two-decimal amount'
          );
        ELSE
          snapshot_subtotal := snapshot_text::NUMERIC;
          IF snapshot_subtotal > 9999999999.99 THEN
            validation_errors := array_append(
              validation_errors,
              'snapshot suggestedSubtotal exceeds DECIMAL(12,2)'
            );
          ELSIF transition.current_suggested_price IS NULL
             OR transition.current_suggested_price <> snapshot_subtotal THEN
            validation_errors := array_append(
              validation_errors,
              'snapshot suggestedSubtotal does not equal the current suggestedPrice'
            );
          END IF;
        END IF;
      END IF;
    END IF;

    IF cardinality(validation_errors) > 0 THEN
      invalid_count := invalid_count + 1;
      IF invalid_count <= 20 THEN
        invalid_details := invalid_details
          || CASE WHEN invalid_details = '' THEN '' ELSE '; ' END
          || format(
            '%s: %s',
            transition.item_id,
            array_to_string(validation_errors, ', ')
          );
      END IF;
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
        'Suggested-price migration blocked: %s transition OrderItem row(s) cannot prove the suggested subtotal from pricingSnapshot. Repair or explicitly reconcile them before retrying. %s',
        invalid_count,
        invalid_details
      );
  END IF;
END
$$;

ALTER TABLE "OrderItem"
  ADD COLUMN "suggestedSubtotal" DECIMAL(12,2);

-- Historical rows retain suggestedPrice as their unit-price evidence.
UPDATE "OrderItem"
SET "suggestedSubtotal" = "suggestedPrice" * "quantity"
WHERE "pricingSnapshot" IS NULL
  AND "suggestedPrice" IS NOT NULL;

-- Quote transition rows use the independently stored snapshot subtotal and
-- clear the repurposed legacy column after the equality preflight above.
UPDATE "OrderItem"
SET
  "suggestedSubtotal" = CASE
    WHEN jsonb_typeof("pricingSnapshot" -> 'suggestedSubtotal') = 'null'
      THEN NULL
    ELSE ("pricingSnapshot" ->> 'suggestedSubtotal')::NUMERIC
  END,
  "suggestedPrice" = NULL
WHERE "pricingSnapshot" IS NOT NULL
  AND "pricingSnapshot" ? 'suggestedSubtotal';

-- Proven FREE_REWORK rows carry no customer-price suggestion.
UPDATE "OrderItem"
SET
  "suggestedSubtotal" = NULL,
  "suggestedPrice" = NULL
WHERE "pricingSnapshot" IS NOT NULL
  AND "pricingSnapshot" ->> 'source' = 'FREE_REWORK';

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_valid"
    CHECK ("quantity" BETWEEN 1 AND 9999999) NOT VALID,
  ADD CONSTRAINT "OrderItem_suggested_prices_nonnegative"
    CHECK (
      ("suggestedPrice" IS NULL OR "suggestedPrice" >= 0) AND
      ("suggestedSubtotal" IS NULL OR "suggestedSubtotal" >= 0)
    ) NOT VALID,
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

ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_quantity_valid";
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_suggested_prices_nonnegative";
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_suggested_snapshot_consistent";

-- suggestedPrice remains readable as immutable historical unit-price evidence,
-- but no post-migration writer may insert or repurpose it. New quotes write the
-- explicit suggestedSubtotal and must satisfy the snapshot CHECK above.
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

CREATE TRIGGER "OrderItem_suggestedPrice_insert_guard"
BEFORE INSERT ON "OrderItem"
FOR EACH ROW
EXECUTE FUNCTION "enforce_order_item_suggested_price_legacy"();

CREATE TRIGGER "OrderItem_suggestedPrice_update_guard"
BEFORE UPDATE OF "suggestedPrice" ON "OrderItem"
FOR EACH ROW
EXECUTE FUNCTION "enforce_order_item_suggested_price_legacy"();

COMMIT;
