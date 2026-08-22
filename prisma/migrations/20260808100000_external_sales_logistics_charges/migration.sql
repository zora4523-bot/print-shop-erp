BEGIN;

-- Logistics quotes and order creation share the same advisory-lock namespace as
-- processing-price quotes.  Taking the exclusive lock here makes the imported
-- workbook rules one coherent version for concurrent creators.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

LOCK TABLE
  "Order",
  "OrderShipment",
  "OrderShipmentLine",
  "CustomerPriceBook",
  "CustomerChargeCategory",
  "CustomerPriceRule",
  "User"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "CustomerPriceBookPurpose" AS ENUM (
  'PROCESSING',
  'LOGISTICS'
);

CREATE TYPE "OrderCustomerChargeStatus" AS ENUM (
  'ESTIMATED',
  'FINAL',
  'WAIVED'
);

-- Existing books are all processing books.  Purpose is part of the active
-- window so a processing book and a logistics book can coexist safely.
ALTER TABLE "CustomerPriceBook"
  DROP CONSTRAINT "CustomerPriceBook_active_settlement_window_no_overlap";

DROP INDEX "CustomerPriceBook_settlementType_isActive_effectiveFrom_idx";

ALTER TABLE "CustomerPriceBook"
  ADD COLUMN "purpose" "CustomerPriceBookPurpose" NOT NULL DEFAULT 'PROCESSING';

-- Keep the physical name aligned with Prisma's 63-byte-safe generated name.
-- Letting PostgreSQL truncate the longer spelling drops the `_idx` suffix and
-- makes `prisma migrate diff` report a perpetual rename drift.
CREATE INDEX "CustomerPriceBook_settlementType_purpose_isActive_effective_idx"
  ON "CustomerPriceBook"("settlementType", "purpose", "isActive", "effectiveFrom");

ALTER TABLE "CustomerPriceBook"
  ADD CONSTRAINT "CustomerPriceBook_active_settlement_purpose_window_no_overlap"
  EXCLUDE USING gist (
    "settlementType" WITH =,
    "purpose" WITH =,
    tsrange(
      "effectiveFrom",
      COALESCE("effectiveTo", 'infinity'::timestamp),
      '[)'
    ) WITH &&
  )
  WHERE ("isActive");

-- Keep processing-only sales metrics separate from external receivable extras.
ALTER TABLE "Order"
  ADD COLUMN "processingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "Order"
SET "processingAmount" = "totalAmount";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_receivable_amounts_valid" CHECK (
    "processingAmount" BETWEEN 0 AND 9999999999.99 AND
    "totalAmount" BETWEEN 0 AND 9999999999.99 AND
    "processingAmount" <= "totalAmount"
  );

-- Free-text addresses are retained for fulfilment, while these structured
-- fields carry only the facts needed to reproduce a carrier quote.
ALTER TABLE "OrderShipment"
  ADD COLUMN "carrierCode" VARCHAR(16),
  ADD COLUMN "destinationProvince" VARCHAR(32),
  ADD COLUMN "quotedWeightKg" DECIMAL(10,3);

-- The legacy schema explicitly allowed zero as an unfilled weight.  The new
-- customer-charge ledger requires a positive quantity, so normalize that old
-- sentinel to NULL before tightening the constraint and before backfilling.
UPDATE "OrderShipment"
SET "weightKg" = NULL
WHERE "weightKg" = 0;

ALTER TABLE "OrderShipment"
  ADD CONSTRAINT "OrderShipment_logistics_quote_values_valid" CHECK (
    ("carrierCode" IS NULL OR btrim("carrierCode") <> '') AND
    ("destinationProvince" IS NULL OR btrim("destinationProvince") <> '') AND
    ("quotedWeightKg" IS NULL OR "quotedWeightKg" > 0) AND
    ("weightKg" IS NULL OR "weightKg" > 0)
  );

