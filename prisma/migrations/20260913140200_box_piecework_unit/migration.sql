BEGIN;
-- Boxing remains in the packing lane but must never select the per-bag wage.
DROP INDEX "PieceworkPriceRule_priceBookId_operationType_key";
CREATE UNIQUE INDEX "PieceworkPriceRule_priceBookId_operationType_unit_key" ON "PieceworkPriceRule"("priceBookId", "operationType", "unit");
ALTER TABLE "PieceworkPriceRule" DROP CONSTRAINT "PieceworkPriceRule_operation_unit_check";
ALTER TABLE "PieceworkPriceRule" ADD CONSTRAINT "PieceworkPriceRule_operation_unit_check" CHECK (
  ("operationType" = 'PARTIAL' AND "unit" = 'PER_PASS') OR ("operationType" = 'FULL' AND "unit" = 'PER_PIECE') OR ("operationType" = 'PACKING' AND "unit" IN ('PER_BAG', 'PER_BOX')));
CREATE OR REPLACE FUNCTION validate_piecework_price_book_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" <> 'PUBLISHED' THEN
    RETURN NEW;
  END IF;

  IF (
    SELECT count(*)
    FROM "PieceworkPriceRule" rule
    WHERE rule."priceBookId" = NEW."id"
  ) NOT IN (3, 4) THEN
    RAISE EXCEPTION 'A published piecework price book requires three base rules and at most one optional box rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PieceworkPriceRule" rule
    WHERE rule."priceBookId" = NEW."id"
      AND rule."amount" IS NULL
  ) THEN
    RAISE EXCEPTION 'A published piecework price book cannot contain null rates';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'PARTIAL' AND "unit" = 'PER_PASS'
    ) OR NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'FULL' AND "unit" = 'PER_PIECE'
    ) OR NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceRule"
      WHERE "priceBookId" = NEW."id"
        AND "operationType" = 'PACKING' AND "unit" = 'PER_BAG'
    ) THEN
    RAISE EXCEPTION 'Piecework rule operation types and units are incomplete';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
