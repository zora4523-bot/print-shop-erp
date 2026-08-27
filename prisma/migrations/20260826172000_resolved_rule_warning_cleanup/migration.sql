BEGIN;

-- The current structured version resolved the local-foil boundary and the
-- single/mixed bag rates.  Remove only those superseded warnings from cloned
-- books; unresolved workbook gaps remain visible to administrators.
UPDATE "CustomerPriceBook" book
SET
  "notes" = jsonb_set(
    COALESCE(book."notes", '{}'::JSONB),
    '{warnings}',
    COALESCE(
      (
        SELECT jsonb_agg(warning)
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(book."notes" -> 'warnings') = 'array'
              THEN book."notes" -> 'warnings'
            ELSE '[]'::JSONB
          END
        ) warning
        WHERE warning #>> '{}' NOT LIKE '%机仔烫金%'
          AND warning #>> '{}' NOT LIKE '%入袋单款%'
      ),
      '[]'::JSONB
    ),
    TRUE
  ),
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
WHERE book."sourceSha256" =
  'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32';

COMMIT;
