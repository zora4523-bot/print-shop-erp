BEGIN;

-- Keep the imported workbook and the products it references coherent with
-- concurrent product-dictionary writes. Customer pricing writers will join the
-- existing advisory price-rule lock when the application layer is introduced.
LOCK TABLE "ProductCategoryNode", "Product" IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "CustomerPriceRuleKind" AS ENUM (
  'BASE',
  'ADD_ON',
  'REFERENCE'
);

CREATE TYPE "CustomerPriceCalculationType" AS ENUM (
  'PER_PIECE',
  'FIXED_AMOUNT',
  'PER_SHEET',
  'PER_10K',
  'PER_ITEM'
);

CREATE TABLE "CustomerPriceBook" (
  "id" TEXT NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "settlementType" "OrderSettlementType" NOT NULL,
  "version" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
  "sourceName" TEXT NOT NULL,
  "sourceSha256" VARCHAR(64) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerPriceBook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerPriceBook_values_valid" CHECK (
    btrim("code"::TEXT) <> '' AND
    btrim("name") <> '' AND
    "version" >= 1 AND
    "currency" ~ '^[A-Z]{3}$' AND
    btrim("sourceName") <> '' AND
    "sourceSha256" ~ '^[0-9a-f]{64}$' AND
    ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
  )
);

CREATE TABLE "CustomerChargeCategory" (
  "id" TEXT NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerChargeCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerChargeCategory_values_valid" CHECK (
    btrim("code"::TEXT) <> '' AND
    btrim("name") <> '' AND
    "sortOrder" >= 0
  )
);

CREATE TABLE "CustomerPriceRule" (
  "id" TEXT NOT NULL,
  "priceBookId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "productId" TEXT,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "CustomerPriceRuleKind" NOT NULL,
  "calculationType" "CustomerPriceCalculationType",
  "amount" DECIMAL(14,4),
  "minQty" INTEGER,
  "maxQty" INTEGER,
  "triggerCondition" JSONB,
  "exclusiveGroup" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sourceSheet" TEXT,
  "sourceRange" TEXT,
  "note" TEXT,
  "blocksAutomaticQuote" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerPriceRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerPriceRule_values_valid" CHECK (
    btrim("code"::TEXT) <> '' AND
    btrim("name") <> '' AND
    "priority" >= 0 AND
    ("amount" IS NULL OR "amount" BETWEEN 0 AND 9999999999.9999) AND
    ("minQty" IS NULL OR "minQty" BETWEEN 1 AND 9999999) AND
    ("maxQty" IS NULL OR "maxQty" BETWEEN 1 AND 9999999) AND
    ("minQty" IS NULL OR "maxQty" IS NULL OR "minQty" <= "maxQty") AND
    ("triggerCondition" IS NULL OR jsonb_typeof("triggerCondition") = 'object') AND
    (("calculationType" IS NULL) = ("amount" IS NULL)) AND
    (
      "kind" = 'REFERENCE'::"CustomerPriceRuleKind" OR
      ("calculationType" IS NOT NULL AND "amount" IS NOT NULL)
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
      "calculationType" IS DISTINCT FROM 'PER_SHEET'::"CustomerPriceCalculationType" OR
      ("triggerCondition" IS NOT NULL AND "triggerCondition" ? 'unitsPerSheet')
    )
  )
);

CREATE UNIQUE INDEX "CustomerPriceBook_code_version_key"
  ON "CustomerPriceBook"("code", "version");
CREATE INDEX "CustomerPriceBook_settlementType_isActive_effectiveFrom_idx"
  ON "CustomerPriceBook"("settlementType", "isActive", "effectiveFrom");
CREATE INDEX "CustomerPriceBook_sourceSha256_idx"
  ON "CustomerPriceBook"("sourceSha256");

CREATE UNIQUE INDEX "CustomerChargeCategory_code_key"
  ON "CustomerChargeCategory"("code");
CREATE INDEX "CustomerChargeCategory_isActive_sortOrder_idx"
  ON "CustomerChargeCategory"("isActive", "sortOrder");

CREATE UNIQUE INDEX "CustomerPriceRule_priceBookId_code_key"
  ON "CustomerPriceRule"("priceBookId", "code");
CREATE INDEX "CustomerPriceRule_priceBookId_kind_isActive_priority_idx"
  ON "CustomerPriceRule"("priceBookId", "kind", "isActive", "priority");
CREATE INDEX "CustomerPriceRule_categoryId_isActive_idx"
  ON "CustomerPriceRule"("categoryId", "isActive");
CREATE INDEX "CustomerPriceRule_productId_isActive_idx"
  ON "CustomerPriceRule"("productId", "isActive");
CREATE INDEX "CustomerPriceRule_exclusiveGroup_idx"
  ON "CustomerPriceRule"("exclusiveGroup");

ALTER TABLE "CustomerPriceRule"
  ADD CONSTRAINT "CustomerPriceRule_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "CustomerPriceBook"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerPriceRule_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "CustomerChargeCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerPriceRule_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one active price book may cover a settlement direction at an instant.
-- Half-open ranges let one version end exactly when the next begins.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "CustomerPriceBook"
  ADD CONSTRAINT "CustomerPriceBook_active_settlement_window_no_overlap"
  EXCLUDE USING gist (
    "settlementType" WITH =,
    tsrange(
      "effectiveFrom",
      COALESCE("effectiveTo", 'infinity'::timestamp),
      '[)'
    ) WITH &&
  )
  WHERE ("isActive");

-- BASE rules for one product are mutually exclusive over quantity. Open bounds
-- are normalized to the same 1..9,999,999 domain enforced by the CHECK above.
ALTER TABLE "CustomerPriceRule"
  ADD CONSTRAINT "CustomerPriceRule_active_base_quantity_no_overlap"
  EXCLUDE USING gist (
    "priceBookId" WITH =,
    "productId" WITH =,
    int8range(
      COALESCE("minQty", 1)::BIGINT,
      COALESCE("maxQty", 9999999)::BIGINT + 1,
      '[)'
    ) WITH &&
  )
  WHERE ("isActive" AND "kind" = 'BASE'::"CustomerPriceRuleKind");

