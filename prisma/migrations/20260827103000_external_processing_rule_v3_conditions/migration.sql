BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule",
  "CustomerChargeCategory",
  "Product"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalProcessingV3Clock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

CREATE TEMP TABLE "_ExternalProcessingV3Source" ON COMMIT DROP AS
SELECT
  book.*,
  book."effectiveTo" AS "sourceEffectiveTo"
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalProcessingV3Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
  -- v3 is a forward system repair, not a generic republish operation. An
  -- administrator-owned current version must remain untouched even when it
  -- happens to contain the same number of packaging rules.
  AND book."id" = 'cpb_external_processing_rule_v2_packaging'
  AND book."notes"->'workflow'->>'status' = 'SYSTEM_RELEASE'
  AND book."notes"->>'supersedesPriceBookId' =
    'cpb_external_processing_rule_v2'
  AND book."notes"->'workflow'->'basedOn'->>'id' =
    'cpb_external_processing_rule_v2';

DO $$
BEGIN
  -- No eligible source means that an administrator (or a later release)
  -- already owns the current timeline. Preserve it and make this migration a
  -- deliberate no-op. Packaging and lamination checks below apply only to the
  -- exact system predecessor selected above.
  IF (SELECT COUNT(*) FROM "_ExternalProcessingV3Source") = 0 THEN
    RETURN;
  END IF;
  IF (SELECT COUNT(*) FROM "_ExternalProcessingV3Source") <> 1 THEN
    RAISE EXCEPTION 'External processing system predecessor is not unique';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM "CustomerPriceRule" rule
    JOIN "_ExternalProcessingV3Source" source
      ON source."id" = rule."priceBookId"
    WHERE rule."isActive" = TRUE
      AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP'
  ) <> 2 THEN
    RAISE EXCEPTION
      'External processing v3 source lacks complete packaging rules';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook"
    WHERE "id" = 'cpb_external_processing_rule_v3'
  ) THEN
    RAISE EXCEPTION 'External processing v3 already exists';
  END IF;
END
$$;

-- Closing the current interval is the only lifecycle write to v2. Its rules
-- and historical order snapshots remain immutable; v3 carries every matcher
-- correction from this point forward.
UPDATE "CustomerPriceBook" book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingV3Clock" clock,
  "_ExternalProcessingV3Source" source
WHERE source."id" = book."id";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_processing_rule_v3',
  source."code",
  '外部销售加工费 · 结构化条件',
  source."settlementType",
  source."purpose",
  (
    SELECT COALESCE(MAX(book."version"), 0) + 1
    FROM "CustomerPriceBook" book
    WHERE book."code" = source."code"
  ),
  source."currency",
  source."sourceName",
  source."sourceSha256",
  clock."releasedAt",
  source."sourceEffectiveTo",
  TRUE,
  (
    COALESCE(source."notes", '{}'::JSONB)
      - 'ruleVersion'
      - 'workflow'
  ) || jsonb_build_object(
    'ruleVersion', '2026-08-27',
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'changeReason', '将覆膜、双面与多道烫金边界收口为版本化结构条件。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingV3Source" source
CROSS JOIN "_ExternalProcessingV3Clock" clock;

-- Clone the complete v2 rule set. Color-print base rows gain an explicit
-- lamination matcher: coated paper is quoted with matte film; ice-white paper
-- is quoted without film. A new version can change these facts without code.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_v3_' || substr(md5(rule."id"), 1, 24),
  'cpb_external_processing_rule_v3',
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
  CASE
    WHEN rule."kind" = 'BASE'::"CustomerPriceRuleKind"
      AND COALESCE(rule."triggerCondition"->'pricingRoutes', '[]'::JSONB)
        @> '["COLOR_PRINT"]'::JSONB
    THEN jsonb_set(
      COALESCE(rule."triggerCondition", '{}'::JSONB),
      '{laminations}',
      CASE
        WHEN product."paperType" ILIKE '%铜版%'
          THEN '["MATTE"]'::JSONB
        ELSE '["NONE"]'::JSONB
      END,
      TRUE
    )
    ELSE rule."triggerCondition"
  END,
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
LEFT JOIN "Product" product ON product."id" = rule."productId"
CROSS JOIN "_ExternalProcessingV3Clock" clock
JOIN "_ExternalProcessingV3Source" source
  ON source."id" = rule."priceBookId";

INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  seed."id",
  'cpb_external_processing_rule_v3',
  category."id",
  NULL,
  seed."code"::CITEXT,
  seed."name",
  'REFERENCE'::"CustomerPriceRuleKind",
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  seed."triggerCondition",
  NULL,
  500,
  '加工费计费规则.md',
  '§7',
  '加工费计费规则.md',
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
  seed."note",
  TRUE,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM (
  VALUES
    (
      'cpr_v3_custom_double_sided',
      'CUSTOM_DOUBLE_SIDED_MANUAL',
      '专版双面烫金',
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"isDoubleSided":true}'::JSONB,
      '专版双面暂无自动价'
    ),
    (
      'cpr_v3_color_back_side_foil',
      'COLOR_BACK_SIDE_FOIL_MANUAL',
      '彩印反面烫金',
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"isDoubleSided":true}'::JSONB,
      '当前只配置正面单道烫金价'
    ),
    (
      'cpr_v3_color_lamination_manual',
      'COLOR_NONSTANDARD_LAMINATION_MANUAL',
      '彩印未定价覆膜',
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"laminations":["SOFT_TOUCH","NEW_GLOSS","LASER"]}'::JSONB,
      '触感膜、新式光膜与激光膜暂无自动价'
    )
) AS seed("id", "code", "name", "triggerCondition", "note")
JOIN "CustomerChargeCategory" category
  ON category."code" = 'REFERENCE'::CITEXT
CROSS JOIN "_ExternalProcessingV3Source" source
CROSS JOIN "_ExternalProcessingV3Clock" clock;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_ExternalProcessingV3Source") THEN
    IF (
      SELECT COUNT(*)
      FROM "CustomerPriceRule"
      WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
        AND "kind" = 'BASE'::"CustomerPriceRuleKind"
        AND COALESCE("triggerCondition"->'pricingRoutes', '[]'::JSONB)
          @> '["COLOR_PRINT"]'::JSONB
        AND NOT ("triggerCondition" ? 'laminations')
    ) <> 0 THEN
      RAISE EXCEPTION 'Color-print v3 base rules are missing lamination facts';
    END IF;

    IF (
      SELECT COUNT(*)
      FROM "CustomerPriceRule"
      WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
        AND "code"::TEXT IN (
          'CUSTOM_DOUBLE_SIDED_MANUAL',
          'COLOR_BACK_SIDE_FOIL_MANUAL',
          'COLOR_NONSTANDARD_LAMINATION_MANUAL'
        )
        AND "blocksAutomaticQuote" = TRUE
    ) <> 3 THEN
      RAISE EXCEPTION 'External processing v3 blocker rules are incomplete';
    END IF;
  END IF;
END
$$;

COMMIT;
