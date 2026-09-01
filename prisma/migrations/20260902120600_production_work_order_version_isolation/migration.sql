-- A work-order version upgrade must not reuse or overwrite the prior
-- production generation. Operations and no-pay progress steps remain mutable
-- only in status, while every report stays attached to its immutable
-- generation through the parent id.

ALTER TABLE "ProductionOperation"
  ADD COLUMN "workOrderVersion" INTEGER;
ALTER TABLE "ProductionProgressStep"
  ADD COLUMN "workOrderVersion" INTEGER;
ALTER TABLE "ProductionWorkOrderProgress"
  ADD COLUMN "workOrderVersion" INTEGER;

UPDATE "ProductionOperation" operation
SET "workOrderVersion" = orders."workOrderVersion"
FROM "Order" orders
WHERE orders."id" = operation."orderId";

UPDATE "ProductionProgressStep" step
SET "workOrderVersion" = orders."workOrderVersion"
FROM "Order" orders
WHERE orders."id" = step."orderId";

-- The append-only trigger must be temporarily removed for the one-time
-- generation backfill. It is restored below before the migration completes.
DROP TRIGGER "ProductionWorkOrderProgress_immutable"
  ON "ProductionWorkOrderProgress";
UPDATE "ProductionWorkOrderProgress" progress
SET "workOrderVersion" = operation."workOrderVersion"
FROM "ProductionOperation" operation
WHERE operation."id" = progress."operationId";

ALTER TABLE "ProductionOperation"
  ALTER COLUMN "workOrderVersion" SET DEFAULT 1,
  ALTER COLUMN "workOrderVersion" SET NOT NULL,
  ADD CONSTRAINT "ProductionOperation_workOrderVersion_positive_check"
    CHECK ("workOrderVersion" > 0);
ALTER TABLE "ProductionProgressStep"
  ALTER COLUMN "workOrderVersion" SET DEFAULT 1,
  ALTER COLUMN "workOrderVersion" SET NOT NULL,
  ADD CONSTRAINT "ProductionProgressStep_workOrderVersion_positive_check"
    CHECK ("workOrderVersion" > 0);
ALTER TABLE "ProductionWorkOrderProgress"
  ALTER COLUMN "workOrderVersion" SET DEFAULT 1,
  ALTER COLUMN "workOrderVersion" SET NOT NULL,
  ADD CONSTRAINT "ProductionWorkOrderProgress_workOrderVersion_positive_check"
    CHECK ("workOrderVersion" > 0);

DROP INDEX "ProductionProgressStep_orderItemId_craftId_key";
CREATE UNIQUE INDEX "ProductionProgressStep_orderItemId_craftId_workOrderVersion_key"
  ON "ProductionProgressStep"("orderItemId", "craftId", "workOrderVersion");
CREATE INDEX "ProductionOperation_orderId_workOrderVersion_status_idx"
  ON "ProductionOperation"("orderId", "workOrderVersion", "status");
CREATE INDEX "ProductionProgressStep_orderId_workOrderVersion_status_idx"
  ON "ProductionProgressStep"("orderId", "workOrderVersion", "status");
CREATE INDEX "ProductionWorkOrderProgress_orderId_workOrderVersion_stage_reportedAt_id_idx"
  ON "ProductionWorkOrderProgress"(
    "orderId", "workOrderVersion", "stage", "reportedAt", "id"
  );

CREATE OR REPLACE FUNCTION validate_current_production_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_version INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('print-shop-erp:order-cascade:' || NEW."orderId")
  );
  SELECT "workOrderVersion" INTO current_version
  FROM "Order"
  WHERE "id" = NEW."orderId";
  IF NOT FOUND OR NEW."workOrderVersion" <> current_version THEN
    RAISE EXCEPTION 'Production generation must match current work-order version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionOperation_validate_generation"
BEFORE INSERT OR UPDATE OF "orderId", "workOrderVersion"
ON "ProductionOperation"
FOR EACH ROW
EXECUTE FUNCTION validate_current_production_generation();

CREATE TRIGGER "ProductionProgressStep_validate_generation"
BEFORE INSERT OR UPDATE OF "orderId", "workOrderVersion"
ON "ProductionProgressStep"
FOR EACH ROW
EXECUTE FUNCTION validate_current_production_generation();

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
  IF existing_total + NEW."workOrderProgressQuantity" > order_total THEN
    RAISE EXCEPTION 'Work-order % progress % exceeds order quantity %',
      NEW."stage", existing_total + NEW."workOrderProgressQuantity", order_total;
  END IF;

  NEW."reportedAt" := report_record."reportedAt";
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_production_scan_claim_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_record RECORD;
  target_record RECORD;
  reporter_valid BOOLEAN;
  db_now TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('print-shop-erp:order-cascade:' || NEW."orderId")
  );

  IF NEW."operationId" IS NOT NULL THEN
    SELECT operation."orderId", operation."workOrderVersion"
      INTO target_record
    FROM "ProductionOperation" operation
    WHERE operation."id" = NEW."operationId";
  ELSE
    SELECT step."orderId", step."workOrderVersion"
      INTO target_record
    FROM "ProductionProgressStep" step
    WHERE step."id" = NEW."progressStepId";
  END IF;
  IF NOT FOUND
     OR target_record."orderId" IS NULL
     OR target_record."orderId" <> NEW."orderId"
     OR target_record."workOrderVersion" <> NEW."workOrderVersion" THEN
    RAISE EXCEPTION 'Production scan target must belong to the current work-order version';
  END IF;

  SELECT "status", "scheduledAt", "workOrderVersion" INTO order_record
  FROM "Order"
  WHERE "id" = NEW."orderId";
  IF NOT FOUND
     OR order_record."scheduledAt" IS NULL
     OR order_record."workOrderVersion" <> NEW."workOrderVersion"
     OR order_record."status" NOT IN (
       'RELEASED'::"OrderStatus",
       'FOILING'::"OrderStatus",
       'PACKING'::"OrderStatus"
     ) THEN
    RAISE EXCEPTION 'Only a released production order can be scan-claimed';
  END IF;

  SELECT ("role" = 'WORKER'::"Role" AND "isActive") INTO reporter_valid
  FROM "User"
  WHERE "id" = NEW."reporterId";
  IF COALESCE(reporter_valid, FALSE) = FALSE THEN
    RAISE EXCEPTION 'Production scan claimant must be an active worker';
  END IF;

  db_now := clock_timestamp();
  IF db_now < order_record."scheduledAt" THEN
    RAISE EXCEPTION 'Production scan claim cannot precede release';
  END IF;
  NEW."claimedAt" := db_now;
  NEW."createdAt" := db_now;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionWorkOrderProgress_immutable"
BEFORE UPDATE OR DELETE ON "ProductionWorkOrderProgress"
FOR EACH ROW
EXECUTE FUNCTION prevent_production_work_order_fact_mutation();