-- Weight-step rules retain the original calculationType for compatibility and
-- use explicit unit columns.  Per-rule source fields are necessary because the
-- logistics book is backed by two independently hashed workbooks.
ALTER TABLE "CustomerPriceRule"
  ADD COLUMN "includedUnits" DECIMAL(10,3),
  ADD COLUMN "incrementUnits" DECIMAL(10,3),
  ADD COLUMN "incrementAmount" DECIMAL(14,4),
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceSha256" VARCHAR(64);

ALTER TABLE "CustomerPriceRule"
  ADD CONSTRAINT "CustomerPriceRule_logistics_values_valid" CHECK (
    ("includedUnits" IS NULL OR "includedUnits" > 0) AND
    ("incrementUnits" IS NULL OR "incrementUnits" > 0) AND
    ("incrementAmount" IS NULL OR "incrementAmount" BETWEEN 0 AND 9999999999.9999) AND
    (
      ("includedUnits" IS NULL AND "incrementUnits" IS NULL AND "incrementAmount" IS NULL) OR
      (
        "includedUnits" IS NOT NULL AND
        "incrementUnits" IS NOT NULL AND
        "incrementAmount" IS NOT NULL AND
        "amount" IS NOT NULL
      )
    ) AND
    ("sourceName" IS NULL OR btrim("sourceName") <> '') AND
    ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[0-9a-f]{64}$') AND
    (("sourceName" IS NULL) = ("sourceSha256" IS NULL))
  );

CREATE TABLE "OrderCustomerCharge" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "shipmentId" TEXT,
  "categoryId" TEXT NOT NULL,
  "priceBookId" TEXT,
  "sourceRuleId" TEXT,
  "businessKey" CITEXT NOT NULL,
  "status" "OrderCustomerChargeStatus" NOT NULL DEFAULT 'ESTIMATED',
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,3),
  "unit" TEXT,
  "unitPrice" DECIMAL(12,4),
  "suggestedAmount" DECIMAL(12,2),
  "amount" DECIMAL(12,2) NOT NULL,
  "pricingSnapshot" JSONB,
  "overrideReason" TEXT,
  "createdById" TEXT NOT NULL,
  "finalizedById" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderCustomerCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderCustomerCharge_values_valid" CHECK (
    btrim("businessKey"::TEXT) <> '' AND
    btrim("description") <> '' AND
    ("quantity" IS NULL OR "quantity" > 0) AND
    ("unit" IS NULL OR btrim("unit") <> '') AND
    ("unitPrice" IS NULL OR "unitPrice" BETWEEN 0 AND 99999999.9999) AND
    ("suggestedAmount" IS NULL OR "suggestedAmount" BETWEEN 0 AND 9999999999.99) AND
    "amount" BETWEEN 0 AND 9999999999.99 AND
    ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object') AND
    ("overrideReason" IS NULL OR btrim("overrideReason") <> '') AND
    ("status" <> 'WAIVED'::"OrderCustomerChargeStatus" OR "amount" = 0) AND
    (
      (
        "status" = 'ESTIMATED'::"OrderCustomerChargeStatus" AND
        "finalizedById" IS NULL AND
        "finalizedAt" IS NULL
      ) OR
      (
        "status" IN (
          'FINAL'::"OrderCustomerChargeStatus",
          'WAIVED'::"OrderCustomerChargeStatus"
        ) AND
        "finalizedById" IS NOT NULL AND
        "finalizedAt" IS NOT NULL
      )
    )
  )
);

CREATE UNIQUE INDEX "OrderCustomerCharge_orderId_businessKey_key"
  ON "OrderCustomerCharge"("orderId", "businessKey");
CREATE INDEX "OrderCustomerCharge_orderId_status_createdAt_idx"
  ON "OrderCustomerCharge"("orderId", "status", "createdAt");
CREATE INDEX "OrderCustomerCharge_shipmentId_categoryId_idx"
  ON "OrderCustomerCharge"("shipmentId", "categoryId");
CREATE INDEX "OrderCustomerCharge_priceBookId_idx"
  ON "OrderCustomerCharge"("priceBookId");
CREATE INDEX "OrderCustomerCharge_sourceRuleId_idx"
  ON "OrderCustomerCharge"("sourceRuleId");
