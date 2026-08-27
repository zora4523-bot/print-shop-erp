BEGIN;

-- Order facts and the current published rule contract still match paper by
-- its normalized display name.  Until paper IDs/codes become the persisted
-- rule key, prevent two active master-data rows from collapsing into the same
-- order option and producing an ambiguous quote.
DO $$
DECLARE
  duplicate_names TEXT;
BEGIN
  SELECT string_agg(duplicate.name, ', ' ORDER BY duplicate.name)
  INTO duplicate_names
  FROM (
    SELECT lower(btrim("name")) AS name
    FROM "Material"
    WHERE "category" = 'PAPER'::"MaterialCategory"
      AND "isActive" = TRUE
    GROUP BY lower(btrim("name"))
    HAVING COUNT(*) > 1
  ) duplicate;

  IF duplicate_names IS NOT NULL THEN
    RAISE EXCEPTION
      'Active paper names must be unique before rule-centre release: %',
      duplicate_names;
  END IF;
END
$$;

CREATE UNIQUE INDEX "Material_active_paper_name_unique"
  ON "Material" (lower(btrim("name")))
  WHERE "category" = 'PAPER'::"MaterialCategory"
    AND "isActive" = TRUE;

COMMIT;
