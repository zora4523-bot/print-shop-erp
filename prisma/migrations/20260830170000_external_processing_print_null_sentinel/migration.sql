BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "Product"
IN SHARE ROW EXCLUSIVE MODE;

-- The production constraint originally coupled calculationType and amount,
-- which correctly rejected every non-reference null amount but also rejected
-- the explicit COLOR_BASE boundary below. Replace it with the same rule plus
-- one row-local, evidence-bearing sentinel shape. Cross-row terminality is
-- enforced by the publication validator and the post-insert assertion below.
ALTER TABLE "CustomerPriceRule"
  DROP CONSTRAINT "CustomerPriceRule_values_valid";

ALTER TABLE "CustomerPriceRule"
  ADD CONSTRAINT "CustomerPriceRule_values_valid" CHECK (
    btrim("code"::TEXT) <> '' AND
    btrim("name") <> '' AND
    "priority" >= 0 AND
    ("amount" IS NULL OR "amount" BETWEEN 0 AND 9999999999.9999) AND
    ("minQty" IS NULL OR "minQty" BETWEEN 1 AND 9999999) AND
    ("maxQty" IS NULL OR "maxQty" BETWEEN 1 AND 9999999) AND
    ("minQty" IS NULL OR "maxQty" IS NULL OR "minQty" <= "maxQty") AND
    ("triggerCondition" IS NULL OR jsonb_typeof("triggerCondition") = 'object') AND
    (
      (
        (("calculationType" IS NULL) = ("amount" IS NULL)) AND
        (
          "kind" = 'REFERENCE'::"CustomerPriceRuleKind" OR
          ("calculationType" IS NOT NULL AND "amount" IS NOT NULL)
        )
      ) OR COALESCE((
        "kind" = 'BASE'::"CustomerPriceRuleKind" AND
        "calculationType" =
          'FIXED_AMOUNT'::"CustomerPriceCalculationType" AND
        "amount" IS NULL AND
        "productId" IS NOT NULL AND
        "exclusiveGroup" = 'COLOR_BASE' AND
        NOT "blocksAutomaticQuote" AND
        "minQty" IS NOT NULL AND
        "minQty" = "maxQty" AND
        "minQty" = CASE
          WHEN "code"::TEXT ~ '_Q[1-9][0-9]{0,6}$'
          THEN substring("code"::TEXT FROM '_Q([1-9][0-9]{0,6})$')::INTEGER
          ELSE NULL
        END AND
        btrim(COALESCE("sourceSheet", '')) <> '' AND
        btrim(COALESCE("sourceRange", '')) <> '' AND
        "triggerCondition" ->> 'target' = 'ITEM' AND
        "triggerCondition" -> 'pricingRoutes' = '["COLOR_PRINT"]'::JSONB AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'productCodes') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'productCodes') = 1
            AND btrim("triggerCondition" -> 'productCodes' ->> 0) <> ''
          ELSE FALSE
        END AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'specifications') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'specifications') = 1
            AND btrim("triggerCondition" -> 'specifications' ->> 0) <> ''
          ELSE FALSE
        END AND
        CASE
          WHEN jsonb_typeof("triggerCondition" -> 'paperTypes') = 'array'
          THEN jsonb_array_length("triggerCondition" -> 'paperTypes') = 1
            AND btrim("triggerCondition" -> 'paperTypes' ->> 0) <> ''
          ELSE FALSE
        END
      ), FALSE)
    ) AND
    (
      "kind" <> 'BASE'::"CustomerPriceRuleKind" OR
      "productId" IS NOT NULL
    ) AND
    (
      NOT "blocksAutomaticQuote" OR
      "kind" = 'REFERENCE'::"CustomerPriceRuleKind"
    ) AND
    (
      "calculationType" IS DISTINCT FROM
        'PER_SHEET'::"CustomerPriceCalculationType" OR
      ("triggerCondition" IS NOT NULL AND "triggerCondition" ? 'unitsPerSheet')
    )
  );

CREATE TEMP TABLE "_ExternalPrintSentinelClock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

CREATE TEMP TABLE "_ExternalPrintSentinelCurrent" ON COMMIT DROP AS
SELECT book.*
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalPrintSentinelClock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt");

