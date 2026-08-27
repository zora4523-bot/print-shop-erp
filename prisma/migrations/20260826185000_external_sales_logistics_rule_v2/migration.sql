BEGIN;

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalLogisticsV2Clock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

CREATE TEMP TABLE "_ExternalLogisticsV2SourceBook" ON COMMIT DROP AS
SELECT book.*
FROM "CustomerPriceBook" book
CROSS JOIN "_ExternalLogisticsV2Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt")
ORDER BY book."effectiveFrom" DESC, book."version" DESC
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM "_ExternalLogisticsV2SourceBook") <> 1 THEN
    RAISE EXCEPTION 'Cannot publish external logistics rule v2 without one active source book';
  END IF;
END $$;

UPDATE "CustomerPriceBook" book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalLogisticsV2Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt");

UPDATE "CustomerPriceBook" book
SET
  "isActive" = FALSE,
  "updatedAt" = clock."releasedAt"
FROM "_ExternalLogisticsV2Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'LOGISTICS'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" > clock."releasedAt";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_logistics_rule_v2',
  'EXTERNAL_SALES_LOGISTICS_RULES',
  '外部销售纸箱与物流费',
  'EXTERNAL_SALES'::"OrderSettlementType",
  'LOGISTICS'::"CustomerPriceBookPurpose",
  1,
  source."currency",
  '加工费计费规则.md',
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
  clock."releasedAt",
  NULL,
  TRUE,
  jsonb_build_object(
    'ruleVersion', '2026-08-26',
    'carton', jsonb_build_object(
      'scope', 'ORDER_TOTAL_QUANTITY',
      'segmentQuantity', 5000,
      'segmentAmount', 8
    ),
    'shipping', jsonb_build_object(
      'ztoMaximumOrderQuantity', 2000,
      'billableWeightRounding', 'CEIL_KG',
      'minimumBillableWeightKg', 1,
      'gramsPerItemByPaperWeightGsm', jsonb_build_object(
        '120', 4.5,
        '150', 6,
        '160', 6,
        '180', 6.75,
        '200', 8,
        '230', 10
      ),
      'tenThousandEnvelopeGramsPerItem', 10
    ),
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'changeReason', '采用外部销售计费规则中的整单纸箱费、重量进位与物流数量边界。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalLogisticsV2SourceBook" source
CROSS JOIN "_ExternalLogisticsV2Clock" clock;

INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name", "kind",
  "calculationType", "amount", "includedUnits", "incrementUnits", "incrementAmount",
  "minQty", "maxQty", "triggerCondition", "exclusiveGroup", "priority",
  "sourceSheet", "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_logistics_v2_' || substr(md5(source_rule."id"), 1, 20),
  target_book."id",
  source_rule."categoryId",
  source_rule."productId",
  source_rule."code",
  CASE
    WHEN category."code" = 'PACKING_MATERIAL'
      THEN replace(replace(source_rule."name", '打包耗材', '纸箱费'), '参考', '')
    ELSE source_rule."name"
  END,
  CASE
    WHEN category."code" = 'PACKING_MATERIAL'
      THEN 'ADD_ON'::"CustomerPriceRuleKind"
    ELSE source_rule."kind"
  END,
  source_rule."calculationType",
  source_rule."amount",
  source_rule."includedUnits",
  source_rule."incrementUnits",
  source_rule."incrementAmount",
  source_rule."minQty",
  source_rule."maxQty",
  CASE
    WHEN category."code" = 'PACKING_MATERIAL'
      THEN jsonb_build_object(
        'scope', 'ORDER_TOTAL_QUANTITY',
        'segmentedAboveMaximum', TRUE
      )
    ELSE source_rule."triggerCondition"
  END,
  CASE
    WHEN category."code" = 'PACKING_MATERIAL'
      THEN 'CARTON_ORDER_QUANTITY_TIER'
    ELSE source_rule."exclusiveGroup"
  END,
  source_rule."priority",
  CASE
    WHEN category."code" = 'PACKING_MATERIAL' THEN '纸箱费'
    ELSE source_rule."sourceSheet"
  END,
  source_rule."sourceRange",
  CASE
    WHEN category."code" = 'PACKING_MATERIAL' THEN '加工费计费规则.md'
    ELSE source_rule."sourceName"
  END,
  CASE
    WHEN category."code" = 'PACKING_MATERIAL'
      THEN '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817'
    ELSE source_rule."sourceSha256"
  END,
  NULL,
  FALSE,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM "CustomerPriceRule" source_rule
JOIN "_ExternalLogisticsV2SourceBook" source_book
  ON source_book."id" = source_rule."priceBookId"
JOIN "CustomerChargeCategory" category
  ON category."id" = source_rule."categoryId"
JOIN "CustomerPriceBook" target_book
  ON target_book."id" = 'cpb_external_logistics_rule_v2'
CROSS JOIN "_ExternalLogisticsV2Clock" clock
WHERE source_rule."isActive" = TRUE
  AND category."code" IN ('SHIPPING_FEE', 'PACKING_MATERIAL');

COMMIT;
