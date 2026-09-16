ALTER TYPE "ProductionReportEntryType" ADD VALUE 'ADJUSTMENT';
ALTER TABLE "ProductionOperation" ADD COLUMN "payrollReviewRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductionReport" ADD COLUMN "wageSupplement" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "adjustedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionReport" DROP CONSTRAINT "ProductionReport_amount_check";
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_amount_check"
  CHECK (amount = round("chargeableQty" * rate, 2) + "wageSupplement");
ALTER TABLE "ProductionReport" DROP CONSTRAINT "ProductionReport_entry_shape_check";
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_entry_shape_check" CHECK (
 ("entryType" = 'REPORT' AND "reversalOfId" IS NULL AND "adjustedById" IS NULL
  AND "reportedCompletedQty" >= 0 AND "defectQty" >= 0 AND "reworkQty" >= 0 AND "chargeableQty" >= 0 AND amount >= 0
  AND ("reportedCompletedQty"+"defectQty"+"reworkQty") > 0)
 OR ("entryType" = 'REVERSAL' AND "reversalOfId" IS NOT NULL AND "adjustedById" IS NULL
  AND "reportedCompletedQty" <= 0 AND "defectQty" <= 0 AND "reworkQty" <= 0 AND "chargeableQty" <= 0 AND amount <= 0
  AND ("reportedCompletedQty"+"defectQty"+"reworkQty") < 0)
 OR ("entryType" = 'ADJUSTMENT' AND "reversalOfId" IS NULL AND "adjustedById" IS NOT NULL
  AND "reportedCompletedQty" = 0 AND "defectQty" = 0 AND "reworkQty" = 0 AND "chargeableQty" = 0)
);

CREATE FUNCTION validate_foil_wage_report() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op RECORD; r RECORD; anchor RECORD; total_qty NUMERIC; multiplier INTEGER; minimum_count INTEGER;
 maximum_count INTEGER; previous_qty NUMERIC; has_previous BOOLEAN; mixed BOOLEAN; fixed_amount NUMERIC; expected_amount NUMERIC;
