BEGIN;

-- Store presentation assets on the FOIL catalog itself so create-order clients
-- do not need to infer a swatch image from a business name or hard-coded order.
ALTER TABLE "Material"
ADD COLUMN "displayImage" TEXT;

UPDATE "Material"
SET
  "displayImage" = CASE
    WHEN "code" = 'FOIL-MATTE-GOLD'::CITEXT
      THEN '/images/order/foil/matte-gold.png'
    WHEN "code" = 'FOIL-LIGHT-GOLD'::CITEXT
      THEN '/images/order/foil/light-gold.png'
    WHEN "code" = 'FOIL-RED'::CITEXT
      THEN '/images/order/foil/red.png'
    WHEN "code" = 'FOIL-BLACK'::CITEXT
      THEN '/images/order/foil/black.png'
    WHEN "code" = 'FOIL-SILVER'::CITEXT
      THEN '/images/order/foil/silver.png'
    WHEN "code" = 'FOIL-BLUE'::CITEXT
      THEN '/images/order/foil/blue.png'
    WHEN "code" = 'FOIL-GREEN'::CITEXT
      THEN '/images/order/foil/green.png'
    WHEN "code" = 'FOIL-CLEAR'::CITEXT
      THEN NULL
    ELSE "displayImage"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'FOIL'::"MaterialCategory"
  AND "code" IN (
    'FOIL-MATTE-GOLD'::CITEXT,
    'FOIL-LIGHT-GOLD'::CITEXT,
    'FOIL-RED'::CITEXT,
    'FOIL-BLACK'::CITEXT,
    'FOIL-SILVER'::CITEXT,
    'FOIL-BLUE'::CITEXT,
    'FOIL-GREEN'::CITEXT,
    'FOIL-CLEAR'::CITEXT
  );

COMMIT;
