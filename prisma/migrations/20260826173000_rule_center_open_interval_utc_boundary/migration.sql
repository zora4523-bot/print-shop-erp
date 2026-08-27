BEGIN;

-- The first UTC-boundary repair intentionally targeted a closed current
-- segment. Some installations have no scheduled successor, so their newly
-- cloned structured price book has an open-ended effectiveTo. Repair that
-- equivalent shape as well. The comparison below only selects a release
-- that is already current in the database session's wall clock but still in
-- the future from Prisma's UTC-wall-clock perspective; normal scheduled
-- versions are therefore left untouched.
SELECT pg_advisory_xact_lock(
  hashtext('print-shop-erp:price-rule-snapshot:v1')
);

DO $$
DECLARE
  structured_book RECORD;
  superseded_book_id TEXT;
  utc_release_at TIMESTAMP(3) := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
BEGIN
  SELECT
    book."id",
    book."effectiveFrom",
    book."notes"
  INTO structured_book
  FROM "CustomerPriceBook" book
  WHERE book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"
    AND book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"
    AND book."sourceSha256" =
      'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32'
    AND book."isActive" = TRUE
    AND book."effectiveFrom" > utc_release_at
    AND book."effectiveFrom" <= CURRENT_TIMESTAMP::TIMESTAMP
  ORDER BY book."effectiveFrom" ASC, book."version" ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  superseded_book_id := structured_book."notes" ->> 'supersedesPriceBookId';
  IF superseded_book_id IS NULL THEN
    RAISE EXCEPTION 'Structured rule release is missing supersedesPriceBookId';
  END IF;

  -- Keep the half-open validity windows adjacent at every statement boundary
  -- so the exclusion constraint cannot observe an overlap.
  UPDATE "CustomerPriceBook"
  SET
    "effectiveTo" = utc_release_at,
    "updatedAt" = utc_release_at
  WHERE "id" = superseded_book_id
    AND "effectiveTo" = structured_book."effectiveFrom";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Superseded price-book boundary no longer matches structured release';
  END IF;

  UPDATE "CustomerPriceBook"
  SET
    "effectiveFrom" = utc_release_at,
    "updatedAt" = utc_release_at
  WHERE "id" = structured_book."id";
END
$$;

COMMIT;
