BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "Product"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalProcessingTruthRepairClock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

CREATE TEMP TABLE "_ExternalProcessingTruthRepairCurrent" ON COMMIT DROP AS
SELECT book.*
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalProcessingTruthRepairClock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt");

-- Repair only the current five-tier rules lineage. A different current book,
-- a newer draft/schedule, or a prior successful run makes this a no-op rather
-- than allowing a migration to overwrite an administrator's work.
CREATE TEMP TABLE "_ExternalProcessingTruthRepairSource" ON COMMIT DROP AS
SELECT source.*
FROM "_ExternalProcessingTruthRepairCurrent" source
CROSS JOIN "_ExternalProcessingTruthRepairClock" clock
WHERE source."code" = 'EXTERNAL_SALES_PROCESSING_RULES'::CITEXT
  AND source."version" >= 4
  AND source."sourceName" = '加工费计费规则.md'
  AND source."sourceSha256" =
    '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
  AND source."notes" ->> 'ruleVersion' = '2026-08-29-five-tier'
  AND source."effectiveTo" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "_ExternalProcessingTruthRepairCurrent"
  ) = 1
  AND source."version" = (
    SELECT MAX(candidate."version")
    FROM "CustomerPriceBook" candidate
    WHERE candidate."code" = source."code"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" future_book
    WHERE future_book."settlementType" = source."settlementType"
      AND future_book."purpose" = source."purpose"
      AND future_book."isActive" = TRUE
      AND future_book."effectiveFrom" > clock."releasedAt"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" repaired
    WHERE repaired."id" = 'cpb_external_processing_truth_repair_v1'
  );

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "_ExternalProcessingTruthRepairSource"
  ) = 0 THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingTruthRepairSource" source
      ON source."id" = rule."priceBookId"
  ) <> 145 THEN
    RAISE EXCEPTION 'Expected five-tier processing source to contain 145 rules';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingTruthRepairSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."isActive" = TRUE
  ) <> 145 THEN
    RAISE EXCEPTION 'Expected every five-tier processing source rule to be active';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingTruthRepairSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."isActive" = TRUE
  ) <> 50 THEN
    RAISE EXCEPTION 'Expected five-tier processing source to contain 50 custom tiers';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingTruthRepairSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."code"::TEXT IN (
      'BASE_STOCK-PEARL-RED-160-LARGE',
      'BASE_STOCK-SOFT-TOUCH-200-LARGE',
      'BASE_STOCK-SOFT-TOUCH-200-SQUARE'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three price-truth repair source rules';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "Product" product
    WHERE product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT
  ) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one unsupported soft-touch square product';
  END IF;
END
$$;

-- Closing the one current interval is the only permitted write to an already
-- published book. Historical books and every published rule remain untouched.
UPDATE "CustomerPriceBook" current_book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingTruthRepairClock" clock,
  "_ExternalProcessingTruthRepairSource" source
