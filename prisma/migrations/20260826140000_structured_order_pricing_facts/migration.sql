BEGIN;

-- A style has exactly one base pricing route. Existing rows are preserved as
-- MANUAL_QUOTE because their legacy free-text facts cannot prove another route.
CREATE TYPE "OrderItemPricingRoute" AS ENUM (
  'STOCK_BLANK',
  'CUSTOM_SINGLE_FLAT_FOIL',
  'COLOR_PRINT',
  'MANUAL_QUOTE'
);

CREATE TYPE "OrderProductStructure" AS ENUM (
  'UNSPECIFIED',
  'STANDARD_ENVELOPE',
  'WESTERN_ENVELOPE',
  'TEN_THOUSAND_ENVELOPE'
);

CREATE TYPE "OrderFoilTechnique" AS ENUM (
  'UNSPECIFIED',
  'NONE',
  'FLAT',
  'RELIEF',
  'RAISED'
);
CREATE TYPE "OrderPackagingMode" AS ENUM ('SINGLE_STYLE', 'MIXED_STYLE');

ALTER TABLE "OrderItem"
  ADD COLUMN "pricingRoute" "OrderItemPricingRoute" NOT NULL DEFAULT 'MANUAL_QUOTE',
  ADD COLUMN "productStructure" "OrderProductStructure" NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN "artworkVersion" TEXT,
  ADD COLUMN "plateGroupId" TEXT,
  ADD COLUMN "pricingGroup" TEXT,
  ADD COLUMN "manualQuoteReason" TEXT,
  ADD COLUMN "actualWidthMm" DECIMAL(8, 2),
  ADD COLUMN "actualHeightMm" DECIMAL(8, 2),
  ADD COLUMN "paperWeightGsm" INTEGER,
  ADD COLUMN "foilTechnique" "OrderFoilTechnique" NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN "hasLocalFoil" BOOLEAN,
  ADD COLUMN "printColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "printColorsKnown" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrderItem"
  ALTER COLUMN "pricingRoute" DROP DEFAULT,
  ALTER COLUMN "productStructure" DROP DEFAULT,
  ALTER COLUMN "foilTechnique" DROP DEFAULT;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_actual_size_pair_check"
    CHECK (("actualWidthMm" IS NULL) = ("actualHeightMm" IS NULL)),
  ADD CONSTRAINT "OrderItem_actual_width_positive_check"
    CHECK ("actualWidthMm" IS NULL OR "actualWidthMm" > 0),
  ADD CONSTRAINT "OrderItem_actual_height_positive_check"
    CHECK ("actualHeightMm" IS NULL OR "actualHeightMm" > 0),
  ADD CONSTRAINT "OrderItem_paper_weight_positive_check"
    CHECK ("paperWeightGsm" IS NULL OR "paperWeightGsm" > 0);

CREATE TABLE "OrderPackagingGroup" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT,
  "mode" "OrderPackagingMode" NOT NULL,
  "actualBagCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderPackagingGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPackagingGroup_actual_bag_count_positive_check"
    CHECK ("actualBagCount" > 0)
);

CREATE TABLE "OrderPackagingGroupLine" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "packagingGroupId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "unitsPerBag" INTEGER NOT NULL,

  CONSTRAINT "OrderPackagingGroupLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPackagingGroupLine_units_per_bag_positive_check"
    CHECK ("unitsPerBag" > 0)
);

CREATE UNIQUE INDEX "OrderPackagingGroup_orderId_sequence_key"
  ON "OrderPackagingGroup"("orderId", "sequence");
CREATE UNIQUE INDEX "OrderPackagingGroup_orderId_id_key"
  ON "OrderPackagingGroup"("orderId", "id");
CREATE INDEX "OrderPackagingGroup_orderId_idx"
  ON "OrderPackagingGroup"("orderId");
CREATE UNIQUE INDEX "OrderItem_orderId_id_key"
  ON "OrderItem"("orderId", "id");
CREATE UNIQUE INDEX "OrderItem_orderId_sequence_key"
  ON "OrderItem"("orderId", "sequence");
CREATE UNIQUE INDEX "OrderPackagingGroupLine_packagingGroupId_orderItemId_key"
  ON "OrderPackagingGroupLine"("packagingGroupId", "orderItemId");
CREATE INDEX "OrderPackagingGroupLine_orderItemId_idx"
  ON "OrderPackagingGroupLine"("orderItemId");

ALTER TABLE "OrderPackagingGroup"
  ADD CONSTRAINT "OrderPackagingGroup_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderPackagingGroupLine"
  ADD CONSTRAINT "OrderPackagingGroupLine_packagingGroupId_fkey"
  FOREIGN KEY ("orderId", "packagingGroupId") REFERENCES "OrderPackagingGroup"("orderId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderPackagingGroupLine"
  ADD CONSTRAINT "OrderPackagingGroupLine_orderItemId_fkey"
  FOREIGN KEY ("orderId", "orderItemId") REFERENCES "OrderItem"("orderId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A deferred trigger validates the row-count meaning of SINGLE_STYLE/MIXED_STYLE
-- after the whole nested create has finished, while the composite foreign keys
-- above guarantee that a group cannot contain a style from another order.
CREATE OR REPLACE FUNCTION "check_order_packaging_group_mode"()
RETURNS TRIGGER AS $$
DECLARE
  target_group_id TEXT;
  target_order_id TEXT;
  target_mode "OrderPackagingMode";
  positive_line_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'OrderPackagingGroup' THEN
    target_group_id := COALESCE(NEW."id", OLD."id");
    target_order_id := COALESCE(NEW."orderId", OLD."orderId");
  ELSE
    target_group_id := COALESCE(NEW."packagingGroupId", OLD."packagingGroupId");
    target_order_id := COALESCE(NEW."orderId", OLD."orderId");
  END IF;

  SELECT g."mode", COUNT(l."id")::INTEGER
    INTO target_mode, positive_line_count
  FROM "OrderPackagingGroup" g
  LEFT JOIN "OrderPackagingGroupLine" l
    ON l."orderId" = g."orderId"
   AND l."packagingGroupId" = g."id"
   AND l."unitsPerBag" > 0
  WHERE g."id" = target_group_id AND g."orderId" = target_order_id
  GROUP BY g."mode";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF target_mode = 'SINGLE_STYLE' AND positive_line_count <> 1 THEN
    RAISE EXCEPTION 'SINGLE_STYLE packaging group must contain exactly one style';
  END IF;
  IF target_mode = 'MIXED_STYLE' AND positive_line_count < 2 THEN
    RAISE EXCEPTION 'MIXED_STYLE packaging group must contain at least two styles';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "OrderPackagingGroup_mode_lines_check"
AFTER INSERT OR UPDATE OF "mode" ON "OrderPackagingGroup"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_order_packaging_group_mode"();

CREATE CONSTRAINT TRIGGER "OrderPackagingGroupLine_mode_lines_check"
AFTER INSERT OR UPDATE OR DELETE ON "OrderPackagingGroupLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_order_packaging_group_mode"();

COMMIT;