-- Only advance the exact system-owned truth-repair lineage. Its version is
-- intentionally dynamic: a fresh migration chain produces v5, while the
-- production lineage this repair was authored against is v7. Identity,
-- provenance, current ownership and the maximum-version guard remain exact.
-- If an administrator has already published another successor, this migration
-- deliberately does not replace it or rewrite any historical rules.
CREATE TEMP TABLE "_ExternalPrintSentinelSource" ON COMMIT DROP AS
SELECT source.*
FROM "_ExternalPrintSentinelCurrent" source
CROSS JOIN "_ExternalPrintSentinelClock" clock
WHERE source."id" = 'cpb_external_processing_truth_repair_v1'
  AND source."code" = 'EXTERNAL_SALES_PROCESSING_RULES'::CITEXT
  AND source."sourceName" = '加工费计费规则.md'
  AND source."sourceSha256" =
    '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
  AND source."notes" ->> 'ruleVersion' =
    '2026-08-30-price-truth-repair'
  AND source."effectiveTo" IS NULL
  AND (SELECT COUNT(*) FROM "_ExternalPrintSentinelCurrent") = 1
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
    FROM "CustomerPriceBook" successor
    WHERE successor."id" = 'cpb_external_processing_print_sentinel_v1'
  );

-- A migration no-op is safe only after another current/successor version has
-- taken ownership of this purpose. If the exact truth-repair identity is the sole
-- current version, a provenance mismatch must fail closed; otherwise Prisma
-- would record the migration as applied while leaving the pricing hole live.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_ExternalPrintSentinelCurrent" current_book
    WHERE current_book."id" = 'cpb_external_processing_truth_repair_v1'
  )
  AND NOT EXISTS (SELECT 1 FROM "_ExternalPrintSentinelSource") THEN
    RAISE EXCEPTION
      'Expected current processing truth-repair identity has invalid source provenance';
  END IF;
END
$$;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "_ExternalPrintSentinelSource") = 0 THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalPrintSentinelSource" source
      ON source."id" = rule."priceBookId"
  ) <> 144 THEN
    RAISE EXCEPTION 'Expected processing truth-repair source to contain 144 rules';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalPrintSentinelSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."isActive" = TRUE
  ) <> 144 THEN
    RAISE EXCEPTION 'Expected every processing truth-repair source rule to be active';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalPrintSentinelSource" source
      ON source."id" = rule."priceBookId"
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE product."code" = 'EXT-COLOR-ICE-WHITE-160-MID'::CITEXT
      AND rule."exclusiveGroup" = 'COLOR_BASE'
      AND rule."code"::TEXT = 'BASE_COLOR-ICE-WHITE-160-MID_Q1000'
      AND rule."amount" = 320.0000
      AND rule."minQty" = 1000
      AND rule."maxQty" = 1000
  ) <> 1 THEN
    RAISE EXCEPTION 'Expected the exact ice-white mid Q1000 source anchor';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalPrintSentinelSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."code"::TEXT = 'BASE_COLOR-ICE-WHITE-160-MID_Q2000'
  ) THEN
    RAISE EXCEPTION 'Processing truth-repair source unexpectedly already contains Q2000 sentinel';
  END IF;
END
$$;

-- Closing the half-open interval is the only write to the source. Its rules remain
-- immutable evidence and are copied into a new published version below.
UPDATE "CustomerPriceBook" current_book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalPrintSentinelClock" clock,
  "_ExternalPrintSentinelSource" source
WHERE current_book."id" = source."id";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_processing_print_sentinel_v1',
  source."code",
  '外部销售加工费 · 彩印空档截断',
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
    'ruleVersion', '2026-08-30-print-null-sentinel',
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
        '冰白纸160g中号彩印Q2000及以后源表为空，新增空金额截断档以防止回落到Q1000自动报价。',
      'publishNote',
        '由数据库迁移发布；仅新版本增加可审计空档，不篡改来源版本规则。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalPrintSentinelSource" source
CROSS JOIN "_ExternalPrintSentinelClock" clock;

INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_printsentinel_' || substr(md5(rule."id"), 1, 19),
  'cpb_external_processing_print_sentinel_v1',
  rule."categoryId",
  rule."productId",
  rule."code",
  rule."name",
  rule."kind",
  rule."calculationType",
  rule."amount",
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
  rule."sourceName",
  rule."sourceSha256",
  rule."note",
  rule."blocksAutomaticQuote",
  rule."isActive",
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
CROSS JOIN "_ExternalPrintSentinelSource" source
CROSS JOIN "_ExternalPrintSentinelClock" clock
WHERE rule."priceBookId" = source."id";

