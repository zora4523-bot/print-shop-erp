BEGIN;

-- No photo was supplied for transparent foil. Use an explicit transparency
-- pattern instead of the retired generic grey gradient, while keeping the
-- presentation choice in the FOIL catalog rather than in the form component.
UPDATE "Material"
SET
  "displayColor" = 'conic-gradient(#d9dcdf 25%, #f7f7f5 0 50%, #d9dcdf 0 75%, #f7f7f5 0) 0 0 / 10px 10px',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'FOIL'::"MaterialCategory"
  AND "code" = 'FOIL-CLEAR'::CITEXT;

COMMIT;