CREATE INDEX "OrderCustomerCharge_createdById_idx"
  ON "OrderCustomerCharge"("createdById");
CREATE INDEX "OrderCustomerCharge_finalizedById_idx"
  ON "OrderCustomerCharge"("finalizedById");

ALTER TABLE "OrderCustomerCharge"
  ADD CONSTRAINT "OrderCustomerCharge_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "OrderShipment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "CustomerChargeCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "CustomerPriceBook"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_sourceRuleId_fkey"
  FOREIGN KEY ("sourceRuleId") REFERENCES "CustomerPriceRule"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderCustomerCharge_finalizedById_fkey"
  FOREIGN KEY ("finalizedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CustomerChargeCategory" (
  "id", "code", "name", "description", "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES
  (
    'ccc_shipping_fee',
    'SHIPPING_FEE',
    '对客快递费',
    '外部销售应付工厂的承运商快递费用；不得写入工厂内部成本流水。',
    80,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'ccc_packing_material',
    'PACKING_MATERIAL',
    '打包耗材费',
    '纸箱、胶带、防水袋、标签等对客打包耗材收费；与入袋人工费分开。',
    90,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CustomerPriceBook" (
  "id",
  "code",
  "name",
  "settlementType",
  "purpose",
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
  'cpb_external_sales_logistics_202608_v1',
  'EXTERNAL_SALES_LOGISTICS_202608',
  '外部销售快递与打包耗材价目簿（2026-08）',
  'EXTERNAL_SALES',
  'LOGISTICS',
  1,
  'CNY',
  '长昆中通报价表(1).xlsx + 纸箱价格表1(1).xlsx',
  '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
  TIMESTAMP '2026-08-01 00:00:00',
  NULL,
  TRUE,
  jsonb_build_object(
    'summary', '中通按独立运单计费；纸箱金额作为每个收货地址/运单数量的非强制建议。',
    'sources', jsonb_build_array(
      jsonb_build_object(
        'fileName', '长昆中通报价表(1).xlsx',
        'sha256', 'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
        'sheet', '中通',
        'range', 'A1:D29'
      ),
      jsonb_build_object(
        'fileName', '纸箱价格表1(1).xlsx',
        'sha256', '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
        'sheet', 'Sheet1',
        'range', 'A1:B6'
      )
    ),
    'warnings', jsonb_build_array(
      '中通报价表未说明原始重量如何进位；系统只接受承运商已进位的计费重量，普通地区按整公斤、偏远地区按半公斤档位。',
      '每个收货地址在当前模型中视为一票运单，分别起算首重；同一地址多包裹时请拆成多条发货记录。',
      '纸箱表未说明按工单、款式、地址或箱数收费；系统仅按每票分配数量给出建议，销售可调整并必须说明原因。',
      '纸箱表没有 5000 个以上规则，超过后必须人工填写。',
      '港澳台、海外、缺失省份及其他承运商不自动套用中通价格。'
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code", "version") DO UPDATE SET
  "name" = EXCLUDED."name",
  "settlementType" = EXCLUDED."settlementType",
  "purpose" = EXCLUDED."purpose",
  "currency" = EXCLUDED."currency",
  "sourceName" = EXCLUDED."sourceName",
  "sourceSha256" = EXCLUDED."sourceSha256",
  "effectiveFrom" = EXCLUDED."effectiveFrom",
  "effectiveTo" = EXCLUDED."effectiveTo",
  "isActive" = EXCLUDED."isActive",
  "notes" = EXCLUDED."notes",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Six province groups reproduce the exact merged-cell interpretation in the
-- audited 中通 sheet.  `amount` is first-weight fee; the three explicit unit
-- columns reproduce continuation increments without guessing raw-weight rounding.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name", "kind",
  "calculationType", "amount", "includedUnits", "incrementUnits", "incrementAmount",
  "minQty", "maxQty", "triggerCondition", "exclusiveGroup", "priority",
  "sourceSheet", "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  source."id",
  book."id",
  category."id",
  NULL,
  source."code"::CITEXT,
  source."name",
  'ADD_ON'::"CustomerPriceRuleKind",
  'FIXED_AMOUNT'::"CustomerPriceCalculationType",
  source."firstAmount"::DECIMAL(14,4),
  1.000,
  source."incrementUnits"::DECIMAL(10,3),
  source."incrementAmount"::DECIMAL(14,4),
  NULL,
  NULL,
  source."condition"::JSONB,
  'ZTO_PROVINCE_RATE',
  100,
  '中通',
  source."sourceRange",
  '长昆中通报价表(1).xlsx',
  'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
  '输入必须是承运商已进位的计费重量；不从原始重量自行取整。',
  FALSE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    (
      'cpr_logistics_zto_guangdong',
      'ZTO_GUANGDONG',
      '中通 · 广东',
      2.8000,
      1.000,
      1.5000,
      '{"carrierCode":"ZTO","provinces":["广东"]}',
      'A3:D3'
    ),
    (
      'cpr_logistics_zto_group_2_8',
      'ZTO_STANDARD_2_8',
      '中通 · 续重 2.8 元地区',
      2.8000,
      1.000,
      2.8000,
      '{"carrierCode":"ZTO","provinces":["江西","江苏","安徽","湖南","湖北","广西","浙江","福建"]}',
      'A4:D11'
    ),
    (
      'cpr_logistics_zto_group_3_5',
      'ZTO_STANDARD_3_5',
      '中通 · 续重 3.5 元地区',
      2.8000,
      1.000,
      3.5000,
      '{"carrierCode":"ZTO","provinces":["天津","上海","北京","河南","河北","四川","重庆","贵州","山东"]}',
      'A12:D20'
    ),
    (
      'cpr_logistics_zto_group_4_5',
      'ZTO_STANDARD_4_5',
      '中通 · 续重 4.5 元地区',
      2.8000,
      1.000,
      4.5000,
      '{"carrierCode":"ZTO","provinces":["云南","山西","陕西","黑龙江","吉林","辽宁","海南"]}',
      'A21:D27'
    ),
    (
      'cpr_logistics_zto_xinjiang_tibet',
      'ZTO_REMOTE_FIRST_12',
      '中通 · 新疆/西藏',
      12.0000,
      0.500,
      5.3000,
      '{"carrierCode":"ZTO","provinces":["新疆","西藏"]}',
      'A28:D28'
    ),
    (
      'cpr_logistics_zto_northwest',
      'ZTO_REMOTE_FIRST_10',
      '中通 · 甘青宁内蒙古',
      10.0000,
      0.500,
      5.3000,
      '{"carrierCode":"ZTO","provinces":["甘肃","青海","宁夏","内蒙古"]}',
      'A29:D29'
    )
) AS source(
  "id", "code", "name", "firstAmount", "incrementUnits", "incrementAmount", "condition", "sourceRange"
)
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_LOGISTICS_202608'
 AND book."version" = 1
JOIN "CustomerChargeCategory" AS category
  ON category."code" = 'SHIPPING_FEE'
ON CONFLICT ("priceBookId", "code") DO UPDATE SET
  "categoryId" = EXCLUDED."categoryId",
  "name" = EXCLUDED."name",
  "kind" = EXCLUDED."kind",
  "calculationType" = EXCLUDED."calculationType",
  "amount" = EXCLUDED."amount",
  "includedUnits" = EXCLUDED."includedUnits",
  "incrementUnits" = EXCLUDED."incrementUnits",
  "incrementAmount" = EXCLUDED."incrementAmount",
  "triggerCondition" = EXCLUDED."triggerCondition",
  "exclusiveGroup" = EXCLUDED."exclusiveGroup",
  "priority" = EXCLUDED."priority",
  "sourceSheet" = EXCLUDED."sourceSheet",
  "sourceRange" = EXCLUDED."sourceRange",
  "sourceName" = EXCLUDED."sourceName",
  "sourceSha256" = EXCLUDED."sourceSha256",
  "note" = EXCLUDED."note",
  "blocksAutomaticQuote" = EXCLUDED."blocksAutomaticQuote",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;

-- The workbook does not state the charging grain.  These five rows are kept as
-- explicit REFERENCE rules: the UI may suggest them per shipment quantity, but
-- the operator remains responsible for accepting or overriding the amount.
INSERT INTO "CustomerPriceRule" (
  "id", "priceBookId", "categoryId", "productId", "code", "name", "kind",
  "calculationType", "amount", "includedUnits", "incrementUnits", "incrementAmount",
  "minQty", "maxQty", "triggerCondition", "exclusiveGroup", "priority",
  "sourceSheet", "sourceRange", "sourceName", "sourceSha256", "note",
  "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
)
SELECT
  source."id",
  book."id",
  category."id",
  NULL,
  source."code"::CITEXT,
  source."name",
  'REFERENCE'::"CustomerPriceRuleKind",
  'FIXED_AMOUNT'::"CustomerPriceCalculationType",
  source."amount"::DECIMAL(14,4),
  NULL,
  NULL,
  NULL,
  source."minQty",
  source."maxQty",
  '{"scope":"SHIPMENT_QUANTITY","advisory":true}'::JSONB,
  'PACKING_MATERIAL_QUANTITY_TIER',
  100,
  'Sheet1',
  source."sourceRange",
  '纸箱价格表1(1).xlsx',
  '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
  '原表未说明按工单、款式、地址或箱数计费；这里只按每票分配数量给出非强制建议。',
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('cpr_logistics_carton_q1_500', 'CARTON_Q1_500', '打包耗材 1–500 个参考', 1.0000, 1, 500, 'A2:B2'),
    ('cpr_logistics_carton_q501_1000', 'CARTON_Q501_1000', '打包耗材 501–1000 个参考', 3.0000, 501, 1000, 'A3:B3'),
    ('cpr_logistics_carton_q1001_2000', 'CARTON_Q1001_2000', '打包耗材 1001–2000 个参考', 5.0000, 1001, 2000, 'A4:B4'),
    ('cpr_logistics_carton_q2001_3000', 'CARTON_Q2001_3000', '打包耗材 2001–3000 个参考', 7.0000, 2001, 3000, 'A5:B5'),
    ('cpr_logistics_carton_q3001_5000', 'CARTON_Q3001_5000', '打包耗材 3001–5000 个参考', 8.0000, 3001, 5000, 'A6:B6')
) AS source("id", "code", "name", "amount", "minQty", "maxQty", "sourceRange")
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_LOGISTICS_202608'
 AND book."version" = 1
JOIN "CustomerChargeCategory" AS category
  ON category."code" = 'PACKING_MATERIAL'
ON CONFLICT ("priceBookId", "code") DO UPDATE SET
  "categoryId" = EXCLUDED."categoryId",
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
  "sourceName" = EXCLUDED."sourceName",
  "sourceSha256" = EXCLUDED."sourceSha256",
  "note" = EXCLUDED."note",
  "blocksAutomaticQuote" = EXCLUDED."blocksAutomaticQuote",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Do not rewrite historical receivables.  Legacy external-sales orders had no
-- structured logistics charges, so zero-value rows preserve their existing
-- total and make the missing evidence explicit.  Open orders are ESTIMATED and
-- will be finalized at shipment; already terminal/shipped rows are frozen at
-- the historical zero rather than inventing a charge after the fact.
INSERT INTO "OrderCustomerCharge" (
  "id", "orderId", "shipmentId", "categoryId", "priceBookId", "sourceRuleId",
  "businessKey", "status", "description", "quantity", "unit", "unitPrice",
  "suggestedAmount", "amount", "pricingSnapshot", "overrideReason",
  "createdById", "finalizedById", "finalizedAt", "createdAt", "updatedAt"
)
SELECT
  'occ_legacy_shipping_' || shipment."id",
  shipment."orderId",
  shipment."id",
  category."id",
  book."id",
  NULL,
  ('SHIPMENT:' || shipment."sequence" || ':SHIPPING_FEE')::CITEXT,
  CASE
    WHEN source_order."isSfCollect" THEN 'WAIVED'::"OrderCustomerChargeStatus"
    WHEN source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN 'FINAL'::"OrderCustomerChargeStatus"
    ELSE 'ESTIMATED'::"OrderCustomerChargeStatus"
  END,
  CASE
    WHEN source_order."isSfCollect" THEN '顺丰到付（历史工单）'
    ELSE '历史工单快递费待确认'
  END,
  shipment."weightKg",
  CASE WHEN shipment."weightKg" IS NULL THEN NULL ELSE 'kg' END,
  NULL,
  NULL,
  0,
  jsonb_build_object(
    'version', 1,
    'legacyBackfill', TRUE,
    'reason', '该工单早于结构化对客快递/耗材收费功能，未从地址或重量臆测费用。'
  ),
  '历史工单上线前未记录对客快递费，保留原工单总额',
  source_order."createdById",
  CASE
    WHEN source_order."isSfCollect" OR source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN source_order."createdById"
    ELSE NULL
  END,
  CASE
    WHEN source_order."isSfCollect" OR source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN COALESCE(source_order."shippedAt", source_order."finishedAt", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  shipment."createdAt",
  CURRENT_TIMESTAMP
FROM "OrderShipment" AS shipment
JOIN "Order" AS source_order
  ON source_order."id" = shipment."orderId"
 AND source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
JOIN "CustomerChargeCategory" AS category
  ON category."code" = 'SHIPPING_FEE'
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_LOGISTICS_202608'
 AND book."version" = 1
ON CONFLICT ("orderId", "businessKey") DO NOTHING;

INSERT INTO "OrderCustomerCharge" (
  "id", "orderId", "shipmentId", "categoryId", "priceBookId", "sourceRuleId",
  "businessKey", "status", "description", "quantity", "unit", "unitPrice",
  "suggestedAmount", "amount", "pricingSnapshot", "overrideReason",
  "createdById", "finalizedById", "finalizedAt", "createdAt", "updatedAt"
)
SELECT
  'occ_legacy_packing_' || shipment."id",
  shipment."orderId",
  shipment."id",
  category."id",
  book."id",
  NULL,
  ('SHIPMENT:' || shipment."sequence" || ':PACKING_MATERIAL')::CITEXT,
  CASE
    WHEN source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN 'FINAL'::"OrderCustomerChargeStatus"
    ELSE 'ESTIMATED'::"OrderCustomerChargeStatus"
  END,
  '历史工单打包耗材费待确认',
  allocation."itemQuantity",
  CASE WHEN allocation."itemQuantity" IS NULL THEN NULL ELSE '个' END,
  NULL,
  NULL,
  0,
  jsonb_build_object(
    'version', 1,
    'legacyBackfill', TRUE,
    'reason', '该工单早于结构化对客快递/耗材收费功能，未从数量臆测纸箱计费粒度。'
  ),
  '历史工单上线前未记录打包耗材费，保留原工单总额',
  source_order."createdById",
  CASE
    WHEN source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN source_order."createdById"
    ELSE NULL
  END,
  CASE
    WHEN source_order."status" IN ('SHIPPED', 'FINISHED', 'CANCELLED')
      THEN COALESCE(source_order."shippedAt", source_order."finishedAt", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  shipment."createdAt",
  CURRENT_TIMESTAMP
FROM "OrderShipment" AS shipment
JOIN "Order" AS source_order
  ON source_order."id" = shipment."orderId"
 AND source_order."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN COUNT(*) > 0
      AND bool_and(line."quantity" > 0)
      AND SUM(line."quantity") <= 999999999
      THEN SUM(line."quantity")::DECIMAL(12,3)
    ELSE NULL
  END AS "itemQuantity"
  FROM "OrderShipmentLine" AS line
  WHERE line."shipmentId" = shipment."id"
) AS allocation ON TRUE
JOIN "CustomerChargeCategory" AS category
  ON category."code" = 'PACKING_MATERIAL'
JOIN "CustomerPriceBook" AS book
  ON book."code" = 'EXTERNAL_SALES_LOGISTICS_202608'
 AND book."version" = 1
ON CONFLICT ("orderId", "businessKey") DO NOTHING;

COMMIT;
