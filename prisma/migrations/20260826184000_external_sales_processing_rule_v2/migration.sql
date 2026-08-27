BEGIN;

-- The two side arrays are the new-work-order pricing facts.  Historical
-- aggregate columns stay untouched so old snapshots and exports remain valid.
ALTER TABLE "OrderItem"
  ADD COLUMN "frontFoilColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "backFoilColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_front_foil_colors_max_three_check"
    CHECK (cardinality("frontFoilColors") <= 3),
  ADD CONSTRAINT "OrderItem_back_foil_colors_max_three_check"
    CHECK (cardinality("backFoilColors") <= 3);

SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerChargeCategory",
  "CustomerPriceRule",
  "Product",
  "Material"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExternalProcessingV2Clock" ON COMMIT DROP AS
SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS "releasedAt";

-- Preserve prior books as immutable history. Future old-rule segments are
-- deactivated instead of rewritten, while the currently-effective segment is
-- closed at the exact half-open boundary used by the replacement.
UPDATE "CustomerPriceBook" book
SET
  "effectiveTo" = clock."releasedAt",
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingV2Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" <= clock."releasedAt"
  AND (book."effectiveTo" IS NULL OR book."effectiveTo" > clock."releasedAt");

UPDATE "CustomerPriceBook" book
SET
  "isActive" = FALSE,
  "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingV2Clock" clock
WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
  AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
  AND book."isActive" = TRUE
  AND book."effectiveFrom" > clock."releasedAt";

