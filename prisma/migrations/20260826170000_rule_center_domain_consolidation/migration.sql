BEGIN;

-- This migration retires duplicated *new-order* concepts without rewriting
-- historical orders or production tasks.  Published customer prices remain
-- immutable: the resolved stock-local-foil rules are released as a new price
-- book version instead of mutating the version already used by old quotes.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerChargeCategory",
  "CustomerPriceRule",
  "Craft",
  "ProductCategoryNode",
  "Product",
  "Material"
IN SHARE ROW EXCLUSIVE MODE;

-- Material(PAPER) is the canonical paper catalogue.  Existing quote SKUs
-- contain the audited legacy paper names, so backfill any missing paper rows
-- before the order form starts reading from Material rather than free text.
WITH paper_names AS (
  SELECT DISTINCT btrim("paperType") AS name
  FROM "Product"
  WHERE "paperType" IS NOT NULL
    AND btrim("paperType") <> ''
)
INSERT INTO "Material" (
  "id",
  "code",
  "name",
  "category",
  "specification",
  "unit",
  "currentStock",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'mat_paper_' || substr(md5(lower(paper.name)), 1, 24),
  ('PAPER-' || upper(substr(md5(lower(paper.name)), 1, 12)))::CITEXT,
  paper.name,
  'PAPER'::"MaterialCategory",
  NULL,
  '张',
  0,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM paper_names paper
WHERE NOT EXISTS (
  SELECT 1
  FROM "Material" material
  WHERE material."category" = 'PAPER'::"MaterialCategory"
    AND lower(btrim(material."name")) = lower(paper.name)
)
ON CONFLICT ("code") DO NOTHING;

-- STOCK_FOIL and FLAT_FOIL_PARTIAL describe the same hand-press operation.
-- Keep STOCK_FOIL rows and foreign keys for history, but hide it from every
-- new-order picker.  Application compatibility still canonicalises its code.
UPDATE "Craft"
SET
  "isActive" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'STOCK_FOIL'
  AND "isActive" = TRUE;

-- These legacy route-shaped category nodes are empty in the audited data.
-- Only deactivate a node when it is still unreferenced, so this remains safe
-- for installations that added their own products or category-level BOMs.
UPDATE "ProductCategoryNode" category
SET
  "isActive" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE category."legacyCategory" IN (
    'GENERIC_STOCK'::"ProductCategory",
    'STOCK_FOIL_ADD'::"ProductCategory",
    'BYO_MATERIAL'::"ProductCategory"
  )
  AND category."isActive" = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM "Product" product
    WHERE product."categoryNodeId" = category."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "BillOfMaterial" bom
    WHERE bom."categoryNodeId" = category."id"
  );

DO $$
DECLARE
  source_book RECORD;
  next_version INTEGER;
  next_book_id TEXT;
  next_effective_from TIMESTAMP(3);
  released_at TIMESTAMP(3) := CURRENT_TIMESTAMP;
  next_notes JSONB;
  source_count INTEGER;
