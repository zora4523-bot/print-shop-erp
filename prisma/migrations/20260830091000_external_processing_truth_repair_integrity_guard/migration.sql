BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "Product"
IN SHARE MODE;

-- The repair migration intentionally uses a stable target id so retries are
-- idempotent. If that id was preoccupied by unrelated data, the repair itself
-- would have selected no source. Fail closed here instead of accepting an
-- ambiguous migration history. A legitimately absent target remains a no-op
-- because administrator-owned price-book lineages are outside this repair.
DO $$
DECLARE
  target_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO target_count
  FROM "CustomerPriceBook"
  WHERE "id" = 'cpb_external_processing_truth_repair_v1';

  IF target_count = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" book
    WHERE book."id" = 'cpb_external_processing_truth_repair_v1'
      AND book."code" = 'EXTERNAL_SALES_PROCESSING_RULES'::CITEXT
      AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."sourceName" = '加工费计费规则.md'
      AND book."sourceSha256" =
        '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
      AND book."notes" ->> 'ruleVersion' =
        '2026-08-30-price-truth-repair'
      AND book."notes" #>> '{workflow,status}' = 'SYSTEM_RELEASE'
      AND book."notes" #>> '{workflow,publishedBy}' = 'SYSTEM_MIGRATION'
      AND NOT (book."notes" ? 'ruleSetSha256')
      AND book."notes" #>> '{workflow,ruleSetSha256}' IS NULL
  ) THEN
    RAISE EXCEPTION
      'Processing truth-repair target id is occupied by invalid provenance';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_truth_repair_v1'
  ) <> 144 OR (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_truth_repair_v1'
      AND "isActive" = TRUE
  ) <> 144 THEN
    RAISE EXCEPTION
      'Processing truth-repair target has an invalid rule count';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    WHERE rule."priceBookId" = 'cpb_external_processing_truth_repair_v1'
      AND (
        (rule."code"::TEXT = 'BASE_STOCK-PEARL-RED-160-LARGE'
          AND rule."amount" = 0.1300)
        OR
        (rule."code"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-LARGE'
          AND rule."amount" = 0.2500)
      )
  ) <> 2 THEN
    RAISE EXCEPTION
      'Processing truth-repair target has invalid corrected amounts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" rule
    LEFT JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" = 'cpb_external_processing_truth_repair_v1'
      AND (
        rule."code"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-SQUARE'
        OR product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT
      )
  ) THEN
    RAISE EXCEPTION
      'Processing truth-repair target retained the unsupported square rule';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "Product" product
    WHERE product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT
      AND product."isActive" = FALSE
  ) <> 1 THEN
    RAISE EXCEPTION
      'Processing truth-repair target has an invalid square product state';
  END IF;
END
$$;

COMMIT;