-- Clone the exact Q1000 matcher and change only its identity, source boundary
-- and amount. NULL means "source table blank -> manual", never zero yuan.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_printsentinel_ice_mid_q2000',
  'cpb_external_processing_print_sentinel_v1',
  rule."categoryId",
  rule."productId",
  'BASE_COLOR-ICE-WHITE-160-MID_Q2000',
  '冰白纸 160g 彩印 · 中号 · Q2000（源表空档）',
  rule."kind",
  rule."calculationType",
  NULL,
  rule."includedUnits",
  rule."incrementUnits",
  rule."incrementAmount",
  2000,
  2000,
  rule."triggerCondition",
  rule."exclusiveGroup",
  rule."priority",
  '加工费计费规则.md',
  '§3 冰白纸160g中号表 Q2000 空格',
  '加工费计费规则.md',
  '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
  '显式空金额截断档；实际数量从2000起不得回落到Q1000自动报价。',
  FALSE,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
CROSS JOIN "_ExternalPrintSentinelSource" source
CROSS JOIN "_ExternalPrintSentinelClock" clock
WHERE rule."priceBookId" = source."id"
  AND rule."code"::TEXT = 'BASE_COLOR-ICE-WHITE-160-MID_Q1000';

DO $$
DECLARE
  source_id TEXT;
  released_at TIMESTAMP(3);
BEGIN
  SELECT source."id", clock."releasedAt"
  INTO source_id, released_at
  FROM "_ExternalPrintSentinelSource" source
  CROSS JOIN "_ExternalPrintSentinelClock" clock;

  IF source_id IS NULL THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_print_sentinel_v1'
  ) <> 145 THEN
    RAISE EXCEPTION 'Print-sentinel successor rule count is not 145';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" =
        'cpb_external_processing_print_sentinel_v1'
      AND product."code" = 'EXT-COLOR-ICE-WHITE-160-MID'::CITEXT
      AND rule."exclusiveGroup" = 'COLOR_BASE'
      AND rule."code"::TEXT = 'BASE_COLOR-ICE-WHITE-160-MID_Q2000'
      AND rule."kind" = 'BASE'::"CustomerPriceRuleKind"
      AND rule."calculationType" =
        'FIXED_AMOUNT'::"CustomerPriceCalculationType"
      AND rule."amount" IS NULL
      AND rule."minQty" = 2000
      AND rule."maxQty" = 2000
      AND rule."blocksAutomaticQuote" = FALSE
      AND rule."isActive" = TRUE
      AND rule."sourceName" = '加工费计费规则.md'
      AND rule."sourceSha256" =
        '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
  ) <> 1 THEN
    RAISE EXCEPTION 'Ice-white mid Q2000 null sentinel is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" null_rule
    JOIN "CustomerPriceRule" later_rule
      ON later_rule."priceBookId" = null_rule."priceBookId"
      AND later_rule."productId" = null_rule."productId"
      AND later_rule."exclusiveGroup" = 'COLOR_BASE'
      AND later_rule."minQty" > null_rule."minQty"
      AND later_rule."isActive" = TRUE
    WHERE null_rule."priceBookId" =
        'cpb_external_processing_print_sentinel_v1'
      AND null_rule."exclusiveGroup" = 'COLOR_BASE'
      AND null_rule."amount" IS NULL
      AND null_rule."isActive" = TRUE
  ) THEN
    RAISE EXCEPTION 'A COLOR_BASE null sentinel is not terminal';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" source
    JOIN "CustomerPriceBook" successor
      ON successor."id" = 'cpb_external_processing_print_sentinel_v1'
    WHERE source."id" = source_id
      AND source."effectiveTo" = successor."effectiveFrom"
      AND successor."effectiveFrom" = released_at
      AND successor."effectiveTo" IS NULL
      AND successor."isActive" = TRUE
      AND successor."version" = source."version" + 1
      AND successor."notes" ->> 'ruleVersion' =
        '2026-08-30-print-null-sentinel'
      AND successor."notes" #>> '{workflow,status}' = 'SYSTEM_RELEASE'
      AND successor."notes" #>> '{workflow,publishedBy}' =
        'SYSTEM_MIGRATION'
      AND NOT (successor."notes" ? 'ruleSetSha256')
  ) THEN
    RAISE EXCEPTION 'Print-sentinel publication provenance is invalid';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceBook" book
    CROSS JOIN "_ExternalPrintSentinelClock" clock
    WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."isActive" = TRUE
      AND book."effectiveFrom" <= clock."releasedAt"
      AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
  ) <> 1 THEN
    RAISE EXCEPTION 'Processing current version is not unique after sentinel release';
  END IF;
END
$$;

COMMIT;
