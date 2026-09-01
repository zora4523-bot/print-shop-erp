-- W2 production truth: work-order piece progress and first valid scan claims.
-- Both ledgers are additive and append-only. Payroll quantities remain in
-- ProductionReport and are never backfilled into this work-order projection.

CREATE TYPE "ProductionWorkOrderStage" AS ENUM ('FOILING', 'PACKING');

CREATE TABLE "ProductionWorkOrderProgress" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "sourceReportId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "stage" "ProductionWorkOrderStage" NOT NULL,
  "workOrderProgressQuantity" DECIMAL(14,3) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionWorkOrderProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionWorkOrderProgress_quantity_nonnegative_check"
    CHECK ("workOrderProgressQuantity" >= 0),
  CONSTRAINT "ProductionWorkOrderProgress_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 8 AND 128)
);

CREATE TABLE "ProductionScanClaim" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "workOrderVersion" INTEGER NOT NULL,
  "operationId" TEXT,
  "progressStepId" TEXT,
  "reporterId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "claimedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionScanClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionScanClaim_target_shape_check"
    CHECK (num_nonnulls("operationId", "progressStepId") = 1),
  CONSTRAINT "ProductionScanClaim_work_order_version_positive_check"
    CHECK ("workOrderVersion" > 0),
  CONSTRAINT "ProductionScanClaim_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX "ProductionWorkOrderProgress_sourceReportId_key"
  ON "ProductionWorkOrderProgress"("sourceReportId");
CREATE UNIQUE INDEX "ProductionWorkOrderProgress_idempotencyKey_key"
  ON "ProductionWorkOrderProgress"("idempotencyKey");
CREATE INDEX "ProductionWorkOrderProgress_orderId_stage_reportedAt_id_idx"
  ON "ProductionWorkOrderProgress"("orderId", "stage", "reportedAt", "id");
CREATE INDEX "ProductionWorkOrderProgress_operationId_reportedAt_idx"
  ON "ProductionWorkOrderProgress"("operationId", "reportedAt");
CREATE INDEX "ProductionWorkOrderProgress_reporterId_reportedAt_idx"
  ON "ProductionWorkOrderProgress"("reporterId", "reportedAt");

-- One row is the immutable first valid scan fact for each released version.
CREATE UNIQUE INDEX "ProductionScanClaim_orderId_workOrderVersion_key"
  ON "ProductionScanClaim"("orderId", "workOrderVersion");
CREATE UNIQUE INDEX "ProductionScanClaim_idempotencyKey_key"
  ON "ProductionScanClaim"("idempotencyKey");
CREATE INDEX "ProductionScanClaim_reporterId_claimedAt_idx"
  ON "ProductionScanClaim"("reporterId", "claimedAt");
CREATE INDEX "ProductionScanClaim_operationId_idx"
  ON "ProductionScanClaim"("operationId");
CREATE INDEX "ProductionScanClaim_progressStepId_idx"
  ON "ProductionScanClaim"("progressStepId");
CREATE INDEX "ProductionScanClaim_claimedAt_idx"
  ON "ProductionScanClaim"("claimedAt");

ALTER TABLE "ProductionWorkOrderProgress"
  ADD CONSTRAINT "ProductionWorkOrderProgress_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionWorkOrderProgress"
  ADD CONSTRAINT "ProductionWorkOrderProgress_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionWorkOrderProgress"
  ADD CONSTRAINT "ProductionWorkOrderProgress_sourceReportId_fkey"
  FOREIGN KEY ("sourceReportId") REFERENCES "ProductionReport"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionWorkOrderProgress"
  ADD CONSTRAINT "ProductionWorkOrderProgress_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionScanClaim"
  ADD CONSTRAINT "ProductionScanClaim_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionScanClaim"
  ADD CONSTRAINT "ProductionScanClaim_progressStepId_fkey"
  FOREIGN KEY ("progressStepId") REFERENCES "ProductionProgressStep"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionScanClaim"
  ADD CONSTRAINT "ProductionScanClaim_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionScanClaim"
  ADD CONSTRAINT "ProductionScanClaim_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_production_work_order_progress_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  operation_record RECORD;
  report_record RECORD;
  order_total NUMERIC(14,3);
  existing_total NUMERIC(14,3);
  expected_stage "ProductionWorkOrderStage";
BEGIN
  -- Same lock key as every application Order write/report path. The DB guard
  -- also serializes direct SQL writers before evaluating the aggregate cap.
  PERFORM pg_advisory_xact_lock(
    hashtext('print-shop-erp:order-cascade:' || NEW."orderId")
  );

  SELECT operation."orderId", operation."operationType"
    INTO operation_record
  FROM "ProductionOperation" operation
  WHERE operation."id" = NEW."operationId";

  IF NOT FOUND OR operation_record."orderId" <> NEW."orderId" THEN
    RAISE EXCEPTION 'Work-order progress operation must belong to its order';
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
    AND progress."stage" = NEW."stage";

  IF existing_total + NEW."workOrderProgressQuantity" > order_total THEN
    RAISE EXCEPTION 'Work-order % progress % exceeds order quantity %',
      NEW."stage", existing_total + NEW."workOrderProgressQuantity", order_total;
  END IF;

  -- The source report timestamp is supplied from the database clock by the
  -- reporting service. Copy it so payroll and work-order facts cannot drift.
  NEW."reportedAt" := report_record."reportedAt";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionWorkOrderProgress_validate_insert"
BEFORE INSERT ON "ProductionWorkOrderProgress"
FOR EACH ROW
EXECUTE FUNCTION validate_production_work_order_progress_insert();

CREATE OR REPLACE FUNCTION validate_production_scan_claim_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_record RECORD;
  target_order_id TEXT;
  reporter_valid BOOLEAN;
  db_now TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('print-shop-erp:order-cascade:' || NEW."orderId")
  );

  IF NEW."operationId" IS NOT NULL THEN
    SELECT operation."orderId" INTO target_order_id
    FROM "ProductionOperation" operation
    WHERE operation."id" = NEW."operationId";
  ELSE
    SELECT step."orderId" INTO target_order_id
    FROM "ProductionProgressStep" step
    WHERE step."id" = NEW."progressStepId";
  END IF;
  IF NOT FOUND OR target_order_id <> NEW."orderId" THEN
    RAISE EXCEPTION 'Production scan target must belong to its order';
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

CREATE TRIGGER "ProductionScanClaim_validate_insert"
BEFORE INSERT ON "ProductionScanClaim"
FOR EACH ROW
EXECUTE FUNCTION validate_production_scan_claim_insert();

CREATE OR REPLACE FUNCTION prevent_production_work_order_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "ProductionWorkOrderProgress_immutable"
BEFORE UPDATE OR DELETE ON "ProductionWorkOrderProgress"
FOR EACH ROW
EXECUTE FUNCTION prevent_production_work_order_fact_mutation();

CREATE TRIGGER "ProductionScanClaim_immutable"
BEFORE UPDATE OR DELETE ON "ProductionScanClaim"
FOR EACH ROW
EXECUTE FUNCTION prevent_production_work_order_fact_mutation();
