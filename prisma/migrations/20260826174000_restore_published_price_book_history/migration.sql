BEGIN;

-- Repair only the audited August workbook books that were rewritten by the
-- earlier, unreleased forms of 1500/1610/1620.  New installations keep these
-- rows untouched because those migrations are now non-mutating; the WHERE
-- clauses below make the repair idempotent in both shapes.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

-- General workbook rules only gained these three keys during the accidental
-- in-place upgrades.  Remove exactly those keys and turn the synthetic empty
-- object back into NULL.  Packaging references are restored separately below.
UPDATE "CustomerPriceRule" rule
SET "triggerCondition" = NULLIF(
  rule."triggerCondition"
    - 'schemaVersion'
    - 'pricingRoutes'
    - 'target',
  '{}'::JSONB
)
FROM "CustomerPriceBook" book
WHERE book."id" = rule."priceBookId"
  AND book."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT
  AND book."version" IN (1, 2)
  AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."sourceSha256" =
    '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
  AND lower(rule."code"::TEXT) NOT IN (
    lower('REF_PACKING_SINGLE_ITEM'),
    lower('REF_PACKING_MIXED_ITEMS')
  )
  AND rule."triggerCondition" ?| ARRAY[
    'schemaVersion',
    'pricingRoutes',
    'target'
  ];

-- Restore the two workbook references to their source semantics.  Amount is
-- deliberately absent from SET: v2 may contain an administrator-approved rate
-- change and that version-specific amount must survive the repair.
UPDATE "CustomerPriceRule" rule
SET
  "name" = CASE lower(rule."code"::TEXT)
    WHEN lower('REF_PACKING_SINGLE_ITEM') THEN '单款入袋参考价'
    WHEN lower('REF_PACKING_MIXED_ITEMS') THEN '两款及以上混装入袋参考价'
  END,
  "kind" = 'REFERENCE'::"CustomerPriceRuleKind",
  "calculationType" = 'PER_PIECE'::"CustomerPriceCalculationType",
  "productId" = NULL,
  "minQty" = NULL,
  "maxQty" = NULL,
  "triggerCondition" = CASE lower(rule."code"::TEXT)
    WHEN lower('REF_PACKING_SINGLE_ITEM') THEN
      '{"craftCodes":["PACKING"],"maxItemCount":1}'::JSONB
    WHEN lower('REF_PACKING_MIXED_ITEMS') THEN
      '{"craftCodes":["PACKING"],"minItemCount":2}'::JSONB
  END,
  "exclusiveGroup" = NULL,
  "priority" = 10,
  "blocksAutomaticQuote" = TRUE,
  "note" = CASE lower(rule."code"::TEXT)
    WHEN lower('REF_PACKING_SINGLE_ITEM') THEN
      '入袋 0.1 元/袋；与混装规则的替代口径未确认，仅供人工报价参考。'
    WHEN lower('REF_PACKING_MIXED_ITEMS') THEN
      '2个款起算混装 0.2 元/袋；是否替代单款规则未确认，仅供人工报价参考。'
  END
FROM "CustomerPriceBook" book
WHERE book."id" = rule."priceBookId"
  AND book."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT
  AND book."version" IN (1, 2)
  AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."sourceSha256" =
    '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
  AND lower(rule."code"::TEXT) IN (
    lower('REF_PACKING_SINGLE_ITEM'),
    lower('REF_PACKING_MIXED_ITEMS')
  );

-- The cloned structural books must not inherit a human draft's publisher or
-- hash.  Keep their business notes/constants, replace provenance with an
-- explicit system release, and intentionally omit ruleSetSha256 because this
-- SQL migration does not calculate the application's canonical rule-set hash.
UPDATE "CustomerPriceBook" structured
SET
  "notes" = (
    structured."notes"
      - 'workflow'
      - 'ruleSetSha256'
  ) || jsonb_build_object(
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'basedOn', jsonb_build_object(
        'id', source."id",
        'code', source."code"::TEXT,
        'version', source."version"
      ),
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(
        structured."createdAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'changeReason', '规则中心结构化发布：三条计价路线、包装组按袋计费与局部烫金数量边界。',
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(
        structured."createdAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'publishNote', '由规则中心数据库迁移发布；未生成伪造的 ruleSetSha256。'
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "CustomerPriceBook" source
WHERE structured."settlementType" =
    'EXTERNAL_SALES'::"OrderSettlementType"
  AND structured."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND structured."sourceSha256" =
    'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32'
  AND jsonb_typeof(structured."notes") = 'object'
  AND source."id" = structured."notes"->>'supersedesPriceBookId'
  AND source."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT
  AND source."version" IN (1, 2)
  AND source."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND source."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND source."sourceSha256" =
    '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
  AND (
    structured."notes" ? 'ruleSetSha256'
    OR structured."notes"->'workflow' IS NULL
    OR structured."notes"->'workflow'->>'status'
      IS DISTINCT FROM 'SYSTEM_RELEASE'
    OR structured."notes"->'workflow' ? 'ruleSetSha256'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" rule
    JOIN "CustomerPriceBook" book ON book."id" = rule."priceBookId"
    WHERE book."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT
      AND book."version" IN (1, 2)
      AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."sourceSha256" =
        '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
      AND rule."triggerCondition" ?| ARRAY[
        'schemaVersion',
        'pricingRoutes',
        'target'
      ]
  ) THEN
    RAISE EXCEPTION
      'Published workbook history still contains structural migration keys';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" book
    WHERE book."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT
      AND book."version" IN (1, 2)
      AND book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."sourceSha256" =
        '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
      AND (
        SELECT COUNT(*)
        FROM "CustomerPriceRule" rule
        WHERE rule."priceBookId" = book."id"
          AND lower(rule."code"::TEXT) IN (
            lower('REF_PACKING_SINGLE_ITEM'),
            lower('REF_PACKING_MIXED_ITEMS')
          )
          AND rule."kind" = 'REFERENCE'::"CustomerPriceRuleKind"
          AND rule."calculationType" =
            'PER_PIECE'::"CustomerPriceCalculationType"
          AND rule."exclusiveGroup" IS NULL
          AND rule."priority" = 10
          AND rule."blocksAutomaticQuote" = TRUE
      ) <> 2
  ) THEN
    RAISE EXCEPTION
      'Published workbook packaging references were not restored exactly';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceBook" structured
    JOIN "CustomerPriceBook" source
      ON source."id" = structured."notes"->>'supersedesPriceBookId'
    WHERE structured."sourceSha256" =
        'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32'
      AND source."sourceSha256" =
        '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
      AND (
        structured."notes" ? 'ruleSetSha256'
        OR structured."notes"->'workflow'->>'status'
          IS DISTINCT FROM 'SYSTEM_RELEASE'
        OR structured."notes"->'workflow' ? 'ruleSetSha256'
      )
  ) THEN
    RAISE EXCEPTION
      'Structured system release still carries inherited workflow/hash evidence';
  END IF;
END
$$;

COMMIT;
