BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "Product"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalProcessingFiveTierFreshClock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

CREATE TEMP TABLE "_ExternalProcessingFiveTierFreshCurrent" ON COMMIT DROP AS
SELECT book."id"
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt");

-- A clean database has no administrator-authored future price version for the
-- earlier domain-consolidation migration to clone. Publish the five-tier
-- successor only for that exact shape. Existing installations with a future
-- segment are deliberately left to the original audited handoff migration.
CREATE TEMP TABLE "_ExternalProcessingFiveTierFreshSource" ON COMMIT DROP AS
SELECT source.*
FROM "CustomerPriceBook" source
CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock
WHERE source."id" = 'cpb_external_processing_rule_v3'
  AND source."code" = 'EXTERNAL_SALES_PROCESSING_RULES'::CITEXT
  AND source."version" = 3
  AND source."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND source."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND source."isActive" = TRUE
  AND source."sourceName" = '加工费计费规则.md'
  AND source."sourceSha256" =
    '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817'
  AND source."notes" ->> 'ruleVersion' = '2026-08-27'
  AND source."notes" #>> '{workflow,status}' = 'SYSTEM_RELEASE'
  AND source."effectiveTo" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "_ExternalProcessingFiveTierFreshCurrent"
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM "_ExternalProcessingFiveTierFreshCurrent" current_book
    WHERE current_book."id" = source."id"
  )
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
    FROM "CustomerPriceBook"
    WHERE "id" = 'cpb_external_processing_rule_v4_five_tier'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook"
    WHERE "id" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
  );

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "_ExternalProcessingFiveTierFreshSource"
  ) = 0 THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingFiveTierFreshSource" source
      ON source."id" = rule."priceBookId"
  ) <> 140 THEN
    RAISE EXCEPTION 'Fresh-install processing v3 rule count changed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingFiveTierFreshSource" source
      ON source."id" = rule."priceBookId"
    WHERE rule."isActive" = TRUE
      AND rule."exclusiveGroup" = 'CUSTOM_BASE'
  ) <> 45 THEN
    RAISE EXCEPTION 'Fresh-install processing v3 custom tiers changed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingFiveTierFreshSource" source
      ON source."id" = rule."priceBookId"
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."isActive" = TRUE
      AND rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 9999999
      AND (
        (
          product."code"::TEXT IN (
            'EXT-CUSTOM-MID',
            'EXT-CUSTOM-SQUARE',
            'EXT-CUSTOM-WEST-MID'
          )
          AND rule."amount" = 0.1700
        )
        OR (
          product."code"::TEXT IN (
            'EXT-CUSTOM-LARGE',
            'EXT-CUSTOM-WEST-LARGE'
          )
          AND rule."amount" = 0.1900
        )
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Fresh-install processing v3 terminal custom tier changed';
  END IF;
END
$$;

UPDATE "CustomerPriceBook" current_book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingFiveTierFreshClock" clock,
  "_ExternalProcessingFiveTierFreshSource" source
WHERE current_book."id" = source."id";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_processing_rule_v4_five_tier',
  source."code",
  '外部销售加工费 · 专版5万档',
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
    'ruleVersion', '2026-08-29-five-tier',
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
        '全新库无历史计划版；按真值文档补齐专版5万档。',
      'publishNote',
        '由数据库迁移发布；未伪造计划版或ruleSetSha256。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingFiveTierFreshSource" source
CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock;

-- Clone v3 without rewriting it. The former open-ended rows become the 30k
-- tier and retain every other source field apart from row identity/timestamps.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_v4_' || substr(md5(rule."id"), 1, 24),
  'cpb_external_processing_rule_v4_five_tier',
  rule."categoryId",
  rule."productId",
  CASE
    WHEN rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 9999999
    THEN replace(rule."code"::TEXT, 'GTE_25001', '25001_40000')::CITEXT
    ELSE rule."code"
  END,
  CASE
    WHEN rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 9999999
    THEN replace(rule."name", 'GTE_25001', '25001_40000')
    ELSE rule."name"
  END,
  rule."kind",
  rule."calculationType",
  rule."amount",
  rule."includedUnits",
  rule."incrementUnits",
  rule."incrementAmount",
  rule."minQty",
  CASE
    WHEN rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 9999999
    THEN 40000
    ELSE rule."maxQty"
  END,
  rule."triggerCondition",
  rule."exclusiveGroup",
  rule."priority",
  rule."sourceSheet",
  rule."sourceRange",
  rule."sourceName",
  CASE
    WHEN rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 9999999
    THEN '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852'
    ELSE rule."sourceSha256"
  END,
  rule."note",
  rule."blocksAutomaticQuote",
  rule."isActive",
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
CROSS JOIN "_ExternalProcessingFiveTierFreshSource" source
CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock
WHERE rule."priceBookId" = source."id";

INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_v4_five_tier_' || substr(md5(rule."id"), 1, 18),
  'cpb_external_processing_rule_v4_five_tier',
  rule."categoryId",
  rule."productId",
  replace(rule."code"::TEXT, 'GTE_25001', 'GTE_40001')::CITEXT,
  replace(rule."name", 'GTE_25001', 'GTE_40001'),
  rule."kind",
  rule."calculationType",
  CASE
    WHEN product."code"::TEXT IN (
      'EXT-CUSTOM-MID',
      'EXT-CUSTOM-SQUARE',
      'EXT-CUSTOM-WEST-MID'
    ) THEN 0.1600
    ELSE 0.1800
  END,
  rule."includedUnits",
  rule."incrementUnits",
  rule."incrementAmount",
  40001,
  9999999,
  rule."triggerCondition",
  rule."exclusiveGroup",
  rule."priority",
  '加工费计费规则.md',
  '§2.1',
  '加工费计费规则.md',
  '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
  NULL,
  FALSE,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" rule
JOIN "Product" product ON product."id" = rule."productId"
CROSS JOIN "_ExternalProcessingFiveTierFreshSource" source
CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock
WHERE rule."priceBookId" = source."id"
  AND rule."isActive" = TRUE
  AND rule."exclusiveGroup" = 'CUSTOM_BASE'
  AND rule."minQty" = 25001
  AND rule."maxQty" = 9999999;

DO $$
DECLARE
  discontinuity_count INTEGER;
  source_id TEXT;
BEGIN
  SELECT source."id"
  INTO source_id
  FROM "_ExternalProcessingFiveTierFreshSource" source;

  IF source_id IS NULL THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
  ) <> 145 THEN
    RAISE EXCEPTION 'Fresh-install five-tier successor rule count is not 145';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
      AND "isActive" = TRUE
      AND "exclusiveGroup" = 'CUSTOM_BASE'
  ) <> 50 THEN
    RAISE EXCEPTION 'Fresh-install five-tier custom tier count is not 50';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" successor
    WHERE successor."id" = 'cpb_external_processing_rule_v4_five_tier'
      AND successor."notes" ? 'supersedesScheduledPriceBookId'
  ) THEN
    RAISE EXCEPTION 'Fresh-install release invented scheduled-version evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" source
    JOIN "CustomerPriceBook" successor
      ON successor."id" = 'cpb_external_processing_rule_v4_five_tier'
    WHERE source."id" = source_id
      AND source."effectiveTo" = successor."effectiveFrom"
      AND successor."version" = source."version" + 1
      AND successor."effectiveTo" IS NULL
      AND successor."isActive" = TRUE
      AND successor."notes" ->> 'ruleVersion' = '2026-08-29-five-tier'
      AND successor."notes" #>> '{workflow,status}' = 'SYSTEM_RELEASE'
      AND NOT (successor."notes" ? 'ruleSetSha256')
      AND successor."notes" #>> '{workflow,ruleSetSha256}' IS NULL
  ) THEN
    RAISE EXCEPTION 'Fresh-install five-tier publication provenance is invalid';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
      AND rule."isActive" = TRUE
      AND rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 40001
      AND rule."maxQty" = 9999999
      AND (
        (
          product."code"::TEXT IN (
            'EXT-CUSTOM-MID',
            'EXT-CUSTOM-SQUARE',
            'EXT-CUSTOM-WEST-MID'
          )
          AND rule."amount" = 0.1600
        )
        OR (
          product."code"::TEXT IN (
            'EXT-CUSTOM-LARGE',
            'EXT-CUSTOM-WEST-LARGE'
          )
          AND rule."amount" = 0.1800
        )
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Fresh-install 50k tier was not published for all products';
  END IF;

  SELECT COUNT(*)
  INTO discontinuity_count
  FROM (
    SELECT
      rule."productId",
      rule."minQty",
      rule."maxQty",
      lag(rule."maxQty") OVER (
        PARTITION BY rule."productId"
        ORDER BY rule."minQty"
      ) AS previous_max,
      row_number() OVER (
        PARTITION BY rule."productId"
        ORDER BY rule."minQty"
      ) AS row_number,
      count(*) OVER (PARTITION BY rule."productId") AS tier_count
    FROM "CustomerPriceRule" rule
    WHERE rule."priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
      AND rule."isActive" = TRUE
      AND rule."exclusiveGroup" = 'CUSTOM_BASE'
  ) tier
  WHERE tier."tier_count" <> 10
    OR (tier."row_number" = 1 AND tier."minQty" <> 1)
    OR (tier."row_number" > 1 AND tier."minQty" <> tier."previous_max" + 1)
    OR (tier."row_number" = 10 AND tier."maxQty" <> 9999999);

  IF discontinuity_count <> 0 THEN
    RAISE EXCEPTION 'Fresh-install custom tiers contain a discontinuity';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceBook" book
    CROSS JOIN "_ExternalProcessingFiveTierFreshClock" clock
    WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."isActive" = TRUE
      AND book."effectiveFrom" <= clock."releasedAt"
      AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
  ) <> 1 THEN
    RAISE EXCEPTION 'Fresh-install processing current version is not unique';
  END IF;
END
$$;

COMMIT;