BEGIN
 SELECT * INTO op FROM "ProductionOperation" WHERE id=NEW."operationId" FOR UPDATE;
 IF NEW."entryType" = 'ADJUSTMENT' THEN
   SELECT * INTO anchor FROM "ProductionReport" WHERE id=NEW.snapshot->>'anchorReportId' AND "entryType"='REPORT';
   IF NOT FOUND OR anchor."operationId"<>NEW."operationId" OR anchor."reporterId"<>NEW."reporterId"
     OR anchor."priceBookId"<>NEW."priceBookId" OR anchor.rate<>NEW.rate OR anchor.unit<>NEW.unit
     OR anchor."priceBookVersion"<>NEW."priceBookVersion" OR anchor."ruleSetSha256"<>NEW."ruleSetSha256"
     OR (anchor."reportedAt" AT TIME ZONE 'Asia/Shanghai')::date <> (NEW."reportedAt" AT TIME ZONE 'Asia/Shanghai')::date
     OR COALESCE(length(btrim(NEW.snapshot->>'reason')),0)<2
     OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."adjustedById" AND role='ADMIN' AND "isActive")
   THEN RAISE EXCEPTION 'Invalid manual wage adjustment'; END IF;
   PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || to_char(NEW."reportedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')));
   PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."reporterId" || ':' || to_char(NEW."reportedAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')));
   IF EXISTS (SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=NEW."reporterId" AND "workDate"=(NEW."reportedAt" AT TIME ZONE 'Asia/Shanghai')::date) THEN
     RAISE EXCEPTION 'Settled wages cannot be adjusted';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW."entryType" = 'REVERSAL' THEN
   SELECT * INTO anchor FROM "ProductionReport" WHERE id=NEW."reversalOfId";
   IF NEW."wageSupplement" <> -anchor."wageSupplement" THEN RAISE EXCEPTION 'Wage reversal must negate the supplement'; END IF;
   IF EXISTS (SELECT 1 FROM "PieceworkPriceRule" WHERE "priceBookId"=anchor."priceBookId" AND "operationType"=op."operationType" AND unit=anchor.unit AND "smallOrderAmount" IS NOT NULL) THEN
     UPDATE "ProductionOperation" SET "payrollReviewRequired"=true WHERE id=op.id;
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM "PieceworkPriceRule" WHERE "priceBookId"=NEW."priceBookId" AND "operationType"=op."operationType" AND unit=NEW.unit;
 IF r."smallOrderAmount" IS NULL THEN
   IF NEW."wageSupplement"<>0 THEN RAISE EXCEPTION 'Legacy wage cannot contain a supplement'; END IF;
   RETURN NEW;
 END IF;
 SELECT sum(item.quantity), min(CASE WHEN op."operationType"='PARTIAL' THEN COALESCE(op."payrollPassCount", cardinality(item."frontFoilColors")+cardinality(item."backFoilColors"))
   ELSE (SELECT count(DISTINCT btrim(color)) FROM unnest(item."frontFoilColors"||item."backFoilColors") color WHERE btrim(color)<>'')::int END),
   max(CASE WHEN op."operationType"='PARTIAL' THEN COALESCE(op."payrollPassCount", cardinality(item."frontFoilColors")+cardinality(item."backFoilColors"))
   ELSE (SELECT count(DISTINCT btrim(color)) FROM unnest(item."frontFoilColors"||item."backFoilColors") color WHERE btrim(color)<>'')::int END)
 INTO total_qty, minimum_count, maximum_count FROM "ProductionOperationSource" src JOIN "OrderItem" item ON item.id=src."orderItemId" WHERE src."operationId"=op.id;
 multiplier := minimum_count;
 mixed := minimum_count IS NULL OR minimum_count<>maximum_count OR minimum_count<1 OR (op."operationType"='FULL' AND maximum_count>3);
 SELECT EXISTS(SELECT 1 FROM "ProductionReport" p WHERE p."operationId"=op.id AND p."entryType"='REPORT' AND p."reportedCompletedQty">0 AND NOT EXISTS(SELECT 1 FROM "ProductionReport" rev WHERE rev."reversalOfId"=p.id)) INTO has_previous;
 SELECT COALESCE(sum(p."reportedCompletedQty"),0) INTO previous_qty FROM "ProductionReport" p WHERE p."operationId"=op.id AND p."reporterId"=NEW."reporterId" AND p."priceBookId"=NEW."priceBookId" AND p."entryType"='REPORT' AND NOT EXISTS(SELECT 1 FROM "ProductionReport" rev WHERE rev."reversalOfId"=p.id);
 IF mixed THEN expected_amount := round(NEW."chargeableQty"*NEW.rate,2);
 ELSE
   fixed_amount := CASE WHEN NOT has_previous AND op."carriedCompletedQty"=0 AND NEW."reportedCompletedQty">0 THEN multiplier*(CASE WHEN total_qty<=1000 THEN r."smallOrderAmount" ELSE r."setupAmount" END) ELSE 0 END;
   expected_amount := fixed_amount + CASE WHEN total_qty<=1000 THEN 0 ELSE round((previous_qty+NEW."reportedCompletedQty")*multiplier*r.amount,2)-round(previous_qty*multiplier*r.amount,2) END;
 END IF;
 IF NEW.amount<>expected_amount THEN RAISE EXCEPTION 'Foil wage must match tier, multiplier and once-only setup'; END IF;
 IF mixed OR op."carriedCompletedQty">0 OR EXISTS(SELECT 1 FROM "ProductionReport" p WHERE p."operationId"=op.id AND p."entryType"='REPORT' AND p."reportedCompletedQty">0 AND (p."reporterId"<>NEW."reporterId" OR p."priceBookId"<>NEW."priceBookId" OR (op."operationType"='PARTIAL' AND (p.snapshot#>>'{payroll,passCount}')::int IS DISTINCT FROM multiplier))) THEN
   UPDATE "ProductionOperation" SET "payrollReviewRequired"=true WHERE id=op.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProductionReport_00_foil_wage" BEFORE INSERT ON "ProductionReport" FOR EACH ROW EXECUTE FUNCTION validate_foil_wage_report();

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
  IF NEW."entryType" IN ('REVERSAL', 'ADJUSTMENT') THEN
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