WHERE current_book."id" = source."id";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_processing_truth_repair_v1',
  source."code",
  '外部销售加工费 · 真值修复',
  source."settlementType",
  source."purpose",
  source."version" + 1,
  source."currency",
  '加工费计费规则.md',
  '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
  clock."releasedAt",
  NULL,
  TRUE,
  (
    COALESCE(source."notes", '{}'::JSONB)
      - 'ruleSetSha256'
      - 'workflow'
  ) || jsonb_build_object(
    'ruleVersion', '2026-08-30-price-truth-repair',
    'supersedesPriceBookId', source."id",
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'basedOn', jsonb_build_object(
        'id', source."id",
        'code', source."code"::TEXT,
        'version', source."version"
      ),
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt',
        to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt',
        to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'changeReason',
        '恢复珠光闪红160g大号封与触感纸200g大号封真值；移除未定义的触感纸方形自动报价。',
      'publishNote',
        '由数据库迁移发布；复制当前快照、保留历史版本，不伪造ruleSetSha256。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingTruthRepairSource" source
CROSS JOIN "_ExternalProcessingTruthRepairClock" clock;

-- Copy the current snapshot into the successor. The two documented amounts
-- are corrected in the new rows only, and the unsupported square rule is not
-- carried forward. No historical CustomerPriceRule row is updated or deleted.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_truthfix_' || substr(md5(source."id" || ':' || rule."id"), 1, 22),
  'cpb_external_processing_truth_repair_v1',
  rule."categoryId",
  rule."productId",
  rule."code",
  rule."name",
  rule."kind",
  rule."calculationType",
  CASE rule."code"::TEXT
    WHEN 'BASE_STOCK-PEARL-RED-160-LARGE' THEN 0.1300
    WHEN 'BASE_STOCK-SOFT-TOUCH-200-LARGE' THEN 0.2500
    ELSE rule."amount"
  END,
  rule."includedUnits",
  rule."incrementUnits",
  rule."incrementAmount",
  rule."minQty",
  rule."maxQty",
  rule."triggerCondition",
  rule."exclusiveGroup",
  rule."priority",
  rule."sourceSheet",
  rule."sourceRange",
  CASE
    WHEN rule."code"::TEXT IN (
      'BASE_STOCK-PEARL-RED-160-LARGE',
      'BASE_STOCK-SOFT-TOUCH-200-LARGE'
    ) THEN '加工费计费规则.md'
    ELSE rule."sourceName"
  END,
  CASE
    WHEN rule."code"::TEXT IN (
      'BASE_STOCK-PEARL-RED-160-LARGE',
      'BASE_STOCK-SOFT-TOUCH-200-LARGE'
    ) THEN '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
    ELSE rule."sourceSha256"
  END,
  rule."note",
  rule."blocksAutomaticQuote",
  rule."isActive",
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
CROSS JOIN "_ExternalProcessingTruthRepairSource" source
CROSS JOIN "_ExternalProcessingTruthRepairClock" clock
WHERE rule."priceBookId" = source."id"
  AND rule."code"::TEXT <> 'BASE_STOCK-SOFT-TOUCH-200-SQUARE';

-- Soft-delete the unsupported build-time catalog fact. Existing order items
-- and historical price rules keep their foreign-key target and remain readable.
UPDATE "Product" product
SET
  "isActive" = FALSE,
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingTruthRepairClock" clock,
  "_ExternalProcessingTruthRepairSource" source
WHERE product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT;

DO $$
DECLARE
  source_id TEXT;
  released_at TIMESTAMP(3);
BEGIN
  SELECT source."id", clock."releasedAt"
  INTO source_id, released_at
  FROM "_ExternalProcessingTruthRepairSource" source
  CROSS JOIN "_ExternalProcessingTruthRepairClock" clock;

  IF source_id IS NULL THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_truth_repair_v1'
  ) <> 144 THEN
    RAISE EXCEPTION 'Processing truth-repair successor rule count is not 144';
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
    RAISE EXCEPTION 'Processing price-truth amounts were not repaired';
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
    RAISE EXCEPTION 'Unsupported soft-touch square remains in repaired rules';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Product" product
    WHERE product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT
      AND product."isActive" = TRUE
  ) THEN
    RAISE EXCEPTION 'Unsupported soft-touch square product remains active';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" source
    JOIN "CustomerPriceBook" repaired
      ON repaired."id" = 'cpb_external_processing_truth_repair_v1'
    WHERE source."id" = source_id
      AND source."effectiveTo" = repaired."effectiveFrom"
      AND repaired."effectiveFrom" = released_at
      AND repaired."effectiveTo" IS NULL
      AND repaired."isActive" = TRUE
      AND repaired."version" = source."version" + 1
      AND NOT (repaired."notes" ? 'ruleSetSha256')
      AND repaired."notes" #>> '{workflow,status}' = 'SYSTEM_RELEASE'
      AND repaired."notes" #>> '{workflow,publishedBy}' = 'SYSTEM_MIGRATION'
      AND repaired."notes" #>> '{workflow,ruleSetSha256}' IS NULL
  ) THEN
    RAISE EXCEPTION 'Processing truth-repair publication provenance is invalid';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceBook" book
    CROSS JOIN "_ExternalProcessingTruthRepairClock" clock
    WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."isActive" = TRUE
      AND book."effectiveFrom" <= clock."releasedAt"
      AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
  ) <> 1 THEN
    RAISE EXCEPTION 'Processing current version is not unique after truth repair';
  END IF;
END
$$;

COMMIT;
