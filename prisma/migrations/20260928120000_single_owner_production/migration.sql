-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "simpleProduction" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductionDispatchBatch" (
    "id" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "actorId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDispatchBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionJob" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "workOrderVersion" INTEGER NOT NULL,
    "operationId" TEXT,
    "progressStepId" TEXT,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "plannedQty" DECIMAL(14,3) NOT NULL,
    "completedQty" DECIMAL(14,3),
    "requestedQty" DECIMAL(14,3),
    "requestReason" TEXT,
    "requestedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "manualPricing" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "workDate" DATE,
    "recordedById" TEXT,
    "recordSource" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionWage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "settlementId" TEXT,

    CONSTRAINT "ProductionWage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionWageEntry" (
    "id" TEXT NOT NULL,
    "wageId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionWageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionJob_operationId_key" ON "ProductionJob"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionJob_progressStepId_key" ON "ProductionJob"("progressStepId");

-- CreateIndex
CREATE INDEX "ProductionJob_orderId_workOrderVersion_status_idx" ON "ProductionJob"("orderId", "workOrderVersion", "status");

-- CreateIndex
CREATE INDEX "ProductionJob_workerId_status_createdAt_idx" ON "ProductionJob"("workerId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionJob_orderId_workOrderVersion_sourceKey_key" ON "ProductionJob"("orderId", "workOrderVersion", "sourceKey");

-- CreateIndex
CREATE INDEX "ProductionWage_workerId_workDate_settlementId_idx" ON "ProductionWage"("workerId", "workDate", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionWage_jobId_workerId_workDate_key" ON "ProductionWage"("jobId", "workerId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionWageEntry_requestKey_key" ON "ProductionWageEntry"("requestKey");

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ProductionOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_progressStepId_fkey" FOREIGN KEY ("progressStepId") REFERENCES "ProductionProgressStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionWage" ADD CONSTRAINT "ProductionWage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionWage" ADD CONSTRAINT "ProductionWage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionWage" ADD CONSTRAINT "ProductionWage_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PieceworkSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionWageEntry" ADD CONSTRAINT "ProductionWageEntry_wageId_fkey" FOREIGN KEY ("wageId") REFERENCES "ProductionWage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New workflow is opt-in; historical production and wages are untouched.
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_shape" CHECK (
  num_nonnulls("operationId", "progressStepId") = 1
  AND status IN ('PENDING','REQUESTED','COMPLETED','CANCELLED','CARRIED')
  AND "plannedQty" >= 0 AND trunc("plannedQty") = "plannedQty"
  AND (status <> 'REQUESTED' OR ("requestedQty" > 0 AND "requestReason" IS NOT NULL AND "workDate" IS NOT NULL))
  AND (status <> 'COMPLETED' OR ("completedQty" > 0 AND "completedAt" IS NOT NULL AND "workDate" IS NOT NULL AND "recordedById" IS NOT NULL))
  AND ("completedQty" IS NULL OR trunc("completedQty") = "completedQty")
);
ALTER TABLE "ProductionWage" ADD CONSTRAINT "ProductionWage_amount" CHECK (amount IS NULL OR amount >= 0);

CREATE FUNCTION check_production_job_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order text; target_version integer; target_lane text;
BEGIN
  IF NEW."operationId" IS NOT NULL THEN
    SELECT "orderId", "workOrderVersion", "operationType"::text INTO target_order, target_version, target_lane FROM "ProductionOperation" WHERE id=NEW."operationId";
    IF target_lane = 'PACKING' THEN RAISE EXCEPTION 'Packing does not belong to production completion'; END IF;
  ELSE
    SELECT "orderId", "workOrderVersion" INTO target_order, target_version FROM "ProductionProgressStep" WHERE id=NEW."progressStepId";
  END IF;
  IF target_order IS DISTINCT FROM NEW."orderId" OR target_version IS DISTINCT FROM NEW."workOrderVersion" THEN RAISE EXCEPTION 'Production target mismatch'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('COMPLETED','CARRIED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed production is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionJob_target" BEFORE INSERT OR UPDATE ON "ProductionJob" FOR EACH ROW EXECUTE FUNCTION check_production_job_target();

CREATE FUNCTION protect_production_wage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "PieceworkSettlement"; j "ProductionJob";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Production wages are append-only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || NEW."workDate"::text));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."workerId" || ':' || NEW."workDate"::text));
  SELECT * INTO j FROM "ProductionJob" WHERE id=NEW."jobId";
  IF j.status <> 'COMPLETED' OR j."workDate" IS DISTINCT FROM NEW."workDate" THEN RAISE EXCEPTION 'Wages require completed production on the same work date'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD."settlementId" IS NOT NULL OR OLD."jobId" <> NEW."jobId" OR OLD."workerId" <> NEW."workerId" OR OLD."workDate" <> NEW."workDate") THEN RAISE EXCEPTION 'Settled wages and wage identity are immutable'; END IF;
  SELECT * INTO s FROM "PieceworkSettlement" WHERE "reporterId"=NEW."workerId" AND "workDate"=NEW."workDate";
  IF s.id IS NOT NULL AND (NEW."settlementId" IS DISTINCT FROM s.id OR NEW.amount IS NULL OR TG_OP <> 'UPDATE' OR NEW.amount IS DISTINCT FROM OLD.amount) THEN RAISE EXCEPTION 'Work date is already settled'; END IF;
  IF NEW."settlementId" IS NOT NULL AND (s.id IS DISTINCT FROM NEW."settlementId" OR NEW.amount IS NULL) THEN RAISE EXCEPTION 'Settlement identity mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionWage_protect" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionWage" FOR EACH ROW EXECUTE FUNCTION protect_production_wage();

CREATE FUNCTION protect_production_wage_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w "ProductionWage";
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Wage entries are immutable'; END IF;
  SELECT * INTO w FROM "ProductionWage" WHERE id=NEW."wageId" FOR UPDATE;
  IF w."settlementId" IS NOT NULL THEN RAISE EXCEPTION 'Wage is settled'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionWageEntry_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionWageEntry" FOR EACH ROW EXECUTE FUNCTION protect_production_wage_entry();

CREATE FUNCTION check_production_wage_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wage_id text; actual numeric; expected numeric; n bigint;
BEGIN
  wage_id := CASE WHEN TG_TABLE_NAME = 'ProductionWage' THEN NEW.id ELSE NEW."wageId" END;
  SELECT amount INTO expected FROM "ProductionWage" WHERE id=wage_id;
  SELECT coalesce(sum(amount),0),count(*) INTO actual,n FROM "ProductionWageEntry" WHERE "wageId"=wage_id;
  IF (expected IS NULL AND n > 0) OR (expected IS NOT NULL AND (n=0 OR expected <> actual)) THEN RAISE EXCEPTION 'Wage projection does not match append-only ledger'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ProductionWage_balance" AFTER INSERT OR UPDATE ON "ProductionWage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_production_wage_balance();
CREATE CONSTRAINT TRIGGER "ProductionWageEntry_balance" AFTER INSERT ON "ProductionWageEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_production_wage_balance();
