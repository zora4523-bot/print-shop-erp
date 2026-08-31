BEGIN;

-- The create-order form reads its foil swatches exclusively from active FOIL
-- materials. Keep these business options deployable without relying on seed,
-- while preserving any inventory and cost facts already recorded for a code.
INSERT INTO "Material" (
  "id",
  "code",
  "name",
  "category",
  "specification",
  "unit",
  "displayColor",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'mat_foil_matte_gold',
    'FOIL-MATTE-GOLD'::CITEXT,
    '亚金',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #e8cd83, #b98f2c 46%, #f3e0a8 62%, #a87c1f)',
    10,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_light_gold',
    'FOIL-LIGHT-GOLD'::CITEXT,
    '浅色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #f7edcf, #dcc590 50%, #fffaf0)',
    20,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_red',
    'FOIL-RED'::CITEXT,
    '红色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #e04a52, #a8121a 55%, #f08c92)',
    30,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_black',
    'FOIL-BLACK'::CITEXT,
    '黑色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #4a4c52, #17181c 55%, #6a6c74)',
    40,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_silver',
    'FOIL-SILVER'::CITEXT,
    '银色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #e9ecef, #a8adb5 48%, #fdfdfd 64%, #8f959d)',
    50,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_blue',
    'FOIL-BLUE'::CITEXT,
    '蓝色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #5b8fd4, #1f4f96 55%, #8fb8e8)',
    60,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_clear',
    'FOIL-CLEAR'::CITEXT,
    '透明色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #f2f2f0, #dcdcd8 50%, #fbfbfa)',
    70,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'mat_foil_green',
    'FOIL-GREEN'::CITEXT,
    '绿色',
    'FOIL'::"MaterialCategory",
    NULL,
    '卷',
    'linear-gradient(140deg, #4f9c72, #1f6944 55%, #86c9a2)',
    80,
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "specification" = EXCLUDED."specification",
  "unit" = EXCLUDED."unit",
  "displayColor" = EXCLUDED."displayColor",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

-- An E2E search fixture must never appear as a selectable production SKU.
-- Deactivate only the exact known fixture and retain it for test/history links.
UPDATE "Product"
SET
  "isActive" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'CODX-E2E-PROD-001'::CITEXT
  AND "isActive" = TRUE;

COMMIT;
