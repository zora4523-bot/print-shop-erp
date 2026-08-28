BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "Product",
  "OrderPriceVersionLock",
  "OrderCustomerCharge"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalProcessingFiveTierClock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

-- Only the exact system lineage may be repaired automatically. If an
-- administrator has already published a different current version, this
-- migration is a deliberate no-op.
CREATE TEMP TABLE "_ExternalProcessingFiveTierCurrent" ON COMMIT DROP AS
SELECT book."id"
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalProcessingFiveTierClock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
ORDER BY book."effectiveFrom" DESC, book."version" DESC;

CREATE TEMP TABLE "_ExternalProcessingFiveTierSource" ON COMMIT DROP AS
SELECT source.*
FROM "CustomerPriceBook" source
WHERE source."id" = 'cpb_external_processing_rule_v3'
  AND source."code" = 'EXTERNAL_SALES_PROCESSING_RULES'::CITEXT
  AND source."version" = 3
  AND source."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND source."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND source."isActive" = TRUE
  AND source."sourceSha256" =
    '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817'
  AND (
    SELECT COUNT(*)
    FROM "_ExternalProcessingFiveTierCurrent" current_book
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM "_ExternalProcessingFiveTierCurrent" current_book
    WHERE current_book."id" IN (
      'cpb_external_processing_rule_v3',
      'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
    )
  );

CREATE TEMP TABLE "_ExternalProcessingFiveTierDisplaced" ON COMMIT DROP AS
SELECT book.*
FROM "CustomerPriceBook" book
WHERE book."id" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "_ExternalProcessingFiveTierSource") = 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook"
    WHERE "id" = 'cpb_external_processing_rule_v4_five_tier'
  ) THEN
    RAISE EXCEPTION 'External processing five-tier successor already exists';
  END IF;

  IF (SELECT COUNT(*) FROM "_ExternalProcessingFiveTierDisplaced") <> 1 THEN
    RAISE EXCEPTION 'Expected legacy scheduled processing version is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_ExternalProcessingFiveTierDisplaced" displaced
    WHERE displaced."settlementType" <>
        'EXTERNAL_SALES'::"OrderSettlementType"
      OR displaced."purpose" <>
        'PROCESSING'::"CustomerPriceBookPurpose"
  ) THEN
    RAISE EXCEPTION 'Legacy scheduled processing version identity changed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
  ) <> 140 THEN
    RAISE EXCEPTION 'External processing v3 rule count changed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
      AND "isActive" = TRUE
      AND "exclusiveGroup" = 'CUSTOM_BASE'
  ) <> 45 THEN
    RAISE EXCEPTION 'External processing v3 custom tiers changed';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" = 'cpb_external_processing_rule_v3'
      AND rule."isActive" = TRUE
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
    RAISE EXCEPTION 'External processing v3 terminal custom tier changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OrderPriceVersionLock"
    WHERE "priceBookId" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
  ) OR EXISTS (
    SELECT 1
    FROM "OrderCustomerCharge" charge
    WHERE charge."priceBookId" =
        'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
      OR charge."sourceRuleId" IN (
        SELECT rule."id"
        FROM "CustomerPriceRule" rule
        WHERE rule."priceBookId" =
          'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
      )
  ) THEN
    RAISE EXCEPTION 'Legacy scheduled processing version is already referenced';
  END IF;
END
$$;

-- Before the legacy schedule starts, deactivate it without deleting its
-- evidence. If deployment happens after that boundary, close its active
-- interval at the repair instant instead.
UPDATE "CustomerPriceBook" displaced
SET
  "isActive" = FALSE,
  "updatedAt" = clock."releasedAt",
  "notes" = COALESCE(displaced."notes", '{}'::JSONB) || jsonb_build_object(
    'supersededByPriceBookId', 'cpb_external_processing_rule_v4_five_tier',
    'supersededAt',
      to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'supersededReason', '计划版不兼容纯函数建单引擎，由完整的5万档修复版取代。'
  )