INSERT INTO "CustomerPriceBook" (
  "id", "code", "name", "settlementType", "purpose", "version",
  "currency", "sourceName", "sourceSha256", "effectiveFrom",
  "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
)
SELECT
  'cpb_external_processing_rule_v2',
  'EXTERNAL_SALES_PROCESSING_RULES',
  '外部销售加工费 · 结构化规则',
  'EXTERNAL_SALES'::"OrderSettlementType",
  'PROCESSING'::"CustomerPriceBookPurpose",
  1,
  'CNY',
  '加工费计费规则.md',
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
  clock."releasedAt",
  NULL,
  TRUE,
  jsonb_build_object(
    'ruleVersion', '2026-08-26',
    'summary', '通版现货按过版次数；专版使用连续数量区间；彩印按固定总价数量档。',
    'constants', jsonb_build_object(
      'stockLocalFoilBoundaryQty', 1000,
      'stockLocalFoilPerPassBelowBoundary', 40,
      'stockLocalFoilPerPiecePerPass', 0.04,
      'customPaperBaselineGsm', 160,
      'customReliefSetupFee', 90
    ),
    'workflow', jsonb_build_object(
      'status', 'SYSTEM_RELEASE',
      'createdBy', 'SYSTEM_MIGRATION',
      'createdAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'publishedBy', 'SYSTEM_MIGRATION',
      'publishedAt', to_char(clock."releasedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'changeReason', '采用用户确认的外部销售加工费规则并补齐正反面过版事实。'
    )
  ),
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingV2Clock" clock;

-- Canonical paper names are facts used by the quote engine. Ambiguous import
-- placeholders remain in history but are unavailable to new work orders.
UPDATE "Material"
SET "isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'PAPER'::"MaterialCategory"
  AND (
    "name" ILIKE '%纸张未标%'
    OR "name" ILIKE '%克重未标%'
    OR "name" = '160g艳闪 / 闪红 / 红卡'
  );

WITH paper("code", "name") AS (
  VALUES
    ('PAPER-PEARL-FLASH-120', '120g珠光艳闪'),
    ('PAPER-PEARL-FLASH-160', '160g珠光艳闪'),
    ('PAPER-PEARL-RED-160', '160g珠光闪红'),
    ('PAPER-RED-CARD-160', '160g红卡'),
    ('PAPER-RED-CARD-180', '180g红卡'),
    ('PAPER-RED-CARD-230', '230g红卡'),
    ('PAPER-SOFT-TOUCH-200', '200g触感纸'),
    ('PAPER-VARIEGATED-PEARL-160', '160g杂色珠光'),
    ('PAPER-GOLD-GLITTER-230', '230g金葱'),
    ('PAPER-LINEN-150', '150g莱尼纹'),
    ('PAPER-COATED-200', '200g铜版纸'),
    ('PAPER-ICE-WHITE-160', '160g冰白纸')
)
INSERT INTO "Material" (
  "id", "code", "name", "category", "specification", "unit",
  "currentStock", "isActive", "createdAt", "updatedAt"
)
SELECT
  'mat_' || substr(md5(lower(paper."code")), 1, 24),
  paper."code"::CITEXT,
  paper."name",
  'PAPER'::"MaterialCategory",
  NULL,
  '张',
  0,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM paper
CROSS JOIN "_ExternalProcessingV2Clock" clock
WHERE NOT EXISTS (
  SELECT 1
  FROM "Material" existing
  WHERE existing."category" = 'PAPER'::"MaterialCategory"
    AND lower(btrim(existing."name")) = lower(btrim(paper."name"))
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "unit" = EXCLUDED."unit",
  "isActive" = TRUE,
  "updatedAt" = EXCLUDED."updatedAt";

UPDATE "Material" material
SET "isActive" = TRUE, "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingV2Clock" clock
WHERE material."category" = 'PAPER'::"MaterialCategory"
  AND lower(btrim(material."name")) IN (
    '120g珠光艳闪', '160g珠光艳闪', '160g珠光闪红', '160g红卡',
    '180g红卡', '230g红卡', '200g触感纸', '160g杂色珠光',
    '230g金葱', '150g莱尼纹', '200g铜版纸', '160g冰白纸'
  );

CREATE TEMP TABLE "_ExternalProcessingV2Products" (
  "code" TEXT PRIMARY KEY,
  "category" "ProductCategory" NOT NULL,
  "categoryNodeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "specification" TEXT NOT NULL,
  "paperType" TEXT
) ON COMMIT DROP;

INSERT INTO "_ExternalProcessingV2Products" VALUES
  ('EXT-STOCK-PEARL-FLASH-120-MINI', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 120g · 迷你封', '迷你封50×80', '120g珠光艳闪'),
  ('EXT-STOCK-PEARL-FLASH-160-SQUARE', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 160g · 方形', '方形88×88', '160g珠光艳闪'),
  ('EXT-STOCK-PEARL-FLASH-160-MID', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 160g · 中号封', '中号封80×115', '160g珠光艳闪'),
  ('EXT-STOCK-PEARL-FLASH-160-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 160g · 大号封', '大号封90×165', '160g珠光艳闪'),
  ('EXT-STOCK-PEARL-FLASH-160-WEST-MID', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 160g · 西封中号', '西封中号80×120', '160g珠光艳闪'),
  ('EXT-STOCK-PEARL-FLASH-160-WEST-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '珠光艳闪 160g · 西封大号', '西封大号85×165', '160g珠光艳闪'),
  ('EXT-STOCK-PEARL-RED-160-SQUARE', 'BLANK_STOCK', 'cat_blank_stock', '珠光闪红 160g · 方形', '方形88×88', '160g珠光闪红'),
  ('EXT-STOCK-PEARL-RED-160-MID', 'BLANK_STOCK', 'cat_blank_stock', '珠光闪红 160g · 中号封', '中号封80×115', '160g珠光闪红'),
  ('EXT-STOCK-PEARL-RED-160-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '珠光闪红 160g · 大号封', '大号封90×165', '160g珠光闪红'),
  ('EXT-STOCK-PEARL-RED-160-WEST-MID', 'BLANK_STOCK', 'cat_blank_stock', '珠光闪红 160g · 西封中号', '西封中号80×120', '160g珠光闪红'),
  ('EXT-STOCK-PEARL-RED-160-WEST-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '珠光闪红 160g · 西封大号', '西封大号85×165', '160g珠光闪红'),
  ('EXT-STOCK-RED-CARD-160-SQUARE', 'BLANK_STOCK', 'cat_blank_stock', '红卡 160g · 方形', '方形88×88', '160g红卡'),
  ('EXT-STOCK-RED-CARD-160-MID', 'BLANK_STOCK', 'cat_blank_stock', '红卡 160g · 中号封', '中号封80×115', '160g红卡'),
  ('EXT-STOCK-RED-CARD-160-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '红卡 160g · 大号封', '大号封90×165', '160g红卡'),
  ('EXT-STOCK-RED-CARD-160-WEST-MID', 'BLANK_STOCK', 'cat_blank_stock', '红卡 160g · 西封中号', '西封中号80×120', '160g红卡'),
  ('EXT-STOCK-RED-CARD-160-WEST-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '红卡 160g · 西封大号', '西封大号85×165', '160g红卡'),
  ('EXT-STOCK-RED-CARD-180-MID', 'BLANK_STOCK', 'cat_blank_stock', '红卡 180g · 中号封', '中号封80×115', '180g红卡'),
  ('EXT-STOCK-RED-CARD-180-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '红卡 180g · 大号封', '大号封90×165', '180g红卡'),
  ('EXT-STOCK-RED-CARD-230-MID', 'BLANK_STOCK', 'cat_blank_stock', '红卡 230g · 中号封', '中号封80×115', '230g红卡'),
  ('EXT-STOCK-RED-CARD-230-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '红卡 230g · 大号封', '大号封90×165', '230g红卡'),
  ('EXT-STOCK-SOFT-TOUCH-200-SQUARE', 'BLANK_STOCK', 'cat_blank_stock', '触感纸 200g · 方形', '方形88×88', '200g触感纸'),
  ('EXT-STOCK-SOFT-TOUCH-200-MID', 'BLANK_STOCK', 'cat_blank_stock', '触感纸 200g · 中号封', '中号封80×115', '200g触感纸'),
  ('EXT-STOCK-SOFT-TOUCH-200-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '触感纸 200g · 大号封', '大号封90×165', '200g触感纸'),
  ('EXT-STOCK-VARIEGATED-PEARL-160-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '杂色珠光 160g · 大号封', '大号封90×165', '160g杂色珠光'),
  ('EXT-STOCK-GOLD-GLITTER-230-MID', 'BLANK_STOCK', 'cat_blank_stock', '金葱 230g · 中号封', '中号封80×115', '230g金葱'),
  ('EXT-STOCK-GOLD-GLITTER-230-LARGE', 'BLANK_STOCK', 'cat_blank_stock', '金葱 230g · 大号封', '大号封90×165', '230g金葱'),
  ('EXT-CUSTOM-MID', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版烫金 · 中号封', '中号封80×115', NULL),
  ('EXT-CUSTOM-SQUARE', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版烫金 · 方形', '方形88×88', NULL),
  ('EXT-CUSTOM-WEST-MID', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版烫金 · 西封中号', '西封中号80×120', NULL),
  ('EXT-CUSTOM-LARGE', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版烫金 · 大号封', '大号封90×165', NULL),
  ('EXT-CUSTOM-WEST-LARGE', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版烫金 · 西封大号', '西封大号85×165', NULL),
  ('EXT-COLOR-COATED-200-LARGE', 'COLOR_PRINT', 'cat_color_print', '铜版纸 200g 彩印 · 大号', '大号88×165', '200g铜版纸'),
  ('EXT-COLOR-COATED-200-MID', 'COLOR_PRINT', 'cat_color_print', '铜版纸 200g 彩印 · 中号', '中号80×120', '200g铜版纸'),
  ('EXT-COLOR-ICE-WHITE-160-LARGE', 'COLOR_PRINT', 'cat_color_print', '冰白纸 160g 彩印 · 大号', '大号88×165', '160g冰白纸'),
  ('EXT-COLOR-ICE-WHITE-160-MID', 'COLOR_PRINT', 'cat_color_print', '冰白纸 160g 彩印 · 中号', '中号80×120', '160g冰白纸');

INSERT INTO "Product" (
  "id", "code", "category", "categoryNodeId", "name", "specification",
  "paperType", "baseUnitPrice", "minOrderQty", "isActive", "createdAt", "updatedAt"
)
SELECT
  'prd_v2_' || substr(md5(lower(seed."code")), 1, 24),
  seed."code"::CITEXT,
  seed."category",
  seed."categoryNodeId",
  seed."name",
  seed."specification",
  seed."paperType",
  NULL,
  NULL,
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingV2Products" seed
CROSS JOIN "_ExternalProcessingV2Clock" clock
ON CONFLICT ("code") DO UPDATE SET
  "category" = EXCLUDED."category",
  "categoryNodeId" = EXCLUDED."categoryNodeId",
  "name" = EXCLUDED."name",
  "specification" = EXCLUDED."specification",
  "paperType" = EXCLUDED."paperType",
  "baseUnitPrice" = NULL,
  "minOrderQty" = NULL,
  "isActive" = TRUE,
  "updatedAt" = EXCLUDED."updatedAt";

UPDATE "Product" product
SET "isActive" = FALSE, "updatedAt" = clock."releasedAt"
FROM "_ExternalProcessingV2Clock" clock
WHERE product."isActive" = TRUE
  AND (
    product."code"::TEXT LIKE 'EXT-STOCK-%'
    OR product."code"::TEXT LIKE 'EXT-CUSTOM-%'
    OR product."code"::TEXT LIKE 'EXT-COLOR-%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "_ExternalProcessingV2Products" keep
    WHERE lower(keep."code") = lower(product."code"::TEXT)
  );

INSERT INTO "CustomerChargeCategory" (
  "id", "code", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt"
)
VALUES
  ('ccc_base_processing', 'BASE_PROCESSING', '基础加工费', NULL, 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_paper_surcharge', 'PAPER_SURCHARGE', '纸张加价', NULL, 20, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_spec_surcharge', 'SPEC_SURCHARGE', '规格加价', NULL, 30, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_color_surcharge', 'COLOR_SURCHARGE', '颜色加价', NULL, 40, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_special_effect', 'SPECIAL_EFFECT', '特殊工艺', NULL, 50, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_foil_surcharge', 'FOIL_SURCHARGE', '烫金费', NULL, 60, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_reference', 'REFERENCE', '待人工核价', NULL, 100, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TEMP TABLE "_ExternalProcessingV2RuleSeed" (
  "productCode" TEXT,
  "categoryCode" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "CustomerPriceRuleKind" NOT NULL,
  "calculationType" "CustomerPriceCalculationType",
  "amount" DECIMAL(14,4),
  "minQty" INTEGER,
  "maxQty" INTEGER,
  "triggerCondition" JSONB NOT NULL,
  "exclusiveGroup" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "sourceRange" TEXT,
  "note" TEXT,
  "blocksAutomaticQuote" BOOLEAN NOT NULL DEFAULT FALSE
) ON COMMIT DROP;

-- Exact stock SKU matrix: one row per paper × gsm × specification cell.
WITH stock("productCode", "rate", "structure") AS (
  VALUES
    ('EXT-STOCK-PEARL-FLASH-120-MINI', 0.1000, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-FLASH-160-SQUARE', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-FLASH-160-MID', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-FLASH-160-LARGE', 0.1300, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-FLASH-160-WEST-MID', 0.1200, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-PEARL-FLASH-160-WEST-LARGE', 0.1200, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-PEARL-RED-160-SQUARE', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-RED-160-MID', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-RED-160-LARGE', 0.1300, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-PEARL-RED-160-WEST-MID', 0.1300, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-PEARL-RED-160-WEST-LARGE', 0.1300, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-160-SQUARE', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-160-MID', 0.1200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-160-LARGE', 0.1300, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-160-WEST-MID', 0.1700, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-160-WEST-LARGE', 0.1700, 'WESTERN_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-180-MID', 0.1350, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-180-LARGE', 0.1500, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-230-MID', 0.1500, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-RED-CARD-230-LARGE', 0.1700, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-SOFT-TOUCH-200-SQUARE', 0.2200, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-SOFT-TOUCH-200-MID', 0.2300, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-SOFT-TOUCH-200-LARGE', 0.2500, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-VARIEGATED-PEARL-160-LARGE', 0.1700, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-GOLD-GLITTER-230-MID', 0.1700, 'STANDARD_ENVELOPE'),
    ('EXT-STOCK-GOLD-GLITTER-230-LARGE', 0.1900, 'STANDARD_ENVELOPE')
)
INSERT INTO "_ExternalProcessingV2RuleSeed"
SELECT
  stock."productCode", 'BASE_PROCESSING',
  'BASE_' || replace(stock."productCode", 'EXT-', ''),
  product."name", 'BASE', 'PER_PIECE', stock."rate", 1, 9999999,
  jsonb_build_object(
    'schemaVersion', 1, 'target', 'ITEM',
    'pricingRoutes', jsonb_build_array('STOCK_BLANK'),
    'productCodes', jsonb_build_array(stock."productCode"),
    'productStructures', jsonb_build_array(stock."structure"),
    'specifications', jsonb_build_array(product."specification"),
    'paperTypes', jsonb_build_array(product."paperType"),
    'foilTechniques', jsonb_build_array('FLAT'),
    'hasLocalFoil', TRUE
  ),
  'STOCK_BASE', 100, '§1.1', NULL, FALSE
FROM stock
JOIN "_ExternalProcessingV2Products" product
  ON product."code" = stock."productCode";

INSERT INTO "_ExternalProcessingV2RuleSeed" VALUES
  (NULL, 'FOIL_SURCHARGE', 'STOCK_LOCAL_FOIL_LT_1000_PER_PASS', '局部烫金 · 1–999个', 'ADD_ON', 'FIXED_AMOUNT', 40.0000, 1, 999,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilPassCount":1,"perFoilPass":true}', 'STOCK_LOCAL_FOIL_MACHINE', 300, '§1.2', NULL, FALSE),
  (NULL, 'FOIL_SURCHARGE', 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS', '局部烫金 · 1000个起', 'ADD_ON', 'PER_PIECE', 0.0400, 1000, 9999999,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],"foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilPassCount":1,"perFoilPass":true}', 'STOCK_LOCAL_FOIL_MACHINE', 300, '§1.2', NULL, FALSE);

-- Continuous custom-foil ranges. Mid/square/west-mid share one rate group;
-- large/west-large share the other. All supported papers are explicit so an
-- unknown active material never falls through to a baseline price.
WITH custom_product("productCode", "rateGroup", "structure") AS (
  VALUES
    ('EXT-CUSTOM-MID', 'MID', 'STANDARD_ENVELOPE'),
    ('EXT-CUSTOM-SQUARE', 'MID', 'STANDARD_ENVELOPE'),
    ('EXT-CUSTOM-WEST-MID', 'MID', 'WESTERN_ENVELOPE'),
    ('EXT-CUSTOM-LARGE', 'LARGE', 'STANDARD_ENVELOPE'),
    ('EXT-CUSTOM-WEST-LARGE', 'LARGE', 'WESTERN_ENVELOPE')
), tier("tier", "minQty", "maxQty", "midRate", "largeRate") AS (
  VALUES
    ('LE_750', 1, 750, 0.4800, 0.5200),
    ('751_1500', 751, 1500, 0.3100, 0.3250),
    ('1501_2500', 1501, 2500, 0.2700, 0.2850),
    ('2501_3500', 2501, 3500, 0.2500, 0.2700),
    ('3501_4500', 3501, 4500, 0.2300, 0.2450),
    ('4501_7500', 4501, 7500, 0.2000, 0.2200),
    ('7501_15000', 7501, 15000, 0.1800, 0.2000),
    ('15001_25000', 15001, 25000, 0.1700, 0.1900),
    ('GTE_25001', 25001, 9999999, 0.1700, 0.1900)
)
INSERT INTO "_ExternalProcessingV2RuleSeed"
SELECT
  custom_product."productCode", 'BASE_PROCESSING',
  'BASE_' || replace(custom_product."productCode", 'EXT-', '') || '_' || tier."tier",
  product."name" || ' · ' || tier."tier", 'BASE', 'PER_PIECE',
  CASE WHEN custom_product."rateGroup" = 'MID' THEN tier."midRate" ELSE tier."largeRate" END,
  tier."minQty", tier."maxQty",
  jsonb_build_object(
    'schemaVersion', 1, 'target', 'ITEM',
    'pricingRoutes', jsonb_build_array('CUSTOM_SINGLE_FLAT_FOIL'),
    'productCodes', jsonb_build_array(custom_product."productCode"),
    'productStructures', jsonb_build_array(custom_product."structure"),
    'specifications', jsonb_build_array(product."specification"),
    'paperTypes', '["160g珠光艳闪","160g红卡","160g杂色珠光","150g莱尼纹","180g红卡","230g红卡","230g金葱","200g触感纸"]'::JSONB
  ),
  'CUSTOM_BASE', 100, '§2.1', NULL, FALSE
FROM custom_product
CROSS JOIN tier
JOIN "_ExternalProcessingV2Products" product
  ON product."code" = custom_product."productCode";

INSERT INTO "_ExternalProcessingV2RuleSeed" VALUES
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_VARIEGATED_PEARL_160', '杂色珠光 160g', 'ADD_ON', 'PER_PIECE', 0.0300, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["160g杂色珠光"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_LINEN_150', '莱尼纹 150g', 'ADD_ON', 'PER_PIECE', 0.0350, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["150g莱尼纹"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_RED_CARD_180', '红卡 180g', 'ADD_ON', 'PER_PIECE', 0.0250, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["180g红卡"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_RED_CARD_230', '红卡 230g', 'ADD_ON', 'PER_PIECE', 0.0400, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["230g红卡"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_GOLD_GLITTER_230', '金葱 230g', 'ADD_ON', 'PER_PIECE', 0.1000, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["230g金葱"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'PAPER_SURCHARGE', 'CUSTOM_PAPER_SOFT_TOUCH_200', '触感纸 200g', 'ADD_ON', 'PER_PIECE', 0.1000, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"paperTypes":["200g触感纸"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2', NULL, FALSE),
  (NULL, 'SPEC_SURCHARGE', 'CUSTOM_WESTERN_ENVELOPE', '西封', 'ADD_ON', 'PER_PIECE', 0.0600, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"productStructures":["WESTERN_ENVELOPE"]}', NULL, 200, '§2.3', NULL, FALSE),
  (NULL, 'COLOR_SURCHARGE', 'CUSTOM_DOUBLE_COLOR', '双色', 'ADD_ON', 'PER_PIECE', 0.0900, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"foilColorCount":2}', NULL, 200, '§2.3', NULL, FALSE),
  (NULL, 'SPECIAL_EFFECT', 'CUSTOM_RELIEF_OR_RAISED_PIECE', '浮雕或激凸', 'ADD_ON', 'PER_PIECE', 0.0500, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"foilTechniques":["RELIEF","RAISED"]}', NULL, 200, '§2.3', NULL, FALSE),
  (NULL, 'SPECIAL_EFFECT', 'CUSTOM_RELIEF_OR_RAISED_SETUP', '浮雕或激凸调版费', 'ADD_ON', 'FIXED_AMOUNT', 90.0000, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"foilTechniques":["RELIEF","RAISED"]}', NULL, 200, '§2.3', NULL, FALSE),
  (NULL, 'REFERENCE', 'CUSTOM_THREE_PLUS_COLORS_MANUAL', '专版三色及以上', 'REFERENCE', NULL, NULL, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"minFoilColorCount":3}', NULL, 500, '§7', '需管理员核价', TRUE),
  (NULL, 'REFERENCE', 'CUSTOM_TEN_THOUSAND_MANUAL', '万元封专版', 'REFERENCE', NULL, NULL, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],"productStructures":["TEN_THOUSAND_ENVELOPE"]}', NULL, 500, '§7', '无自动阶梯价', TRUE);

-- Color-print fixed totals. Only the explicitly confirmed rounding intervals
-- are ranges; every other source quantity remains an exact anchor.
WITH color_price("productCode", "tier", "minQty", "maxQty", "amount") AS (
  VALUES
    ('EXT-COLOR-COATED-200-LARGE','Q100',100,100,130.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q200',200,200,200.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q300',300,300,220.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q400',400,400,240.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q500',500,500,260.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q1000',1000,1000,310.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q2000',2000,2000,450.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q3000',3000,3000,580.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q4000',4000,4000,700.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q5000',5000,7999,870.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q10000',8000,14999,1520.0000),
    ('EXT-COLOR-COATED-200-LARGE','Q20000',15000,20000,2580.0000),
    ('EXT-COLOR-COATED-200-MID','Q500',500,500,210.0000),
    ('EXT-COLOR-COATED-200-MID','Q1000',1000,1000,290.0000),
    ('EXT-COLOR-COATED-200-MID','Q2000',2000,2000,400.0000),
    ('EXT-COLOR-COATED-200-MID','Q3000',3000,3000,470.0000),
    ('EXT-COLOR-COATED-200-MID','Q4000',4000,4000,570.0000),
    ('EXT-COLOR-COATED-200-MID','Q5000',5000,7999,700.0000),
    ('EXT-COLOR-COATED-200-MID','Q10000',8000,14999,1200.0000),
    ('EXT-COLOR-COATED-200-MID','Q20000',15000,20000,2100.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q100',100,100,150.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q200',200,200,230.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q300',300,300,260.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q400',400,400,290.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q500',500,500,320.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q1000',1000,1000,340.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q2000',2000,2000,510.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q3000',3000,3000,700.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q4000',4000,4000,830.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q5000',5000,7999,1000.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q10000',8000,14999,1750.0000),
    ('EXT-COLOR-ICE-WHITE-160-LARGE','Q20000',15000,20000,3200.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q100',100,100,165.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q200',200,200,245.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q300',300,300,275.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q400',400,400,275.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q500',500,500,290.0000),
    ('EXT-COLOR-ICE-WHITE-160-MID','Q1000',1000,1000,320.0000)
)
INSERT INTO "_ExternalProcessingV2RuleSeed"
SELECT
  color_price."productCode", 'BASE_PROCESSING',
  'BASE_' || replace(color_price."productCode", 'EXT-', '') || '_' || color_price."tier",
  product."name" || ' · ' || color_price."tier", 'BASE', 'FIXED_AMOUNT',
  color_price."amount", color_price."minQty", color_price."maxQty",
  jsonb_build_object(
    'schemaVersion', 1, 'target', 'ITEM',
    'pricingRoutes', jsonb_build_array('COLOR_PRINT'),
    'productCodes', jsonb_build_array(color_price."productCode"),
    'productStructures', jsonb_build_array('STANDARD_ENVELOPE'),
    'specifications', jsonb_build_array(product."specification"),
    'paperTypes', jsonb_build_array(product."paperType"),
    'foilTechniques', jsonb_build_array('NONE', 'FLAT')
  ),
  'COLOR_BASE', 100, '§3', NULL, FALSE
FROM color_price
JOIN "_ExternalProcessingV2Products" product
  ON product."code" = color_price."productCode";

WITH foil_price("tier", "minQty", "maxQty", "amount") AS (
  VALUES
    ('Q1000',1000,1000,200.0000),
    ('Q2000',2000,2000,250.0000),
    ('Q3000',3000,3000,350.0000),
    ('Q4000',4000,4000,480.0000),
    ('Q5000',5000,7999,580.0000),
    ('Q10000',8000,14999,700.0000),
    ('Q20000',15000,20000,1200.0000),
    ('Q30000',30000,30000,1700.0000)
)
INSERT INTO "_ExternalProcessingV2RuleSeed"
SELECT
  NULL, 'FOIL_SURCHARGE', 'COLOR_SINGLE_FRONT_FOIL_' || foil_price."tier",
  '彩印正面单色烫金 · ' || foil_price."tier", 'ADD_ON', 'FIXED_AMOUNT',
  foil_price."amount", foil_price."minQty", foil_price."maxQty",
  '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"foilTechniques":["FLAT"],"foilPassCount":1}',
  'COLOR_SINGLE_FRONT_FOIL', 300, '§3', NULL, FALSE
FROM foil_price;

INSERT INTO "_ExternalProcessingV2RuleSeed" VALUES
  (NULL, 'FOIL_SURCHARGE', 'COLOR_SINGLE_FRONT_FOIL_LT_1000_MANUAL', '彩印单色烫金 1000 个以下', 'REFERENCE', NULL, NULL, 1, 999,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"foilTechniques":["FLAT"],"foilPassCount":1}', NULL, 500, '§3', '单色烫金附加总价从 1000 个起才有明确报价', TRUE),
  (NULL, 'REFERENCE', 'COLOR_NONSTANDARD_PROCESS_MANUAL', '彩印非标准工艺', 'REFERENCE', NULL, NULL, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"anyCraftCodeOutside":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL","COLOR_PRINT","COLOR_PRINT_FOIL","DIE_CUT","GLUING","PACKING"]}', NULL, 500, '§3', '非标准膜及未定价工艺需管理员核价', TRUE),
  (NULL, 'REFERENCE', 'COLOR_NON_FLAT_FOIL_MANUAL', '彩印非平烫工艺', 'REFERENCE', NULL, NULL, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"foilTechniques":["RELIEF","RAISED"]}', NULL, 500, '§3', '仅正面单色平烫有明确价格', TRUE),
  (NULL, 'REFERENCE', 'COLOR_MULTI_FOIL_MANUAL', '彩印多色或多次烫金', 'REFERENCE', NULL, NULL, NULL, NULL,
   '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],"minFoilPassCount":2}', NULL, 500, '§3', '仅正面单色烫金有明确价格', TRUE);

INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name",
  "kind", "calculationType", "amount", "includedUnits",
  "incrementUnits", "incrementAmount", "minQty", "maxQty",
  "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
  "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  'cpr_v2_' || substr(md5(lower(seed."code")), 1, 24),
  'cpb_external_processing_rule_v2',
  category."id",
  product."id",
  seed."code"::CITEXT,
  seed."name",
  seed."kind",
  seed."calculationType",
  seed."amount",
  NULL,
  NULL,
  NULL,
  seed."minQty",
  seed."maxQty",
  seed."triggerCondition",
  seed."exclusiveGroup",
  seed."priority",
  '加工费计费规则.md',
  seed."sourceRange",
  '加工费计费规则.md',
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
  seed."note",
  seed."blocksAutomaticQuote",
  TRUE,
  clock."releasedAt",
  clock."releasedAt"
FROM "_ExternalProcessingV2RuleSeed" seed
JOIN "CustomerChargeCategory" category
  ON lower(category."code"::TEXT) = lower(seed."categoryCode")
LEFT JOIN "Product" product
  ON lower(product."code"::TEXT) = lower(seed."productCode")
CROSS JOIN "_ExternalProcessingV2Clock" clock;

-- Defensive release checks: fail the migration rather than publish a partial
-- price book that could silently undercharge.
DO $$
DECLARE
  expected_count INTEGER;
  inserted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_count FROM "_ExternalProcessingV2RuleSeed";
  SELECT COUNT(*) INTO inserted_count
  FROM "CustomerPriceRule"
  WHERE "priceBookId" = 'cpb_external_processing_rule_v2';

  IF inserted_count <> expected_count THEN
    RAISE EXCEPTION
      'External processing rule v2 is incomplete: expected %, inserted %',
      expected_count, inserted_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CustomerPriceRule"
    WHERE "priceBookId" = 'cpb_external_processing_rule_v2'
      AND "code" = 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS'
      AND "triggerCondition" @> '{"perFoilPass":true}'::JSONB
  ) THEN
    RAISE EXCEPTION 'Per-pass stock foil rule is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CustomerPriceRule" rule
    JOIN "Product" product ON product."id" = rule."productId"
    WHERE rule."priceBookId" = 'cpb_external_processing_rule_v2'
      AND (
        product."code"::TEXT LIKE '%157%'
        OR product."code"::TEXT LIKE '%TEN-THOUSAND%'
      )
  ) THEN
    RAISE EXCEPTION 'Retired or undefined product leaked into processing rule v2';
  END IF;
END
$$;

COMMIT;
