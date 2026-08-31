BEGIN;

-- Prisma Date values are compared against timestamp-without-time-zone columns
-- as UTC wall-clock values.  The preceding release migration used PostgreSQL's
-- Asia/Shanghai CURRENT_TIMESTAMP wall clock.  Move only that newly-created
-- release boundary to the UTC wall clock so the new rule version is effective
-- immediately in the application, while leaving scheduled business times and
-- every price/rule row unchanged.
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
    AND book."sourceSha256" = 'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32'
    AND book."isActive" = TRUE
    AND book."effectiveFrom" <= CURRENT_TIMESTAMP::TIMESTAMP
    AND book."effectiveTo" IS NOT NULL
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

  -- Shorten the superseded half-open window first, then move the replacement
  -- start to the identical instant.  The exclusion constraint stays valid at
  -- every statement boundary.
  UPDATE "CustomerPriceBook"
  SET
    "effectiveTo" = utc_release_at,
    "updatedAt" = utc_release_at
  WHERE "id" = superseded_book_id;

  UPDATE "CustomerPriceBook"
  SET
    "effectiveFrom" = utc_release_at,
    "updatedAt" = utc_release_at
  WHERE "id" = structured_book."id";
END
$$;

COMMIT;