BEGIN
  -- A previously applied equivalent release makes this migration a no-op.
  IF EXISTS (
    SELECT 1
    FROM "CustomerPriceRule" rule
    JOIN "CustomerPriceBook" book ON book."id" = rule."priceBookId"
    WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
      AND book."isActive" = TRUE
      AND rule."code" = 'STOCK_LOCAL_FOIL_SINGLE_GTE_1000'
  ) THEN
    RETURN;
  END IF;

  -- Preserve the whole published timeline.  A factory may already have a
  -- scheduled future price version; every still-relevant segment is cloned
  -- with the new structural rules rather than being silently discarded.
  CREATE TEMP TABLE "_RuleBookReleaseSource" ON COMMIT DROP AS
  SELECT book.*
  FROM "CustomerPriceBook" book
  WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
    AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
    AND book."isActive" = TRUE
    AND (book."effectiveTo" IS NULL OR book."effectiveTo" > released_at);

  SELECT COUNT(*) INTO source_count FROM "_RuleBookReleaseSource";
  IF source_count = 0 THEN
    RAISE EXCEPTION
      'Rule-centre consolidation requires an active or scheduled external-sales processing price book';
  END IF;

  -- Close the currently effective segment at release time.  Future segments
  -- are cancelled as published records and replaced by cloned successors.
  UPDATE "CustomerPriceBook" book
  SET
    "effectiveTo" = CASE
      WHEN source."effectiveFrom" < released_at THEN released_at
      ELSE book."effectiveTo"
    END,
    "isActive" = source."effectiveFrom" < released_at,
    "updatedAt" = released_at
  FROM "_RuleBookReleaseSource" source
  WHERE book."id" = source."id";

  FOR source_book IN
    SELECT *
    FROM "_RuleBookReleaseSource"
    ORDER BY "effectiveFrom" ASC, "version" ASC, "id" ASC
  LOOP
    SELECT COALESCE(MAX(book."version"), 0) + 1
    INTO next_version
    FROM "CustomerPriceBook" book
    WHERE book."code" = source_book."code";

    next_book_id :=
      'cpb_stock_local_foil_' || substr(
        md5(source_book."id" || ':' || next_version::TEXT),
        1,
        24
      );
    next_effective_from := GREATEST(source_book."effectiveFrom", released_at);
    -- A structural system release is not the human-authored draft that may
    -- have produced the source segment.  Drop inherited workflow/hash evidence
    -- and record a new system-release provenance without claiming a rule-set
    -- digest that PostgreSQL did not calculate.
    next_notes := (
      CASE
        WHEN jsonb_typeof(source_book."notes") = 'object'
          THEN source_book."notes"
        ELSE '{}'::JSONB
      END
      - 'workflow'
      - 'ruleSetSha256'
    )
      || jsonb_build_object(
        'summary', '当前结构化规则版本：三条基础计价路线；局部烫金按 1000 数量边界自动计费。',
        'ruleVersion', '2026-08-26',
        'constants', jsonb_build_object(
          'stockLocalFoilBoundaryQty', 1000,
          'stockLocalFoilSingleBelowBoundary', 40,
          'stockLocalFoilDoubleBelowBoundary', 80,
          'stockLocalFoilSingleAtOrAboveBoundary', 0.04,
          'stockLocalFoilDoubleAtOrAboveBoundary', 0.08,
          'tenThousandEnvelopeLocalMachineFee', 60,
          'paperWeightBaselineGsm', 160,
          'singleStyleBagFee', 0.1,
          'mixedStyleBagFee', 0.2,
          'setupFee', 90
        ),
        'supersedesPriceBookId', source_book."id",
        'workflow', jsonb_build_object(
          'status', 'SYSTEM_RELEASE',
          'basedOn', jsonb_build_object(
            'id', source_book."id",
            'code', source_book."code"::TEXT,
            'version', source_book."version"
          ),
          'createdBy', 'SYSTEM_MIGRATION',
          'createdAt', to_char(
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'changeReason', '规则中心结构化发布：三条计价路线、包装组按袋计费与局部烫金数量边界。',
          'publishedBy', 'SYSTEM_MIGRATION',
          'publishedAt', to_char(
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'publishNote', '由规则中心数据库迁移发布；未生成伪造的 ruleSetSha256。'
        )
      );

    INSERT INTO "CustomerPriceBook" (
      "id", "code", "name", "settlementType", "purpose", "version",
      "currency", "sourceName", "sourceSha256", "effectiveFrom",
      "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
    ) VALUES (
      next_book_id,
      source_book."code",
      source_book."name" || ' · 结构化规则',
      source_book."settlementType",
      source_book."purpose",
      next_version,
      source_book."currency",
      '系统规则配置：局部烫金 1000 数量边界',
      'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32',
      next_effective_from,
      source_book."effectiveTo",
      TRUE,
      next_notes,
      released_at,
      released_at
    );

    -- Clone every published rule so each replacement book is complete and
    -- independently auditable. Historical charges keep their original IDs.
    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "productId", "code", "name",
      "kind", "calculationType", "amount", "includedUnits",
      "incrementUnits", "incrementAmount", "minQty", "maxQty",
      "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
      "sourceRange", "sourceName", "sourceSha256", "note",
      "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
    )
    SELECT
      'cpr_' || md5(next_book_id || ':' || rule."id"),
      next_book_id,
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
      released_at,
      released_at
    FROM "CustomerPriceRule" rule
    WHERE rule."priceBookId" = source_book."id";

    -- Upgrade only the cloned rules.  Source v1/v2 rows remain byte-for-byte
    -- workbook evidence (apart from their legitimate validity-window close).
    IF EXISTS (
      SELECT 1
      FROM "CustomerPriceRule" rule
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(rule."triggerCondition"->'productCodes', '[]'::JSONB)
      ) AS product(product_code)
      WHERE rule."priceBookId" = next_book_id
        AND lower(rule."code"::TEXT) NOT IN (
          lower('REF_PACKING_SINGLE_ITEM'),
          lower('REF_PACKING_MIXED_ITEMS')
        )
        AND product_code NOT LIKE 'EXT-STOCK-%'
        AND product_code NOT LIKE 'EXT-CUSTOM-%'
        AND product_code NOT LIKE 'EXT-COLOR-%'
    ) THEN
      RAISE EXCEPTION
        'Cannot derive pricing routes for cloned external-sales product rules';
    END IF;

    WITH cloned_item_rules AS (
      SELECT
        rule."id",
        COALESCE(rule."triggerCondition", '{}'::JSONB) AS condition,
        CASE
          WHEN jsonb_typeof(rule."triggerCondition"->'pricingRoutes') = 'array'
            AND jsonb_array_length(rule."triggerCondition"->'pricingRoutes') > 0
          THEN rule."triggerCondition"->'pricingRoutes'
          WHEN jsonb_typeof(rule."triggerCondition"->'productCodes') = 'array'
            AND jsonb_array_length(rule."triggerCondition"->'productCodes') > 0
          THEN (
            SELECT jsonb_agg(
              DISTINCT route.route_name
              ORDER BY route.route_name
            )
            FROM (
              SELECT CASE
                WHEN product_code LIKE 'EXT-STOCK-%' THEN 'STOCK_BLANK'
                WHEN product_code LIKE 'EXT-CUSTOM-%'
                  THEN 'CUSTOM_SINGLE_FLAT_FOIL'
                WHEN product_code LIKE 'EXT-COLOR-%' THEN 'COLOR_PRINT'
              END AS route_name
              FROM jsonb_array_elements_text(
                rule."triggerCondition"->'productCodes'
              ) AS product(product_code)
            ) AS route
            WHERE route.route_name IS NOT NULL
          )
          ELSE '["COLOR_PRINT","CUSTOM_SINGLE_FLAT_FOIL","STOCK_BLANK"]'::JSONB
        END AS pricing_routes
      FROM "CustomerPriceRule" rule
      WHERE rule."priceBookId" = next_book_id
        AND lower(rule."code"::TEXT) NOT IN (
          lower('REF_PACKING_SINGLE_ITEM'),
          lower('REF_PACKING_MIXED_ITEMS')
        )
    )
    UPDATE "CustomerPriceRule" rule
    SET
      "triggerCondition" = jsonb_set(
        jsonb_set(
          jsonb_set(
            cloned.condition,
            '{schemaVersion}',
            '1'::JSONB,
            TRUE
          ),
          '{target}',
          '"ITEM"'::JSONB,
          TRUE
        ),
        '{pricingRoutes}',
        cloned.pricing_routes,
        TRUE
      ),
      "updatedAt" = released_at
    FROM cloned_item_rules cloned
    WHERE rule."id" = cloned."id";

    -- The confirmed 0.1 / 0.2 rates apply to packaging-group bag counts, not
    -- order item quantities.  Preserve each source version's amount (a future
    -- scheduled source may legitimately have changed it) while replacing only
    -- the cloned rule semantics.
    UPDATE "CustomerPriceRule" rule
    SET
      "name" = CASE lower(rule."code"::TEXT)
        WHEN lower('REF_PACKING_SINGLE_ITEM') THEN '单款装入袋费'
        WHEN lower('REF_PACKING_MIXED_ITEMS') THEN '混装入袋费'
      END,
      "kind" = 'ADD_ON'::"CustomerPriceRuleKind",
      "calculationType" = 'PER_BAG'::"CustomerPriceCalculationType",
      "productId" = NULL,
      "minQty" = NULL,
      "maxQty" = NULL,
      "triggerCondition" = CASE lower(rule."code"::TEXT)
        WHEN lower('REF_PACKING_SINGLE_ITEM') THEN
          '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}'::JSONB
        WHEN lower('REF_PACKING_MIXED_ITEMS') THEN
          '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}'::JSONB
      END,
      "exclusiveGroup" = 'PACKAGING_GROUP_MODE',
      "priority" = 100,
      "blocksAutomaticQuote" = FALSE,
      "note" = CASE lower(rule."code"::TEXT)
        WHEN lower('REF_PACKING_SINGLE_ITEM') THEN
          '已确认业务规则：单款装包装组按实际袋数 × 每袋金额计费。'
        WHEN lower('REF_PACKING_MIXED_ITEMS') THEN
          '已确认业务规则：混装包装组按实际袋数 × 每袋金额计费。'
      END,
      "updatedAt" = released_at
    WHERE rule."priceBookId" = next_book_id
      AND lower(rule."code"::TEXT) IN (
        lower('REF_PACKING_SINGLE_ITEM'),
        lower('REF_PACKING_MIXED_ITEMS')
      );

    IF (
      SELECT COUNT(*)
      FROM "CustomerPriceRule" rule
      WHERE rule."priceBookId" = next_book_id
        AND lower(rule."code"::TEXT) IN (
          lower('REF_PACKING_SINGLE_ITEM'),
          lower('REF_PACKING_MIXED_ITEMS')
        )
        AND rule."kind" = 'ADD_ON'::"CustomerPriceRuleKind"
        AND rule."calculationType" = 'PER_BAG'::"CustomerPriceCalculationType"
        AND rule."triggerCondition"->>'target' = 'PACKAGING_GROUP'
        AND jsonb_array_length(rule."triggerCondition"->'packagingModes') = 1
    ) <> 2 THEN
      RAISE EXCEPTION
        'Cloned price book is missing the two structured packaging-group rules';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "CustomerPriceRule" rule
      WHERE rule."priceBookId" = next_book_id
        AND lower(rule."code"::TEXT) NOT IN (
          lower('REF_PACKING_SINGLE_ITEM'),
          lower('REF_PACKING_MIXED_ITEMS')
        )
        AND (
          rule."triggerCondition"->>'schemaVersion' IS DISTINCT FROM '1'
          OR rule."triggerCondition"->>'target' IS DISTINCT FROM 'ITEM'
          OR jsonb_typeof(rule."triggerCondition"->'pricingRoutes')
            IS DISTINCT FROM 'array'
          OR jsonb_array_length(rule."triggerCondition"->'pricingRoutes') = 0
        )
    ) THEN
      RAISE EXCEPTION
        'Structured pricing-route conversion left incomplete cloned item rules';
    END IF;

    -- Keep the old warning for audit, but it no longer blocks this version.
    UPDATE "CustomerPriceRule"
    SET
      "name" = '机仔局部烫金旧边界说明（已由当前版本解决）',
      "blocksAutomaticQuote" = FALSE,
      "isActive" = FALSE,
      "note" = '历史说明保留；当前版本使用 1–999 固定价、1000 起按件价。',
      "updatedAt" = released_at
    WHERE "priceBookId" = next_book_id
      AND "code" = 'REF_MACHINE_FOIL_AMBIGUOUS';

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "productId", "code", "name",
      "kind", "calculationType", "amount", "minQty", "maxQty",
      "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
      "sourceRange", "sourceName", "sourceSha256", "note",
      "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
    )
    SELECT
      'cpr_' || md5(next_book_id || ':' || source."code"),
      next_book_id,
      category."id",
      NULL,
      source."code"::CITEXT,
      source."name",
      'ADD_ON'::"CustomerPriceRuleKind",
      source."calculationType"::"CustomerPriceCalculationType",
      source."amount"::DECIMAL(14, 4),
      source."minQty",
      source."maxQty",
      source."triggerCondition"::JSONB,
      source."exclusiveGroup",
      300,
      '当前规则版本',
      NULL,
      '工单规则配置中心',
      'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32',
      source."note",
      FALSE,
      TRUE,
      released_at,
      released_at
    FROM (
      VALUES
        (
          'STOCK_LOCAL_FOIL_SINGLE_LT_1000',
          '通版现货局部烫金（单面，1–999 个）',
          'FIXED_AMOUNT', '40.0000', 1, 999,
          '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilColorCount":1,"isDoubleSided":false}',
          'STOCK_LOCAL_FOIL_MACHINE',
          '1–999 个按款固定收取 40 元。'
        ),
        (
          'STOCK_LOCAL_FOIL_DOUBLE_LT_1000',
          '通版现货局部烫金（双面，1–999 个）',
          'FIXED_AMOUNT', '80.0000', 1, 999,
          '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilColorCount":1,"isDoubleSided":true}',
          'STOCK_LOCAL_FOIL_MACHINE',
          '1–999 个按款固定收取 80 元。'
        ),
        (
          'STOCK_LOCAL_FOIL_SINGLE_GTE_1000',
          '通版现货局部烫金（单面，1000 个起）',
          'PER_PIECE', '0.0400', 1000, 9999999,
          '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilColorCount":1,"isDoubleSided":false}',
          'STOCK_LOCAL_FOIL_MACHINE',
          '1000 个起按 0.04 元/个收取；1000 个对应 40 元。'
        ),
        (
          'STOCK_LOCAL_FOIL_DOUBLE_GTE_1000',
          '通版现货局部烫金（双面，1000 个起）',
          'PER_PIECE', '0.0800', 1000, 9999999,
          '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilColorCount":1,"isDoubleSided":true}',
          'STOCK_LOCAL_FOIL_MACHINE',
          '1000 个起按 0.08 元/个收取；1000 个对应 80 元。'
        ),
        (
          'STOCK_TEN_THOUSAND_LOCAL_MACHINE_FEE',
          '万元封局部上机费',
          'FIXED_AMOUNT', '60.0000', 1, 9999999,
          '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"productStructures":["TEN_THOUSAND_ENVELOPE"],"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilColorCount":1}',
          NULL,
          '万元封选择局部烫金时，另按款收取 60 元上机费。'
        )
    ) AS source(
      "code", "name", "calculationType", "amount", "minQty", "maxQty",
      "triggerCondition", "exclusiveGroup", "note"
    )
    JOIN "CustomerChargeCategory" category
      ON category."code" = 'FOIL_SURCHARGE';
  END LOOP;
END
$$;

COMMIT;
