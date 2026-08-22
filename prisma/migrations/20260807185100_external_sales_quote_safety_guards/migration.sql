BEGIN;

-- Keep price-book writes coherent with application quotes and fail closed if
-- this guard migration is ever replayed against a different workbook import.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "CustomerPriceBook",
  "CustomerChargeCategory",
  "CustomerPriceRule"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "CustomerPriceBook"
    WHERE "code" = 'EXTERNAL_SALES_PROCESSING_202608'
      AND "version" = 1
      AND "settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
      AND "sourceSha256" = '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733'
  ) THEN
    RAISE EXCEPTION
      'External-sales quote safety migration requires the audited 2026-08 workbook price book';
  END IF;
END
$$;

-- Warnings belong to a price-book version.  Keeping them as structured JSON
-- prevents a future workbook from inheriting this version's six static notes.
ALTER TABLE "CustomerPriceBook"
  ALTER COLUMN "notes" TYPE JSONB
  USING CASE
    WHEN "notes" IS NULL THEN NULL
    ELSE jsonb_build_object('summary', "notes")
  END;

UPDATE "CustomerPriceBook"
SET
  "notes" = jsonb_build_object(
    'summary', '仅录入工作簿中有明确产品、数量锚点和金额的规则。非锚点、重叠边界、缺口和未标规格行不推断价格。',
    'warnings', jsonb_build_array(
      '专版单色平烫只在报价单明确列出的数量锚点自动报价；非锚点数量不插值、不自动套前后档。',
      '彩印第 10 行缺少规格标签，未猜测为中号；该行只能人工确认后报价。',
      '彩印 7001–7999 个没有覆盖，15000 个同时落入两条不同口径，均要求人工报价。',
      '机仔烫金在 1000 个处“以下/以上”重叠，万元封 60 元是否叠加也未写清，暂不自动计算。',
      '入袋单款 0.10 元与两款起混装 0.20 元是否为替代价未写明，暂作为人工参考。',
      '打样费未说明按款还是按单，制版费、快递费等排除项不会被系统臆加。'
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'EXTERNAL_SALES_PROCESSING_202608'
  AND "version" = 1;

-- "现货加烫" is the current order-form name for the same ambiguous machine
-- foil charge described at 烫金!E12:O12.  It must not bypass the existing
-- manual-pricing guard merely because its craft code differs from 局部烫金.
UPDATE "CustomerPriceRule"
SET
  "triggerCondition" = '{"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"]}'::JSONB,
  "note" = '1千以下单面40/双面80；1千以上单面0.04/双面0.08；1000边界重叠，万元封局部60且上机专版另算。局部烫金与现货加烫均禁止自动计价。',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "priceBookId" = (
    SELECT "id"
    FROM "CustomerPriceBook"
    WHERE "code" = 'EXTERNAL_SALES_PROCESSING_202608'
      AND "version" = 1
  )
  AND "code" = 'REF_MACHINE_FOIL_AMBIGUOUS';

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
  NULL,
  source."code"::CITEXT,
  source."name",
  'REFERENCE'::"CustomerPriceRuleKind",
  NULL,
  NULL,
  source."minQty",
  source."maxQty",
  source."triggerCondition"::JSONB,
  NULL,
  200,
  source."sourceSheet",
  source."sourceRange",
  source."note",
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    (
      'cpr_ext_202608_guard_color_single_foil_low_qty',
      'FOIL_SURCHARGE',
      'GUARD_COLOR_SINGLE_FOIL_LOW_QTY',
      '彩印单色烫金 500 个以下未定价',
      1,
      499,
      '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1}',
      '彩印',
      'C3:N14',
      '原表给出 100–400 个彩印基础价，但单色烫金附加费只从 500 个开始；不得把低数量彩印+烫金漏算为纯彩印。'
    ),
    (
      'cpr_ext_202608_guard_custom_missing_foil_color',
      'COLOR_SURCHARGE',
      'GUARD_CUSTOM_FOIL_COLOR_REQUIRED',
      '专版平烫必须选择实际烫金色',
      NULL,
      NULL,
      '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"foilColorCount":0}',
      '烫金',
      'E3:O7',
      '专版平烫基础价按单色口径给出；未选择实际烫金色时禁止自动报价。'
    ),
    (
      'cpr_ext_202608_guard_coated_process_required',
      'REFERENCE',
      'GUARD_COATED_COLOR_PRINT_PROCESS_REQUIRED',
      '铜版纸彩印产品必须选择对应彩印工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID"],"noneOfCraftCodes":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL"]}',
      '彩印',
      'A3:N14',
      '产品基础价包含铜版纸彩印；若没有选择铜版纸纯彩印或铜版纸彩印+烫金，产品与工艺事实不一致。'
    ),
    (
      'cpr_ext_202608_guard_ice_process_required',
      'REFERENCE',
      'GUARD_ICE_COLOR_PRINT_PROCESS_REQUIRED',
      '冰白纸彩印产品必须选择对应彩印工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-COLOR-160-ICE-LARGE"],"noneOfCraftCodes":["COLOR_PRINT","COLOR_PRINT_FOIL"]}',
      '彩印',
      'A9:N14',
      '产品基础价包含冰白纸彩印；若没有选择冰白彩印纯印刷或冰白彩印+烫金，产品与工艺事实不一致。'
    ),
    (
      'cpr_ext_202608_guard_coated_unsupported_craft',
      'REFERENCE',
      'GUARD_COATED_UNSUPPORTED_CRAFT',
      '铜版纸彩印包含未定价工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID"],"anyCraftCodeOutside":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL","DIE_CUT","GLUING","EMBOSS","BUMP","PACKING"]}',
      '彩印',
      'A14:N14',
      '原表仅明确包含纸、印刷、标准刀模和啤粘成品；UV、跨纸种彩印及其他未列工艺必须人工询价。'
    ),
    (
      'cpr_ext_202608_guard_ice_unsupported_craft',
      'REFERENCE',
      'GUARD_ICE_UNSUPPORTED_CRAFT',
      '冰白纸彩印包含未定价工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-COLOR-160-ICE-LARGE"],"anyCraftCodeOutside":["COLOR_PRINT","COLOR_PRINT_FOIL","DIE_CUT","GLUING","EMBOSS","BUMP","PACKING"]}',
      '彩印',
      'A14:N14',
      '原表仅明确包含纸、印刷、标准刀模和啤粘成品；UV、跨纸种彩印及其他未列工艺必须人工询价。'
    ),
    (
      'cpr_ext_202608_guard_custom_process_required',
      'REFERENCE',
      'GUARD_CUSTOM_FLAT_FOIL_PROCESS_REQUIRED',
      '专版平烫产品必须选择平烫工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"noneOfCraftCodes":["FLAT_FOIL_SINGLE","FLAT_FOIL_DOUBLE","FLAT_FOIL_TRIPLE","FLAT_FOIL_PARTIAL"]}',
      '烫金',
      'E3:O13',
      '专版平烫产品必须包含平烫生产事实；仅选择其他工艺时不得套用专版平烫基础价。'
    ),
    (
      'cpr_ext_202608_guard_custom_unsupported_craft',
      'REFERENCE',
      'GUARD_CUSTOM_UNSUPPORTED_CRAFT',
      '专版平烫包含未定价工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"anyCraftCodeOutside":["FLAT_FOIL_SINGLE","FLAT_FOIL_DOUBLE","FLAT_FOIL_TRIPLE","FLAT_FOIL_PARTIAL","EMBOSS","BUMP","DIE_CUT","GLUING","PACKING"]}',
      '烫金',
      'E3:O13',
      '原表未给 UV、彩印、现货加烫、清废等工艺在专版平烫产品上的收费，命中时必须人工确认。'
    ),
    (
      'cpr_ext_202608_guard_stock_unsupported_craft',
      'REFERENCE',
      'GUARD_STOCK_UNSUPPORTED_CRAFT',
      '空封现货包含未定价工艺',
      NULL,
      NULL,
      '{"productCodes":["EXT-STOCK-FOIL-A04","EXT-STOCK-FOIL-A05","EXT-STOCK-FOIL-A06","EXT-STOCK-FOIL-A07","EXT-STOCK-FOIL-A08","EXT-STOCK-FOIL-A09","EXT-STOCK-FOIL-A10","EXT-STOCK-FOIL-A11","EXT-STOCK-FOIL-A12","EXT-STOCK-FOIL-A13","EXT-STOCK-FOIL-A14-180-RED","EXT-STOCK-FOIL-A14-230-RED","EXT-STOCK-FOIL-A15-180-RED","EXT-STOCK-FOIL-A15-230-RED","EXT-STOCK-FOIL-A16-200-FLASH","EXT-STOCK-FOIL-A16-230-GLITTER"],"anyCraftCodeOutside":["STOCK_FOIL","FLAT_FOIL_PARTIAL","PACKING"]}',
      '烫金',
      'A4:O16',
      '现货行只明确空封基础价；除现货加烫、局部烫金和包装参考外的工艺没有对外收费口径。'
    ),
    (
      'cpr_ext_202608_guard_pure_color_has_foil',
      'COLOR_SURCHARGE',
      'GUARD_PURE_COLOR_PRINT_HAS_FOIL_COLOR',
      '纯彩印不能同时填写烫金色',
      NULL,
      NULL,
      '{"productCodes":["EXT-COLOR-157-COATED-LARGE","EXT-COLOR-200-COATED-LARGE","EXT-COLOR-200-COATED-MID","EXT-COLOR-160-ICE-LARGE"],"craftCodes":["COATED_COLOR_PRINT","COLOR_PRINT"],"minFoilColorCount":1}',
      '彩印',
      'A3:N14',
      '纯彩印应选择“无颜色”；填写实际烫金色说明工艺事实冲突，禁止按纯彩印漏收烫金费。'
    )
) AS source(
  "id",
  "categoryCode",
  "code",
  "name",
  "minQty",
  "maxQty",
  "triggerCondition",
  "sourceSheet",
  "sourceRange",
  "note"
)
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_PROCESSING_202608'
 AND book."version" = 1
JOIN "CustomerChargeCategory" AS category
  ON category."code" = source."categoryCode"::CITEXT
ON CONFLICT ("priceBookId", "code") DO UPDATE SET
  "categoryId" = EXCLUDED."categoryId",
  "productId" = NULL,
  "name" = EXCLUDED."name",
  "kind" = EXCLUDED."kind",
  "calculationType" = NULL,
  "amount" = NULL,
  "minQty" = EXCLUDED."minQty",
  "maxQty" = EXCLUDED."maxQty",
  "triggerCondition" = EXCLUDED."triggerCondition",
  "exclusiveGroup" = NULL,
  "priority" = EXCLUDED."priority",
  "sourceSheet" = EXCLUDED."sourceSheet",
  "sourceRange" = EXCLUDED."sourceRange",
  "note" = EXCLUDED."note",
  "blocksAutomaticQuote" = TRUE,
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