INSERT INTO "CustomerPriceBook" (
  "id",
  "code",
  "name",
  "settlementType",
  "version",
  "currency",
  "sourceName",
  "sourceSha256",
  "effectiveFrom",
  "effectiveTo",
  "isActive",
  "notes",
  "createdAt",
  "updatedAt"
) VALUES (
  'cpb_external_sales_processing_202608_v1',
  'EXTERNAL_SALES_PROCESSING_202608',
  '外部销售加工费价目簿（2026-08）',
  'EXTERNAL_SALES',
  1,
  'CNY',
  '长昆-线下报价表(3)(1).xlsx',
  '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733',
  TIMESTAMP '2026-08-01 00:00:00',
  NULL,
  TRUE,
  '仅录入工作簿中有明确产品、数量锚点和金额的规则。非锚点、重叠边界、缺口和未标规格行不推断价格。',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code", "version") DO UPDATE SET
  "name" = EXCLUDED."name",
  "settlementType" = EXCLUDED."settlementType",
  "currency" = EXCLUDED."currency",
  "sourceName" = EXCLUDED."sourceName",
  "sourceSha256" = EXCLUDED."sourceSha256",
  "effectiveFrom" = EXCLUDED."effectiveFrom",
  "effectiveTo" = EXCLUDED."effectiveTo",
  "isActive" = EXCLUDED."isActive",
  "notes" = EXCLUDED."notes",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CustomerChargeCategory" (
  "id", "code", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES
  ('ccc_base_processing', 'BASE_PROCESSING', '基础加工费', '空封现货、专版烫金和彩印的互斥基础价格。', 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_special_effect', 'SPECIAL_EFFECT', '特殊效果加价', '浮雕、激凸等效果及其调版费用。', 20, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_spec_surcharge', 'SPEC_SURCHARGE', '规格加价', '西封等特殊规格的明确加价。', 30, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_paper_surcharge', 'PAPER_SURCHARGE', '纸张加价', '非基准纸张的每个加价。', 40, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_color_surcharge', 'COLOR_SURCHARGE', '色数加价', '双色及其他明确色数加价。', 50, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_foil_surcharge', 'FOIL_SURCHARGE', '烫金附加费', '彩印烫金和机仔烫金等收费说明。', 60, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_packing', 'PACKING', '入袋与包装', '入袋、混装等包装收费参考。', 70, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ccc_reference', 'REFERENCE', '报价参考与不含项', '不自动计价的打样、不含项、歧义行和人工询价提醒。', 900, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Products are source-backed identities only. Legacy Product.baseUnitPrice and
-- PriceTier stay empty so the old quote engine cannot silently apply a partial
-- workbook import before CustomerPriceRule support is released.
INSERT INTO "Product" (
  "id",
  "code",
  "category",
  "categoryNodeId",
  "name",
  "specification",
  "paperType",
  "baseUnitPrice",
  "minOrderQty",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  source."id",
  source."code"::CITEXT,
  source."category"::"ProductCategory",
  source."categoryNodeId",
  source."name",
  source."specification",
  source."paperType",
  NULL,
  NULL,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('prd_ext_stock_foil_a04', 'EXT-STOCK-FOIL-A04', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 120g迷你 50×80', '迷你 50×80', '120g艳闪'),
    ('prd_ext_stock_foil_a05', 'EXT-STOCK-FOIL-A05', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 方形/中号', '88×88方形 / 中号80×115', '160g艳闪 / 闪红 / 红卡'),
    ('prd_ext_stock_foil_a06', 'EXT-STOCK-FOIL-A06', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 大号/西封中号（纸张未标）', '大号90×165 / 西封中号80×120', '纸张未标（烫金!B6）'),
    ('prd_ext_stock_foil_a07', 'EXT-STOCK-FOIL-A07', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 西封大号（纸张未标）', '西封大号85×165', '纸张未标（烫金!B7）'),
    ('prd_ext_stock_foil_a08', 'EXT-STOCK-FOIL-A08', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 200g触感纸大号', '90×165', '200g触感纸'),
    ('prd_ext_stock_foil_a09', 'EXT-STOCK-FOIL-A09', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 触感纸中号', '80×115', '触感纸（克重未标）'),
    ('prd_ext_stock_foil_a10', 'EXT-STOCK-FOIL-A10', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 触感纸方形', '88×88', '触感纸（克重未标）'),
    ('prd_ext_stock_foil_a11', 'EXT-STOCK-FOIL-A11', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 杂色珠光纸大号', '大号（尺寸未标）', '160g杂色珠光纸'),
    ('prd_ext_stock_foil_a12', 'EXT-STOCK-FOIL-A12', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 230g金葱中号', '中号80×115', '230g金葱'),
    ('prd_ext_stock_foil_a13', 'EXT-STOCK-FOIL-A13', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 大号（纸张未标）', '大号90×165', '纸张未标（烫金!B13）'),
    ('prd_ext_stock_foil_a14_180', 'EXT-STOCK-FOIL-A14-180-RED', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 180g红卡中号', '中号80×115', '180g红卡'),
    ('prd_ext_stock_foil_a14_230', 'EXT-STOCK-FOIL-A14-230-RED', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 230g红卡中号', '中号80×115', '230g红卡'),
    ('prd_ext_stock_foil_a15_180', 'EXT-STOCK-FOIL-A15-180-RED', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 180g红卡大号', '大号90×165', '180g红卡'),
    ('prd_ext_stock_foil_a15_230', 'EXT-STOCK-FOIL-A15-230-RED', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 230g红卡大号', '大号90×165', '230g红卡'),
    ('prd_ext_stock_foil_a16_200', 'EXT-STOCK-FOIL-A16-200-FLASH', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 200g艳闪万元封', '万元封120×220', '200g艳闪'),
    ('prd_ext_stock_foil_a16_230', 'EXT-STOCK-FOIL-A16-230-GLITTER', 'BLANK_STOCK', 'cat_blank_stock', '空封现货 230g金葱万元封', '万元封120×220', '230g金葱'),
    ('prd_ext_custom_foil_mid', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版单色平烫 中号/方形', '8×11.5中号 / 方形', '160g艳闪 / 红卡'),
    ('prd_ext_custom_foil_large', 'EXT-CUSTOM-FOIL-LARGE', 'CUSTOM_FLAT_FOIL', 'cat_custom_flat_foil', '专版单色平烫 大号', '大号9×16.5', '160g艳闪 / 红卡'),
    ('prd_ext_color_157_coated_large', 'EXT-COLOR-157-COATED-LARGE', 'COLOR_PRINT', 'cat_color_print', '157克双铜纸彩印 大号', '大号', '157克双铜纸'),
    ('prd_ext_color_200_coated_large', 'EXT-COLOR-200-COATED-LARGE', 'COLOR_PRINT', 'cat_color_print', '200克双铜纸彩印 大号', '大号', '200克双铜纸'),
    ('prd_ext_color_200_coated_mid', 'EXT-COLOR-200-COATED-MID', 'COLOR_PRINT', 'cat_color_print', '200克双铜纸彩印 中号', '中号', '200克双铜纸'),
    ('prd_ext_color_160_ice_large', 'EXT-COLOR-160-ICE-LARGE', 'COLOR_PRINT', 'cat_color_print', '160克冰白纸彩印 大号', '大号', '160克冰白纸')
) AS source(
  "id", "code", "category", "categoryNodeId", "name", "specification", "paperType"
)
ON CONFLICT ("code") DO UPDATE SET
  "category" = EXCLUDED."category",
  "categoryNodeId" = EXCLUDED."categoryNodeId",
  "name" = EXCLUDED."name",
  "specification" = EXCLUDED."specification",
  "paperType" = EXCLUDED."paperType",
  "baseUnitPrice" = NULL,
  "minOrderQty" = NULL,
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;


-- 111 source-backed rules: 75 BASE,
-- 18 ADD_ON and 18 REFERENCE.
-- Every automatic BASE imported from a quantity table uses an exact anchor
-- (minQty=maxQty). This deliberately leaves non-anchor quantities unpriced.
INSERT INTO "CustomerPriceRule" (
  "id",
  "priceBookId",
  "categoryId",
  "productId",
  "code",
  "name",
  "kind",
  "calculationType",
  "amount",
  "minQty",
  "maxQty",
  "triggerCondition",
  "exclusiveGroup",
  "priority",
  "sourceSheet",
  "sourceRange",
  "note",
  "blocksAutomaticQuote",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  source."id",
  book."id",
  category."id",
  product."id",
  source."code"::CITEXT,
  source."name",
  source."kind"::"CustomerPriceRuleKind",
  source."calculationType"::"CustomerPriceCalculationType",
  source."amount"::DECIMAL(14,4),
  source."minQty",
  source."maxQty",
  source."triggerCondition"::JSONB,
  source."exclusiveGroup",
  source."priority",
  source."sourceSheet",
  source."sourceRange",
  source."note",
  source."blocksAutomaticQuote",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('cpr_ext_202608_base_stock_a04', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A04', 'BASE_STOCK_A04', '空封现货基础价（A4:C4）', 'BASE', 'PER_PIECE', '0.1000', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A4:C4', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a05', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A05', 'BASE_STOCK_A05', '空封现货基础价（A5:C5）', 'BASE', 'PER_PIECE', '0.1200', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A5:C5', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a08', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A08', 'BASE_STOCK_A08', '空封现货基础价（A8:C8）', 'BASE', 'PER_PIECE', '0.2500', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A8:C8', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a09', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A09', 'BASE_STOCK_A09', '空封现货基础价（A9:C9）', 'BASE', 'PER_PIECE', '0.2300', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A9:C9', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a10', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A10', 'BASE_STOCK_A10', '空封现货基础价（A10:C10）', 'BASE', 'PER_PIECE', '0.2200', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A10:C10', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a11', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A11', 'BASE_STOCK_A11', '空封现货基础价（A11:C11）', 'BASE', 'PER_PIECE', '0.1700', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A11:C11', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_stock_a12', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A12', 'BASE_STOCK_A12', '空封现货基础价（A12:C12）', 'BASE', 'PER_PIECE', '0.1700', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A12:C12', '工作簿仅给出单价、未给数量区间；该价只绑定到同一来源行的产品，不继承任何空白纸张单元格。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q500', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q500', '专版单色平烫 中号/方形 500个锚点', 'BASE', 'PER_PIECE', '0.4800', 500, 500, NULL, 'BASE_PROCESSING', 100, '烫金', 'F4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q1000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q1000', '专版单色平烫 中号/方形 1000个锚点', 'BASE', 'PER_PIECE', '0.3100', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '烫金', 'G4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q2000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q2000', '专版单色平烫 中号/方形 2000个锚点', 'BASE', 'PER_PIECE', '0.2700', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '烫金', 'H4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q3000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q3000', '专版单色平烫 中号/方形 3000个锚点', 'BASE', 'PER_PIECE', '0.2500', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '烫金', 'I4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q4000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q4000', '专版单色平烫 中号/方形 4000个锚点', 'BASE', 'PER_PIECE', '0.2300', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '烫金', 'J4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q5000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q5000', '专版单色平烫 中号/方形 5000个锚点', 'BASE', 'PER_PIECE', '0.2000', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '烫金', 'K4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q10000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q10000', '专版单色平烫 中号/方形 10000个锚点', 'BASE', 'PER_PIECE', '0.1800', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '烫金', 'L4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q20000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q20000', '专版单色平烫 中号/方形 20000个锚点', 'BASE', 'PER_PIECE', '0.1700', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '烫金', 'M4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q30000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q30000', '专版单色平烫 中号/方形 30000个锚点', 'BASE', 'PER_PIECE', '0.1700', 30000, 30000, NULL, 'BASE_PROCESSING', 100, '烫金', 'N4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_mid_q50000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-MID-SQUARE', 'BASE_CUSTOM_MID_Q50000', '专版单色平烫 中号/方形 50000个锚点', 'BASE', 'PER_PIECE', '0.1600', 50000, 50000, NULL, 'BASE_PROCESSING', 100, '烫金', 'O4', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q500', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q500', '专版单色平烫 大号 500个锚点', 'BASE', 'PER_PIECE', '0.5200', 500, 500, NULL, 'BASE_PROCESSING', 100, '烫金', 'F5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q1000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q1000', '专版单色平烫 大号 1000个锚点', 'BASE', 'PER_PIECE', '0.3250', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '烫金', 'G5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q2000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q2000', '专版单色平烫 大号 2000个锚点', 'BASE', 'PER_PIECE', '0.2850', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '烫金', 'H5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q3000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q3000', '专版单色平烫 大号 3000个锚点', 'BASE', 'PER_PIECE', '0.2700', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '烫金', 'I5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q4000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q4000', '专版单色平烫 大号 4000个锚点', 'BASE', 'PER_PIECE', '0.2450', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '烫金', 'J5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q5000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q5000', '专版单色平烫 大号 5000个锚点', 'BASE', 'PER_PIECE', '0.2200', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '烫金', 'K5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q10000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q10000', '专版单色平烫 大号 10000个锚点', 'BASE', 'PER_PIECE', '0.2000', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '烫金', 'L5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q20000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q20000', '专版单色平烫 大号 20000个锚点', 'BASE', 'PER_PIECE', '0.1900', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '烫金', 'M5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q30000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q30000', '专版单色平烫 大号 30000个锚点', 'BASE', 'PER_PIECE', '0.1900', 30000, 30000, NULL, 'BASE_PROCESSING', 100, '烫金', 'N5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_custom_large_q50000', 'BASE_PROCESSING', 'EXT-CUSTOM-FOIL-LARGE', 'BASE_CUSTOM_LARGE_Q50000', '专版单色平烫 大号 50000个锚点', 'BASE', 'PER_PIECE', '0.1800', 50000, 50000, NULL, 'BASE_PROCESSING', 100, '烫金', 'O5', '仅对工作簿明确数量锚点精确匹配；不得推断非锚点沿用前一档。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q1000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q1000', '157克双铜纸彩印 大号 1000个固定总额', 'BASE', 'FIXED_AMOUNT', '295.0000', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '彩印', 'H3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q2000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q2000', '157克双铜纸彩印 大号 2000个固定总额', 'BASE', 'FIXED_AMOUNT', '420.0000', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '彩印', 'I3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q3000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q3000', '157克双铜纸彩印 大号 3000个固定总额', 'BASE', 'FIXED_AMOUNT', '530.0000', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '彩印', 'J3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q4000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q4000', '157克双铜纸彩印 大号 4000个固定总额', 'BASE', 'FIXED_AMOUNT', '680.0000', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '彩印', 'K3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q5000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q5000', '157克双铜纸彩印 大号 5000个固定总额', 'BASE', 'FIXED_AMOUNT', '800.0000', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '彩印', 'L3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q10000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q10000', '157克双铜纸彩印 大号 10000个固定总额', 'BASE', 'FIXED_AMOUNT', '1400.0000', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '彩印', 'M3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_157_coated_large_q20000', 'BASE_PROCESSING', 'EXT-COLOR-157-COATED-LARGE', 'BASE_COLOR_157_COATED_LARGE_Q20000', '157克双铜纸彩印 大号 20000个固定总额', 'BASE', 'FIXED_AMOUNT', '2300.0000', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '彩印', 'N3', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q100', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q100', '200克双铜纸彩印 大号 100个固定总额', 'BASE', 'FIXED_AMOUNT', '130.0000', 100, 100, NULL, 'BASE_PROCESSING', 100, '彩印', 'C6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q200', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q200', '200克双铜纸彩印 大号 200个固定总额', 'BASE', 'FIXED_AMOUNT', '200.0000', 200, 200, NULL, 'BASE_PROCESSING', 100, '彩印', 'D6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q300', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q300', '200克双铜纸彩印 大号 300个固定总额', 'BASE', 'FIXED_AMOUNT', '220.0000', 300, 300, NULL, 'BASE_PROCESSING', 100, '彩印', 'E6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q400', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q400', '200克双铜纸彩印 大号 400个固定总额', 'BASE', 'FIXED_AMOUNT', '240.0000', 400, 400, NULL, 'BASE_PROCESSING', 100, '彩印', 'F6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q500', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q500', '200克双铜纸彩印 大号 500个固定总额', 'BASE', 'FIXED_AMOUNT', '260.0000', 500, 500, NULL, 'BASE_PROCESSING', 100, '彩印', 'G6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q1000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q1000', '200克双铜纸彩印 大号 1000个固定总额', 'BASE', 'FIXED_AMOUNT', '310.0000', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '彩印', 'H6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q2000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q2000', '200克双铜纸彩印 大号 2000个固定总额', 'BASE', 'FIXED_AMOUNT', '450.0000', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '彩印', 'I6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q3000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q3000', '200克双铜纸彩印 大号 3000个固定总额', 'BASE', 'FIXED_AMOUNT', '580.0000', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '彩印', 'J6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q4000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q4000', '200克双铜纸彩印 大号 4000个固定总额', 'BASE', 'FIXED_AMOUNT', '700.0000', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '彩印', 'K6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q5000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q5000', '200克双铜纸彩印 大号 5000个固定总额', 'BASE', 'FIXED_AMOUNT', '870.0000', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '彩印', 'L6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q10000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q10000', '200克双铜纸彩印 大号 10000个固定总额', 'BASE', 'FIXED_AMOUNT', '1520.0000', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '彩印', 'M6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_large_q20000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-LARGE', 'BASE_COLOR_200_COATED_LARGE_Q20000', '200克双铜纸彩印 大号 20000个固定总额', 'BASE', 'FIXED_AMOUNT', '2580.0000', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '彩印', 'N6', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q100', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q100', '160克冰白纸彩印 大号 100个固定总额', 'BASE', 'FIXED_AMOUNT', '150.0000', 100, 100, NULL, 'BASE_PROCESSING', 100, '彩印', 'C9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q200', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q200', '160克冰白纸彩印 大号 200个固定总额', 'BASE', 'FIXED_AMOUNT', '230.0000', 200, 200, NULL, 'BASE_PROCESSING', 100, '彩印', 'D9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q300', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q300', '160克冰白纸彩印 大号 300个固定总额', 'BASE', 'FIXED_AMOUNT', '260.0000', 300, 300, NULL, 'BASE_PROCESSING', 100, '彩印', 'E9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q400', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q400', '160克冰白纸彩印 大号 400个固定总额', 'BASE', 'FIXED_AMOUNT', '290.0000', 400, 400, NULL, 'BASE_PROCESSING', 100, '彩印', 'F9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q500', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q500', '160克冰白纸彩印 大号 500个固定总额', 'BASE', 'FIXED_AMOUNT', '320.0000', 500, 500, NULL, 'BASE_PROCESSING', 100, '彩印', 'G9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q1000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q1000', '160克冰白纸彩印 大号 1000个固定总额', 'BASE', 'FIXED_AMOUNT', '340.0000', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '彩印', 'H9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q2000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q2000', '160克冰白纸彩印 大号 2000个固定总额', 'BASE', 'FIXED_AMOUNT', '510.0000', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '彩印', 'I9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q3000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q3000', '160克冰白纸彩印 大号 3000个固定总额', 'BASE', 'FIXED_AMOUNT', '700.0000', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '彩印', 'J9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q4000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q4000', '160克冰白纸彩印 大号 4000个固定总额', 'BASE', 'FIXED_AMOUNT', '830.0000', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '彩印', 'K9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q5000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q5000', '160克冰白纸彩印 大号 5000个固定总额', 'BASE', 'FIXED_AMOUNT', '1000.0000', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '彩印', 'L9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q10000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q10000', '160克冰白纸彩印 大号 10000个固定总额', 'BASE', 'FIXED_AMOUNT', '1750.0000', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '彩印', 'M9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_160_ice_large_q20000', 'BASE_PROCESSING', 'EXT-COLOR-160-ICE-LARGE', 'BASE_COLOR_160_ICE_LARGE_Q20000', '160克冰白纸彩印 大号 20000个固定总额', 'BASE', 'FIXED_AMOUNT', '3200.0000', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '彩印', 'N9', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_stock_a06', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A06', 'BASE_STOCK_A06', '空封现货基础价（A6:C6）', 'BASE', 'PER_PIECE', '0.1300', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A6:C6', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a07', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A07', 'BASE_STOCK_A07', '空封现货基础价（A7:C7）', 'BASE', 'PER_PIECE', '0.1700', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A7:C7', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a13', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A13', 'BASE_STOCK_A13', '空封现货基础价（A13:C13）', 'BASE', 'PER_PIECE', '0.1900', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A13:C13', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a14_180', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A14-180-RED', 'BASE_STOCK_A14_180', '空封现货基础价（A14:C14）', 'BASE', 'PER_PIECE', '0.1350', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A14:C14', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a14_230', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A14-230-RED', 'BASE_STOCK_A14_230', '空封现货基础价（A14:C14）', 'BASE', 'PER_PIECE', '0.1500', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A14:C14', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a15_180', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A15-180-RED', 'BASE_STOCK_A15_180', '空封现货基础价（A15:C15）', 'BASE', 'PER_PIECE', '0.1500', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A15:C15', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a15_230', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A15-230-RED', 'BASE_STOCK_A15_230', '空封现货基础价（A15:C15）', 'BASE', 'PER_PIECE', '0.1700', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A15:C15', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a16_200', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A16-200-FLASH', 'BASE_STOCK_A16_200', '空封现货基础价（A16:C16）', 'BASE', 'PER_PIECE', '0.3800', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A16:C16', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_stock_a16_230', 'BASE_PROCESSING', 'EXT-STOCK-FOIL-A16-230-GLITTER', 'BASE_STOCK_A16_230', '空封现货基础价（A16:C16）', 'BASE', 'PER_PIECE', '0.4200', 1, 9999999, NULL, 'BASE_PROCESSING', 100, '烫金', 'A16:C16', '工作簿给出明确尺寸与单价；纸张空白行使用专属“纸张未标”占位，斜杠价格按同序纸张拆分，禁止继承或猜测其他纸张。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q500', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q500', '200克双铜纸彩印 中号 500个固定总额', 'BASE', 'FIXED_AMOUNT', '210.0000', 500, 500, NULL, 'BASE_PROCESSING', 100, '彩印', 'G7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q1000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q1000', '200克双铜纸彩印 中号 1000个固定总额', 'BASE', 'FIXED_AMOUNT', '290.0000', 1000, 1000, NULL, 'BASE_PROCESSING', 100, '彩印', 'H7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q2000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q2000', '200克双铜纸彩印 中号 2000个固定总额', 'BASE', 'FIXED_AMOUNT', '400.0000', 2000, 2000, NULL, 'BASE_PROCESSING', 100, '彩印', 'I7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q3000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q3000', '200克双铜纸彩印 中号 3000个固定总额', 'BASE', 'FIXED_AMOUNT', '470.0000', 3000, 3000, NULL, 'BASE_PROCESSING', 100, '彩印', 'J7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q4000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q4000', '200克双铜纸彩印 中号 4000个固定总额', 'BASE', 'FIXED_AMOUNT', '570.0000', 4000, 4000, NULL, 'BASE_PROCESSING', 100, '彩印', 'K7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q5000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q5000', '200克双铜纸彩印 中号 5000个固定总额', 'BASE', 'FIXED_AMOUNT', '700.0000', 5000, 5000, NULL, 'BASE_PROCESSING', 100, '彩印', 'L7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q10000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q10000', '200克双铜纸彩印 中号 10000个固定总额', 'BASE', 'FIXED_AMOUNT', '1200.0000', 10000, 10000, NULL, 'BASE_PROCESSING', 100, '彩印', 'M7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_base_color_200_coated_mid_q20000', 'BASE_PROCESSING', 'EXT-COLOR-200-COATED-MID', 'BASE_COLOR_200_COATED_MID_Q20000', '200克双铜纸彩印 中号 20000个固定总额', 'BASE', 'FIXED_AMOUNT', '2100.0000', 20000, 20000, NULL, 'BASE_PROCESSING', 100, '彩印', 'N7', '工作簿给出整批总额；仅对明确数量锚点精确匹配，不插值、不套用区间。', FALSE),
    ('cpr_ext_202608_addon_emboss_piece', 'SPECIAL_EFFECT', NULL, 'ADDON_CUSTOM_EMBOSS_PIECE', '专版浮雕/激凸每个加价', 'ADD_ON', 'PER_PIECE', '0.0500', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"craftCodes":["EMBOSS","BUMP"]}', NULL, 100, '烫金', 'E6:O6', '浮雕或激凸每个加 0.05 元；同一款命中该规则一次。', FALSE),
    ('cpr_ext_202608_addon_emboss_setup', 'SPECIAL_EFFECT', NULL, 'ADDON_CUSTOM_EMBOSS_SETUP', '专版浮雕/激凸调版费', 'ADD_ON', 'PER_ITEM', '90.0000', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"craftCodes":["EMBOSS","BUMP"]}', NULL, 100, '烫金', 'E6:O6', '浮雕或激凸另加 90 元调版费，按款一次。', FALSE),
    ('cpr_ext_202608_addon_western_envelope', 'SPEC_SURCHARGE', NULL, 'ADDON_CUSTOM_WESTERN_ENVELOPE', '专版西封规格加价', 'ADD_ON', 'PER_PIECE', '0.0600', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"specifications":["大号西封"]}', NULL, 100, '烫金', 'E6:O6', '西封每个加 0.06 元；仅使用系统稳定规格“大号西封”。', FALSE),
    ('cpr_ext_202608_addon_double_color', 'COLOR_SURCHARGE', NULL, 'ADDON_CUSTOM_DOUBLE_COLOR', '专版双色加价', 'ADD_ON', 'PER_PIECE', '0.0900', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"foilColorCount":2}', NULL, 100, '烫金', 'E6:O6', '双色每个加 0.09 元；以实际烫金色数为准。', FALSE),
    ('cpr_ext_202608_addon_paper_variegated_pearl_160', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_VARIEGATED_PEARL_160', '专版160g杂色珠光纸加价', 'ADD_ON', 'PER_PIECE', '0.0300', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["160g杂色珠光纸","暗红珠光纸","紫色珠光纸","黄色珠光纸","米金珠光纸","酒红","玫红","粉色"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '工作簿将杂色珠光纸作为同一加价项；已明确映射录单页的杂色珠光快捷值。160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_paper_linen_150', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_LINEN_150', '专版150g莱尼纹加价', 'ADD_ON', 'PER_PIECE', '0.0350', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["150g莱尼纹","莱尼纹"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '录单页“莱尼纹”快捷值映射到工作簿150g莱尼纹加价；160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_paper_red_card_180', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_RED_CARD_180', '专版180g红卡加价', 'ADD_ON', 'PER_PIECE', '0.0250', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["180g红卡"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '仅按工作簿明确纸张名称匹配；160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_paper_red_card_230', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_RED_CARD_230', '专版230g红卡加价', 'ADD_ON', 'PER_PIECE', '0.0400', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["230g红卡"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '仅按工作簿明确纸张名称匹配；160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_paper_gold_glitter_230', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_GOLD_GLITTER_230', '专版230g金葱加价', 'ADD_ON', 'PER_PIECE', '0.1000', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["230g金葱","金葱纸"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '录单页“金葱纸”快捷值映射到工作簿230g金葱加价；160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_paper_soft_touch_200', 'PAPER_SURCHARGE', NULL, 'ADDON_CUSTOM_PAPER_SOFT_TOUCH_200', '专版200g触感加价', 'ADD_ON', 'PER_PIECE', '0.1000', NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"paperTypes":["200g触感","触感纸"]}', 'CUSTOM_PAPER_SURCHARGE', 100, '烫金', 'E7:O7', '录单页“触感纸”快捷值映射到工作簿200g触感加价；160g艳闪、红卡为基准纸，不另加价。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q500', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q500', '彩印单色烫金 500个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '200.0000', 500, 500, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'G13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q1000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q1000', '彩印单色烫金 1000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '250.0000', 1000, 1000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'H13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q2000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q2000', '彩印单色烫金 2000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '350.0000', 2000, 2000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'I13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q3000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q3000', '彩印单色烫金 3000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '480.0000', 3000, 3000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'J13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q4000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q4000', '彩印单色烫金 4000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '580.0000', 4000, 4000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'K13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q5000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q5000', '彩印单色烫金 5000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '700.0000', 5000, 5000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'L13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q10000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q10000', '彩印单色烫金 10000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '1200.0000', 10000, 10000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'M13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_addon_color_single_foil_q20000', 'FOIL_SURCHARGE', NULL, 'ADDON_COLOR_SINGLE_FOIL_Q20000', '彩印单色烫金 20000个固定附加费', 'ADD_ON', 'FIXED_AMOUNT', '1700.0000', 20000, 20000, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}', 'COLOR_PRINT_SINGLE_FOIL_ADDON', 100, '彩印', 'N13', '含烫金版费；仅实际一种烫金色、明确数量锚点自动应用。', FALSE),
    ('cpr_ext_202608_ref_custom_size', 'REFERENCE', NULL, 'REF_CUSTOM_SIZE_CONSULT', '专版改尺寸需人工定价', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"]}', NULL, 10, '烫金', 'E6:O6', '工作簿原文：改尺寸需要看大小定价。当前条件无法表达“与产品标准尺寸不同”，因此只展示提醒，不全局阻断。', FALSE),
    ('cpr_ext_202608_ref_machine_foil', 'FOIL_SURCHARGE', NULL, 'REF_MACHINE_FOIL_AMBIGUOUS', '机仔烫金收费需人工确认', 'REFERENCE', NULL, NULL, NULL, NULL, '{"craftCodes":["FLAT_FOIL_PARTIAL"]}', NULL, 10, '烫金', 'E12:O12', '1千以下单面40/双面80；1千以上单面0.04/双面0.08；1000边界重叠，万元封局部60且上机专版另算，禁止自动计价。', TRUE),
    ('cpr_ext_202608_ref_custom_exclusions', 'REFERENCE', NULL, 'REF_CUSTOM_EXCLUSIONS', '专版价格不含项', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"]}', NULL, 10, '烫金', 'E13:O13', '此价格不含制烫金版费、快递费和入袋费。', FALSE),
    ('cpr_ext_202608_ref_color_unknown_spec_a10', 'REFERENCE', NULL, 'REF_COLOR_ICEWHITE_UNKNOWN_SPEC_A10', '160克冰白纸未标规格价格行', 'REFERENCE', NULL, NULL, NULL, NULL, '{"paperTypes":["160克冰白纸"]}', NULL, 10, '彩印', 'A10:N10', 'B10没有规格标签，仅保留原行锚点 100/200/300/400/500/1000 = 165/245/275/275/290/320 元作为参考，禁止猜成中号。', FALSE),
    ('cpr_ext_202608_ref_color_scope', 'REFERENCE', NULL, 'REF_COLOR_INCLUDED_AND_RANGE_NOTES', '彩印包含项、非标询价与非锚点说明', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"]}', NULL, 10, '彩印', 'A14:N14', '含纸、印刷、标准刀模、啤粘成品；不含入袋，含烫金版费。非标尺寸、触感膜、浮雕、击凸及其他工艺需咨询。区间原文存在7001-7999缺口及15000边界冲突，所以只自动使用明确锚点。', FALSE),
    ('cpr_ext_202608_ref_color_complex_craft', 'REFERENCE', NULL, 'REF_COLOR_COMPLEX_CRAFT_CONSULT', '彩印浮雕/激凸需人工询价', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["EMBOSS","BUMP"]}', NULL, 10, '彩印', 'A14:N14', '彩印浮雕或击凸原表要求直接咨询。', TRUE),
    ('cpr_ext_202608_ref_color_multi_foil', 'FOIL_SURCHARGE', NULL, 'REF_COLOR_MULTI_FOIL_CONSULT', '彩印多色烫金需人工询价', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"minFoilColorCount":2}', NULL, 10, '彩印', 'A13:N14', '原表只给单色烫金附加费，两色及以上不得套用单色规则。', TRUE),
    ('cpr_ext_202608_ref_custom_three_plus_colors', 'COLOR_SURCHARGE', NULL, 'REF_CUSTOM_THREE_PLUS_COLORS', '专版三色及以上需人工询价', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"minFoilColorCount":3}', NULL, 10, '烫金', 'E6:O6', '原表只给双色加价，三色及以上不得套用单色基础价或双色加价。', TRUE),
    ('cpr_ext_202608_ref_color_missing_foil', 'FOIL_SURCHARGE', NULL, 'REF_COLOR_PRINT_FOIL_COLOR_REQUIRED', '彩印+烫金必须选择实际烫金色', 'REFERENCE', NULL, NULL, NULL, NULL, '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":0}', NULL, 10, '彩印', 'A13:N13', '选择彩印+烫金但未填写实际烫金色时禁止自动报价，避免按纯彩印漏收。', TRUE),
    ('cpr_ext_202608_ref_packing_single', 'PACKING', NULL, 'REF_PACKING_SINGLE_ITEM', '单款入袋参考价', 'REFERENCE', 'PER_PIECE', '0.1000', NULL, NULL, '{"craftCodes":["PACKING"],"maxItemCount":1}', NULL, 10, '彩印', 'B1:N1', '入袋 0.1 元/袋；与混装规则的替代口径未确认，仅供人工报价参考。', TRUE),
    ('cpr_ext_202608_ref_packing_mixed', 'PACKING', NULL, 'REF_PACKING_MIXED_ITEMS', '两款及以上混装入袋参考价', 'REFERENCE', 'PER_PIECE', '0.2000', NULL, NULL, '{"craftCodes":["PACKING"],"minItemCount":2}', NULL, 10, '彩印', 'B1:N1', '2个款起算混装 0.2 元/袋；是否替代单款规则未确认，仅供人工报价参考。', TRUE),
    ('cpr_ext_202608_ref_sample_small_single', 'REFERENCE', NULL, 'REF_SAMPLE_SMALL_MACHINE_SINGLE_SIDE', '打样：小机器单面', 'REFERENCE', 'FIXED_AMOUNT', '40.0000', NULL, NULL, '{"craftCodes":["FLAT_FOIL_PARTIAL"],"isDoubleSided":false}', NULL, 10, '烫金', 'A18:B19', '打样参考，未说明按款或按单；标题注明不含烫金版费和啤费。', FALSE),
    ('cpr_ext_202608_ref_sample_small_double', 'REFERENCE', NULL, 'REF_SAMPLE_SMALL_MACHINE_DOUBLE_SIDE', '打样：小机器双面', 'REFERENCE', 'FIXED_AMOUNT', '80.0000', NULL, NULL, '{"craftCodes":["FLAT_FOIL_PARTIAL"],"isDoubleSided":true}', NULL, 10, '烫金', 'A18:B20', '打样参考，未说明按款或按单；标题注明不含烫金版费和啤费。', FALSE),
    ('cpr_ext_202608_ref_sample_windmill_single', 'REFERENCE', NULL, 'REF_SAMPLE_WINDMILL_SINGLE_COLOR', '打样：风车机单色', 'REFERENCE', 'FIXED_AMOUNT', '80.0000', NULL, NULL, '{"craftCodes":["FLAT_FOIL_SINGLE"]}', NULL, 10, '烫金', 'A21:B21', '打样参考，未说明按款或按单；标题注明不含烫金版费和啤费。', FALSE),
    ('cpr_ext_202608_ref_sample_windmill_double', 'REFERENCE', NULL, 'REF_SAMPLE_WINDMILL_DOUBLE_COLOR', '打样：风车机双色', 'REFERENCE', 'FIXED_AMOUNT', '150.0000', NULL, NULL, '{"craftCodes":["FLAT_FOIL_DOUBLE"]}', NULL, 10, '烫金', 'A21:B22', '打样参考，未说明按款或按单；标题注明不含烫金版费和啤费。', FALSE),
    ('cpr_ext_202608_ref_sample_die_cut', 'REFERENCE', NULL, 'REF_SAMPLE_DIE_CUT', '打样：啤', 'REFERENCE', 'FIXED_AMOUNT', '90.0000', NULL, NULL, '{"craftCodes":["DIE_CUT"]}', NULL, 10, '烫金', 'A23:B23', '打样参考，未说明按款或按单。', FALSE),
    ('cpr_ext_202608_ref_sample_uv', 'REFERENCE', NULL, 'REF_SAMPLE_UV', '打样：UV', 'REFERENCE', 'FIXED_AMOUNT', '250.0000', NULL, NULL, '{"craftCodes":["UV"]}', NULL, 10, '烫金', 'A24:B24', '打样参考，未说明按款或按单。', FALSE),
    ('cpr_ext_202608_ref_sample_western_glue', 'REFERENCE', NULL, 'REF_SAMPLE_WESTERN_GLUING', '打样：西式专版粘', 'REFERENCE', 'PER_10K', '240.0000', NULL, NULL, '{"craftCodes":["GLUING"],"specifications":["大号西封"]}', NULL, 10, '烫金', 'A25:B25', '原表为240元/10000个，未说明按比例还是不足一万进位，仅供参考。', FALSE)
) AS source(
  "id",
  "categoryCode",
  "productCode",
  "code",
  "name",
  "kind",
  "calculationType",
  "amount",
  "minQty",
  "maxQty",
  "triggerCondition",
  "exclusiveGroup",
  "priority",
  "sourceSheet",
  "sourceRange",
  "note",
  "blocksAutomaticQuote"
)
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_PROCESSING_202608'
 AND book."version" = 1
JOIN "CustomerChargeCategory" AS category
  ON category."code" = source."categoryCode"::CITEXT
LEFT JOIN "Product" AS product
  ON product."code" = source."productCode"::CITEXT
ON CONFLICT ("priceBookId", "code") DO UPDATE SET
  "categoryId" = EXCLUDED."categoryId",
  "productId" = EXCLUDED."productId",
  "name" = EXCLUDED."name",
  "kind" = EXCLUDED."kind",
  "calculationType" = EXCLUDED."calculationType",
  "amount" = EXCLUDED."amount",
  "minQty" = EXCLUDED."minQty",
  "maxQty" = EXCLUDED."maxQty",
  "triggerCondition" = EXCLUDED."triggerCondition",
  "exclusiveGroup" = EXCLUDED."exclusiveGroup",
  "priority" = EXCLUDED."priority",
  "sourceSheet" = EXCLUDED."sourceSheet",
  "sourceRange" = EXCLUDED."sourceRange",
  "note" = EXCLUDED."note",
  "blocksAutomaticQuote" = EXCLUDED."blocksAutomaticQuote",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

-- A Product selection is not permission to reuse its price after the operator
-- changes specification or paper. Bind every BASE to the exact source facts;
-- blank paper cells use a visible sentinel rather than inheriting a prior row.
UPDATE "CustomerPriceRule" AS rule
SET
  "triggerCondition" = source."triggerCondition"::JSONB,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Product" AS product,
  (
    VALUES
      ('EXT-STOCK-FOIL-A04', '{"productCodes":["EXT-STOCK-FOIL-A04"],"specifications":["迷你","迷你 50×80"],"paperTypes":["120g艳闪","艳红珠光纸"]}'),
      ('EXT-STOCK-FOIL-A05', '{"productCodes":["EXT-STOCK-FOIL-A05"],"specifications":["方形","中号","88×88方形","中号80×115","88×88方形 / 中号80×115"],"paperTypes":["160g艳闪","闪红","红卡","160g艳闪 / 闪红 / 红卡","艳红珠光纸","暗红珠光纸","红卡纸"]}'),
      ('EXT-STOCK-FOIL-A06', '{"productCodes":["EXT-STOCK-FOIL-A06"],"specifications":["大号","大号90×165","西封中号80×120","大号90×165 / 西封中号80×120"],"paperTypes":["纸张未标（烫金!B6）"]}'),
      ('EXT-STOCK-FOIL-A07', '{"productCodes":["EXT-STOCK-FOIL-A07"],"specifications":["大号西封","西封大号85×165"],"paperTypes":["纸张未标（烫金!B7）"]}'),
      ('EXT-STOCK-FOIL-A08', '{"productCodes":["EXT-STOCK-FOIL-A08"],"specifications":["大号","90×165"],"paperTypes":["触感纸","200g触感纸"]}'),
      ('EXT-STOCK-FOIL-A09', '{"productCodes":["EXT-STOCK-FOIL-A09"],"specifications":["中号","80×115"],"paperTypes":["触感纸","触感纸（克重未标）"]}'),
      ('EXT-STOCK-FOIL-A10', '{"productCodes":["EXT-STOCK-FOIL-A10"],"specifications":["方形","88×88"],"paperTypes":["触感纸","触感纸（克重未标）"]}'),
      ('EXT-STOCK-FOIL-A11', '{"productCodes":["EXT-STOCK-FOIL-A11"],"specifications":["大号","大号（尺寸未标）"],"paperTypes":["160g杂色珠光纸"]}'),
      ('EXT-STOCK-FOIL-A12', '{"productCodes":["EXT-STOCK-FOIL-A12"],"specifications":["中号","中号80×115"],"paperTypes":["230g金葱","金葱纸"]}'),
      ('EXT-STOCK-FOIL-A13', '{"productCodes":["EXT-STOCK-FOIL-A13"],"specifications":["大号90×165"],"paperTypes":["纸张未标（烫金!B13）"]}'),
      ('EXT-STOCK-FOIL-A14-180-RED', '{"productCodes":["EXT-STOCK-FOIL-A14-180-RED"],"specifications":["中号","中号80×115"],"paperTypes":["180g红卡","红卡纸"]}'),
      ('EXT-STOCK-FOIL-A14-230-RED', '{"productCodes":["EXT-STOCK-FOIL-A14-230-RED"],"specifications":["中号","中号80×115"],"paperTypes":["230g红卡","红卡纸"]}'),
      ('EXT-STOCK-FOIL-A15-180-RED', '{"productCodes":["EXT-STOCK-FOIL-A15-180-RED"],"specifications":["大号","大号90×165"],"paperTypes":["180g红卡","红卡纸"]}'),
      ('EXT-STOCK-FOIL-A15-230-RED', '{"productCodes":["EXT-STOCK-FOIL-A15-230-RED"],"specifications":["大号","大号90×165"],"paperTypes":["230g红卡","红卡纸"]}'),
      ('EXT-STOCK-FOIL-A16-200-FLASH', '{"productCodes":["EXT-STOCK-FOIL-A16-200-FLASH"],"specifications":["万元封","万元封120×220"],"paperTypes":["200g艳闪","艳红珠光纸"]}'),
      ('EXT-STOCK-FOIL-A16-230-GLITTER', '{"productCodes":["EXT-STOCK-FOIL-A16-230-GLITTER"],"specifications":["万元封","万元封120×220"],"paperTypes":["230g金葱","金葱纸"]}'),
      ('EXT-CUSTOM-FOIL-MID-SQUARE', '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE"],"specifications":["中号","方形","8×11.5中号 / 方形"],"paperTypes":["160g艳闪","160g红卡","160g艳闪 / 红卡","160g杂色珠光纸","150g莱尼纹","180g红卡","230g红卡","230g金葱","200g触感","艳红珠光纸","红卡纸","莱尼纹","金葱纸","触感纸","暗红珠光纸","紫色珠光纸","黄色珠光纸","米金珠光纸","酒红","玫红","粉色"]}'),
      ('EXT-CUSTOM-FOIL-LARGE', '{"productCodes":["EXT-CUSTOM-FOIL-LARGE"],"specifications":["大号","大号西封","大号9×16.5"],"paperTypes":["160g艳闪","160g红卡","160g艳闪 / 红卡","160g杂色珠光纸","150g莱尼纹","180g红卡","230g红卡","230g金葱","200g触感","艳红珠光纸","红卡纸","莱尼纹","金葱纸","触感纸","暗红珠光纸","紫色珠光纸","黄色珠光纸","米金珠光纸","酒红","玫红","粉色"]}'),
      ('EXT-COLOR-157-COATED-LARGE', '{"productCodes":["EXT-COLOR-157-COATED-LARGE"],"specifications":["大号"],"paperTypes":["157克双铜纸","铜版纸"]}'),
      ('EXT-COLOR-200-COATED-LARGE', '{"productCodes":["EXT-COLOR-200-COATED-LARGE"],"specifications":["大号"],"paperTypes":["200克双铜纸","铜版纸"]}'),
      ('EXT-COLOR-200-COATED-MID', '{"productCodes":["EXT-COLOR-200-COATED-MID"],"specifications":["中号"],"paperTypes":["200克双铜纸","铜版纸"]}'),
      ('EXT-COLOR-160-ICE-LARGE', '{"productCodes":["EXT-COLOR-160-ICE-LARGE"],"specifications":["大号"],"paperTypes":["160克冰白纸","冰白纸"]}')
  ) AS source("productCode", "triggerCondition")
WHERE rule."priceBookId" = (
    SELECT "id"
    FROM "CustomerPriceBook"
    WHERE "code" = 'EXTERNAL_SALES_PROCESSING_202608'
      AND "version" = 1
  )
  AND rule."kind" = 'BASE'::"CustomerPriceRuleKind"
  AND rule."productId" = product."id"
  AND product."code" = source."productCode"::CITEXT;

COMMIT;