FROM "_ExternalProcessingFiveTierClock" clock,
  "_ExternalProcessingFiveTierSource" source
WHERE displaced."id" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
  AND displaced."isActive" = TRUE
  AND displaced."effectiveFrom" > clock."releasedAt";

UPDATE "CustomerPriceBook" displaced
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt",
  "notes" = COALESCE(displaced."notes", '{}'::JSONB) || jsonb_build_object(
    'supersededByPriceBookId', 'cpb_external_processing_rule_v4_five_tier',
    'supersededAt',
      to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'supersededReason', '计划版不兼容纯函数建单引擎，由完整的5万档修复版取代。'
  )
FROM "_ExternalProcessingFiveTierClock" clock,
  "_ExternalProcessingFiveTierSource" source
WHERE displaced."id" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
  AND displaced."isActive" = TRUE
  AND displaced."effectiveFrom" <= clock."releasedAt"
  AND (displaced."effectiveTo" IS NULL OR displaced."effectiveTo" > clock."releasedAt");

UPDATE "CustomerPriceBook" current_book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingFiveTierClock" clock,
  "_ExternalProcessingFiveTierSource" source,
  "_ExternalProcessingFiveTierCurrent" selected
WHERE current_book."id" = source."id"
  AND selected."id" = source."id";

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
  (
    SELECT COALESCE(MAX(book."version"), 0) + 1
    FROM "CustomerPriceBook" book
    WHERE book."code" = source."code"
  ),
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
    'supersedesScheduledPriceBookId',
      'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e',
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
        '补齐专版5万档：40,001个起中号0.16元/个、大号0.18元/个。',
      'publishNote',
        '由数据库迁移发布；保留v3与旧计划版证据，不伪造ruleSetSha256。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingFiveTierSource" source
CROSS JOIN "_ExternalProcessingFiveTierClock" clock;

-- Clone v3 without changing it. The five former open-ended rows become the
-- explicit 30k tier (25,001..40,000); every other rule remains byte-for-byte
-- equivalent apart from row identity and timestamps.
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
CROSS JOIN "_ExternalProcessingFiveTierClock" clock
CROSS JOIN "_ExternalProcessingFiveTierSource" source
WHERE rule."priceBookId" = source."id";

-- The five new rows share the source rule's full matcher. Only the quantity
-- interval, evidence hash and confirmed rate differ.
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
CROSS JOIN "_ExternalProcessingFiveTierClock" clock
CROSS JOIN "_ExternalProcessingFiveTierSource" source
WHERE rule."priceBookId" = source."id"
  AND rule."isActive" = TRUE
  AND rule."exclusiveGroup" = 'CUSTOM_BASE'
  AND rule."minQty" = 25001
  AND rule."maxQty" = 9999999;

DO $$
DECLARE
  discontinuity_count INTEGER;
BEGIN
  IF (SELECT COUNT(*) FROM "_ExternalProcessingFiveTierSource") = 0 THEN
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
  ) <> 145 THEN
    RAISE EXCEPTION 'Five-tier processing successor rule count is not 145';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
      AND "isActive" = TRUE
      AND "exclusiveGroup" = 'CUSTOM_BASE'
  ) <> 50 THEN
    RAISE EXCEPTION 'Five-tier processing successor custom tier count is not 50';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
      AND rule."isActive" = TRUE
      AND rule."exclusiveGroup" = 'CUSTOM_BASE'
      AND rule."minQty" = 25001
      AND rule."maxQty" = 40000
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
    RAISE EXCEPTION '30k tier was not preserved for all custom products';
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
    RAISE EXCEPTION '50k tier was not published for all custom products';
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
    RAISE EXCEPTION 'Custom tiers contain a gap, overlap or incomplete endpoint';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceBook" book
    CROSS JOIN "_ExternalProcessingFiveTierClock" clock
    WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."isActive" = TRUE
      AND book."effectiveFrom" <= clock."releasedAt"
      AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
  ) <> 1 THEN
    RAISE EXCEPTION 'Processing current version is not unique after repair';
  END IF;
END
$$;

COMMIT;
