-- Packing wage rollout is deferred. Preserve all personal and historical guards.
BEGIN;
CREATE OR REPLACE FUNCTION validate_piecework_price_book_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE lane "PieceworkOperationType";
BEGIN
  IF NEW."status" <> 'PUBLISHED' THEN
    RETURN NEW;
  END IF;

  IF NEW."workerId" IS NOT NULL THEN
    SELECT CASE WHEN "workerType" = 'PACKER' THEN 'PACKING'::"PieceworkOperationType"
      WHEN "workerType" = 'MACHINE' AND "machineType" = 'HAND_PRESS' THEN 'PARTIAL'::"PieceworkOperationType"
      WHEN "workerType" = 'MACHINE' AND "machineType" = 'WINDMILL' THEN 'FULL'::"PieceworkOperationType" END INTO lane
    FROM "User" WHERE id = NEW."workerId" AND role = 'WORKER' AND "isActive";
    IF lane IS NULL THEN RAISE EXCEPTION 'Personal rates require an active piecework worker'; END IF;
    IF NEW."useUnifiedRates" THEN
      IF EXISTS (SELECT 1 FROM "PieceworkPriceRule" WHERE "priceBookId" = NEW.id) THEN RAISE EXCEPTION 'Unified mode cannot contain personal rules'; END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM "PieceworkPriceRule" WHERE "priceBookId" = NEW.id AND ("operationType" <> lane OR amount IS NULL))
        OR NOT EXISTS (SELECT 1 FROM "PieceworkPriceRule" WHERE "priceBookId" = NEW.id AND "operationType" = lane AND
          unit = CASE lane WHEN 'PARTIAL' THEN 'PER_PASS'::"PieceworkRateUnit" WHEN 'FULL' THEN 'PER_PIECE'::"PieceworkRateUnit" ELSE 'PER_BAG'::"PieceworkRateUnit" END)
      THEN RAISE EXCEPTION 'Personal rates must match the worker lane and be complete'; END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (
    SELECT count(*)
    FROM "PieceworkPriceRule" rule
    WHERE rule."priceBookId" = NEW."id"
  ) NOT IN (2, 3, 4) THEN
    RAISE EXCEPTION 'A published piecework price book requires two foil rules and at most two optional packing rules';
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
    ) THEN
    RAISE EXCEPTION 'Piecework rule operation types and units are incomplete';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
