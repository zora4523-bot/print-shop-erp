BEGIN;

CREATE TYPE "OrderLamination" AS ENUM (
  'NONE',
  'MATTE',
  'SOFT_TOUCH',
  'NEW_GLOSS',
  'LASER'
);

-- Historical and non-color-print rows are explicitly unlaminated. Keeping a
-- database default makes legacy writers safe while the check constraint
-- prevents a non-color route from persisting a contradictory lamination fact.
ALTER TABLE "OrderItem"
  ADD COLUMN "lamination" "OrderLamination" NOT NULL DEFAULT 'NONE',
  ADD CONSTRAINT "OrderItem_lamination_pricing_route_check" CHECK (
    "pricingRoute" = 'COLOR_PRINT'::"OrderItemPricingRoute" OR
    "lamination" = 'NONE'::"OrderLamination"
  );

COMMIT;
