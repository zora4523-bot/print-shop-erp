-- AlterTable
ALTER TABLE "ProductionOperation" ADD COLUMN     "carriedCompletedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "carriedWorkOrderProgressQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductionProgressStep" ADD COLUMN     "carriedCompletedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "ProductionOperation" ADD CONSTRAINT "ProductionOperation_carryover_nonnegative"
  CHECK ("carriedCompletedQty" >= 0 AND "carriedCompletedQty" <= "plannedQty" AND "carriedWorkOrderProgressQty" >= 0);
ALTER TABLE "ProductionProgressStep" ADD CONSTRAINT "ProductionProgressStep_carryover_nonnegative"
  CHECK ("carriedCompletedQty" >= 0 AND "carriedCompletedQty" <= "plannedQty");

-- Carryover is fixed at generation creation, never a mutable payroll report.
CREATE FUNCTION prevent_production_carryover_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."carriedCompletedQty" IS DISTINCT FROM OLD."carriedCompletedQty"
     OR (TG_TABLE_NAME = 'ProductionOperation' AND
       to_jsonb(NEW)->'carriedWorkOrderProgressQty' IS DISTINCT FROM to_jsonb(OLD)->'carriedWorkOrderProgressQty') THEN
    RAISE EXCEPTION 'Production carryover is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductionOperation_carryover_immutable" BEFORE UPDATE ON "ProductionOperation"
  FOR EACH ROW EXECUTE FUNCTION prevent_production_carryover_update();
CREATE TRIGGER "ProductionProgressStep_carryover_immutable" BEFORE UPDATE ON "ProductionProgressStep"
  FOR EACH ROW EXECUTE FUNCTION prevent_production_carryover_update();

CREATE OR REPLACE FUNCTION validate_production_work_order_progress_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  operation_record RECORD;
  report_record RECORD;
  order_record RECORD;
  order_total NUMERIC(14,3);
  existing_total NUMERIC(14,3);
  expected_stage "ProductionWorkOrderStage";
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('print-shop-erp:order-cascade:' || NEW."orderId")
  );

  SELECT operation."orderId", operation."operationType",
         operation."workOrderVersion"
    INTO operation_record
  FROM "ProductionOperation" operation
  WHERE operation."id" = NEW."operationId";

  SELECT orders."workOrderVersion" INTO order_record
  FROM "Order" orders
  WHERE orders."id" = NEW."orderId";

  IF NOT FOUND
     OR operation_record."orderId" IS NULL
     OR operation_record."orderId" <> NEW."orderId"
     OR operation_record."workOrderVersion" <> NEW."workOrderVersion"
     OR order_record."workOrderVersion" <> NEW."workOrderVersion" THEN
    RAISE EXCEPTION 'Work-order progress must belong to the current production generation';
  END IF;

  expected_stage := CASE
    WHEN operation_record."operationType" IN (
      'PARTIAL'::"PieceworkOperationType",
      'FULL'::"PieceworkOperationType"
    ) THEN 'FOILING'::"ProductionWorkOrderStage"
    WHEN operation_record."operationType" = 'PACKING'::"PieceworkOperationType"
      THEN 'PACKING'::"ProductionWorkOrderStage"
    ELSE NULL
  END;
  IF expected_stage IS NULL OR NEW."stage" <> expected_stage THEN
    RAISE EXCEPTION 'Work-order progress stage does not match operation type';
  END IF;

  SELECT report."operationId", report."reporterId", report."idempotencyKey",
         report."reportedAt"
    INTO report_record
  FROM "ProductionReport" report
  WHERE report."id" = NEW."sourceReportId";
  IF NOT FOUND
     OR report_record."operationId" <> NEW."operationId"
     OR report_record."reporterId" <> NEW."reporterId"
     OR report_record."idempotencyKey" <> NEW."idempotencyKey" THEN
    RAISE EXCEPTION 'Work-order progress must match its source report';
  END IF;

  SELECT COALESCE(sum(item."quantity"), 0)::NUMERIC(14,3)
    INTO order_total
  FROM "OrderItem" item
  WHERE item."orderId" = NEW."orderId";
  IF order_total <= 0 THEN
    RAISE EXCEPTION 'Work-order progress requires a positive order quantity';
  END IF;

  SELECT COALESCE(sum(progress."workOrderProgressQuantity"), 0)::NUMERIC(14,3)
    INTO existing_total
  FROM "ProductionWorkOrderProgress" progress
  WHERE progress."orderId" = NEW."orderId"
    AND progress."workOrderVersion" = NEW."workOrderVersion"
    AND progress."stage" = NEW."stage";
  SELECT existing_total + COALESCE(sum(operation."carriedWorkOrderProgressQty"), 0)
    INTO existing_total
  FROM "ProductionOperation" operation
  WHERE operation."orderId" = NEW."orderId"
    AND operation."workOrderVersion" = NEW."workOrderVersion"
    AND ((NEW."stage" = 'PACKING' AND operation."operationType" = 'PACKING')
      OR (NEW."stage" = 'FOILING' AND operation."operationType" IN ('PARTIAL', 'FULL')));
  IF existing_total + NEW."workOrderProgressQuantity" > order_total THEN
    RAISE EXCEPTION 'Work-order % progress % exceeds order quantity %',
      NEW."stage", existing_total + NEW."workOrderProgressQuantity", order_total;
  END IF;

  NEW."reportedAt" := report_record."reportedAt";
  RETURN NEW;
END;
$$;

