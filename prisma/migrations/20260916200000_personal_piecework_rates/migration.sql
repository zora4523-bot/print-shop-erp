-- AlterTable
ALTER TABLE "PieceworkPriceBook" ADD COLUMN     "useUnifiedRates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workerId" TEXT;

-- CreateIndex
CREATE INDEX "PieceworkPriceBook_workerId_status_effectiveFrom_idx" ON "PieceworkPriceBook"("workerId", "status", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "PieceworkPriceBook" ADD CONSTRAINT "PieceworkPriceBook_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PieceworkPriceBook" ADD CONSTRAINT "PieceworkPriceBook_unified_scope_check" CHECK (NOT "useUnifiedRates" OR "workerId" IS NOT NULL);
ALTER TABLE "PieceworkPriceBook" DROP CONSTRAINT "PieceworkPriceBook_published_window_no_overlap";
ALTER TABLE "PieceworkPriceBook" ADD CONSTRAINT "PieceworkPriceBook_published_window_no_overlap"
EXCLUDE USING gist (COALESCE("workerId", '') WITH =, tstzrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamptz), '[)') WITH &&)
WHERE ("status" = 'PUBLISHED');

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

CREATE OR REPLACE FUNCTION require_piecework_successor_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo"
    AND NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceBook" successor
      WHERE successor."status" = 'PUBLISHED'
        AND successor."version" > OLD."version"
        AND successor."workerId" IS NOT DISTINCT FROM OLD."workerId"
        AND successor."effectiveFrom" = NEW."effectiveTo"
    ) THEN
    RAISE EXCEPTION 'Closing a piecework price book requires its published successor';
  END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION validate_production_report_price_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  operation_record RECORD;
  matched_rate DECIMAL(14,4);
  policy RECORD;
  selected_owner TEXT;
BEGIN
  -- A reversal carries the original book/rate/hash and is validated below by
  -- validate_production_report_reversal as an exact negation. Requiring the
  -- old book to still be effective at the correction time would make an
  -- expired historical report impossible to reverse.
  IF NEW."entryType" = 'REVERSAL' THEN
    RETURN NEW;
  END IF;

  SELECT operation."operationType", operation."unit"
  INTO operation_record
  FROM "ProductionOperation" operation
  WHERE operation."id" = NEW."operationId"
  FOR SHARE;

  IF NOT FOUND OR operation_record."unit" <> NEW."unit" THEN
    RAISE EXCEPTION 'Production report unit does not match its operation';
  END IF;

  SELECT * INTO policy FROM "PieceworkPriceBook" WHERE "workerId" = NEW."reporterId"
    AND status = 'PUBLISHED' AND "effectiveFrom" <= NEW."reportedAt"
    AND ("effectiveTo" IS NULL OR "effectiveTo" > NEW."reportedAt");
  SELECT "workerId" INTO selected_owner FROM "PieceworkPriceBook" WHERE id = NEW."priceBookId";
  IF policy.id IS NOT NULL THEN
    IF (NEW.snapshot #>> '{payroll,policyBookId}') IS DISTINCT FROM policy.id
      OR (NOT policy."useUnifiedRates" AND NEW."priceBookId" <> policy.id)
      OR (policy."useUnifiedRates" AND selected_owner IS NOT NULL)
    THEN RAISE EXCEPTION 'Report must use the reporter effective personal policy'; END IF;
  ELSIF selected_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Report cannot use another worker price book';
  END IF;

  SELECT rule."amount"
  INTO matched_rate
  FROM "PieceworkPriceBook" book
  JOIN "PieceworkPriceRule" rule ON rule."priceBookId" = book."id"
  WHERE book."id" = NEW."priceBookId"
    AND book."status" = 'PUBLISHED'
    AND book."version" = NEW."priceBookVersion"
    AND book."ruleSetSha256" = NEW."ruleSetSha256"
    AND book."effectiveFrom" <= NEW."reportedAt"
    AND (book."effectiveTo" IS NULL OR book."effectiveTo" > NEW."reportedAt")
    AND rule."operationType" = operation_record."operationType"
    AND rule."unit" = NEW."unit";

  IF NOT FOUND OR matched_rate IS NULL OR matched_rate <> NEW."rate" THEN
    RAISE EXCEPTION 'Production report does not match an effective published rate';
  END IF;

  IF operation_record."operationType" IN ('FULL', 'PACKING')
    AND NEW."chargeableQty" <> NEW."reportedCompletedQty"
  THEN
    RAISE EXCEPTION 'Only completed quantity is chargeable for this operation';
  END IF;
  IF operation_record."operationType" = 'PARTIAL' AND (
    (NEW."reportedCompletedQty" = 0 AND NEW."chargeableQty" <> 0)
    OR (
      NEW."reportedCompletedQty" <> 0
      AND (
        abs(NEW."chargeableQty") < abs(NEW."reportedCompletedQty")
        OR mod(
          abs(NEW."chargeableQty"),
          abs(NEW."reportedCompletedQty")
        ) <> 0
      )
    )
  ) THEN
    RAISE EXCEPTION 'PARTIAL chargeable quantity must be completed quantity times whole passes';
  END IF;

  RETURN NEW;
END;
$$;

