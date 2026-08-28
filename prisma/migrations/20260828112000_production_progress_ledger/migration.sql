BEGIN;

-- Non-piecework in-house crafts remain production progress. This ledger is
-- deliberately separate from ProductionReport: it has no price-book, rate,
-- amount, worker assignment, or machine fields and therefore cannot become a
-- payroll source by accident.
CREATE TABLE "ProductionProgressStep" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "craftId" TEXT NOT NULL,
  "craftCode" VARCHAR(64) NOT NULL,
  "craftName" VARCHAR(128) NOT NULL,
  "status" "ProductionOperationStatus" NOT NULL DEFAULT 'PENDING',
  "plannedQty" DECIMAL(14,3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductionProgressStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionProgressStep_planned_qty_check"
    CHECK ("plannedQty" > 0),
  CONSTRAINT "ProductionProgressStep_craft_code_check"
    CHECK (length(btrim("craftCode")) > 0),
  CONSTRAINT "ProductionProgressStep_craft_name_check"
    CHECK (length(btrim("craftName")) > 0)
);

CREATE TABLE "ProductionProgressReport" (
  "id" TEXT NOT NULL,
  "progressStepId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "completedQty" DECIMAL(14,3) NOT NULL,
  "defectQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "reworkQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionProgressReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionProgressReport_quantity_check"
    CHECK (
      "completedQty" >= 0
      AND "defectQty" >= 0
      AND "reworkQty" >= 0
      AND ("completedQty" + "defectQty" + "reworkQty") > 0
    ),
  CONSTRAINT "ProductionProgressReport_idempotency_key_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX "ProductionProgressStep_orderItemId_craftId_key"
  ON "ProductionProgressStep"("orderItemId", "craftId");
CREATE INDEX "ProductionProgressStep_orderId_status_idx"
  ON "ProductionProgressStep"("orderId", "status");
CREATE INDEX "ProductionProgressStep_craftId_status_idx"
  ON "ProductionProgressStep"("craftId", "status");

CREATE UNIQUE INDEX "ProductionProgressReport_idempotencyKey_key"
  ON "ProductionProgressReport"("idempotencyKey");
CREATE INDEX "ProductionProgressReport_progressStepId_reportedAt_idx"
  ON "ProductionProgressReport"("progressStepId", "reportedAt");
CREATE INDEX "ProductionProgressReport_reporterId_reportedAt_idx"
  ON "ProductionProgressReport"("reporterId", "reportedAt");

ALTER TABLE "ProductionProgressStep"
  ADD CONSTRAINT "ProductionProgressStep_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionProgressStep"
  ADD CONSTRAINT "ProductionProgressStep_orderId_orderItemId_fkey"
  FOREIGN KEY ("orderId", "orderItemId") REFERENCES "OrderItem"("orderId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionProgressReport"
  ADD CONSTRAINT "ProductionProgressReport_progressStepId_fkey"
  FOREIGN KEY ("progressStepId") REFERENCES "ProductionProgressStep"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionProgressReport"
  ADD CONSTRAINT "ProductionProgressReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_production_progress_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ProductionProgressReport rows are append-only';
END;
$$;

CREATE TRIGGER "ProductionProgressReport_immutable"
BEFORE UPDATE OR DELETE ON "ProductionProgressReport"
FOR EACH ROW
EXECUTE FUNCTION prevent_production_progress_report_mutation();

COMMIT;
