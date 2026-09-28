-- CreateTable
CREATE TABLE "ProductionFactReview" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductionFactReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionFactReview_jobId_key" ON "ProductionFactReview"("jobId");

-- CreateIndex
CREATE INDEX "ProductionFactReview_status_periodStart_periodEnd_idx" ON "ProductionFactReview"("status", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "ProductionFactReview" ADD CONSTRAINT "ProductionFactReview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionFactReview" ADD CONSTRAINT "ProductionFactReview_shape" CHECK (
  status IN ('OPEN','CONFLICT','UNPRODUCED','RESOLVED','WAGES_DUE','DISMISSED')
  AND "periodStart" <= "periodEnd" AND revision >= 0 AND "jobRevision" >= 0
  AND length(trim(reason)) > 0
  AND (status IN ('OPEN','CONFLICT') OR ("resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL))
);

-- Protect existing ambiguous history before any recovery writes are enabled.
-- No historical task, wage, source shipment or paid ledger is rewritten.
INSERT INTO "ProductionFactReview" (id,"jobId","jobRevision",status,"periodStart","periodEnd",reason,evidence,"createdById","updatedAt")
SELECT 'migration-review:' || j.id,j.id,j.revision,'OPEN',
  COALESCE(j."workDate", (COALESCE(p."createdAt",s."createdAt",j."createdAt") AT TIME ZONE 'Asia/Shanghai')::date),
  GREATEST(COALESCE(j."workDate",(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date),
    (COALESCE(p."createdAt",s."createdAt",j."createdAt") AT TIME ZONE 'Asia/Shanghai')::date),
  '历史生产是否已登记需要核对',jsonb_build_object('migration','production_fact_review','originalStatus',j.status,'requestedQty',j."requestedQty"),
  'system:migration',CURRENT_TIMESTAMP
FROM "ProductionJob" j JOIN "Order" o ON o.id=j."orderId"
LEFT JOIN "ProductionOperation" p ON p.id=j."operationId"
LEFT JOIN "ProductionProgressStep" s ON s.id=j."progressStepId"
WHERE (j.status IN ('PENDING','REQUESTED','CANCELLED'))
  AND (j."workOrderVersion" < o."workOrderVersion" OR o.status IN ('CANCELLED','SHIPPED','SETTLED','FINISHED'));

CREATE FUNCTION protect_production_fact_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "ProductionJob";
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Production verification history cannot be deleted'; END IF;
  SELECT * INTO j FROM "ProductionJob" WHERE id=NEW."jobId";
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || j."orderId"));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:salary-identity:' || j."workerId"));
  IF TG_OP='UPDATE' AND (NEW."jobId" <> OLD."jobId" OR NEW."createdById" <> OLD."createdById" OR NEW.revision <> OLD.revision+1) THEN
    RAISE EXCEPTION 'Production verification identity and revision must be preserved';
  END IF;
  IF NEW.status='WAGES_DUE' AND (j.status <> 'COMPLETED' OR j."workDate" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=j."workerId" AND "workDate"=j."workDate")) THEN
    RAISE EXCEPTION 'Unpaid historical obligation requires confirmed production and its original settlement';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionFactReview_protect" BEFORE INSERT OR UPDATE OR DELETE ON "ProductionFactReview"
FOR EACH ROW EXECUTE FUNCTION protect_production_fact_review();

CREATE OR REPLACE FUNCTION protect_production_quantity_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:salary-identity:' || NEW."reporterId"));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || NEW."workDate"::text));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."reporterId" || ':' || NEW."workDate"::text));
  IF EXISTS (SELECT 1 FROM "ProductionJob" WHERE "workerId"=NEW."reporterId" AND "workDate"=NEW."workDate" AND status='REQUESTED')
    OR EXISTS (SELECT 1 FROM "ProductionFactReview" r JOIN "ProductionJob" j ON j.id=r."jobId"
      WHERE j."workerId"=NEW."reporterId" AND r.status IN ('OPEN','CONFLICT') AND NEW."workDate" BETWEEN r."periodStart" AND r."periodEnd") THEN
    RAISE EXCEPTION 'Production facts or quantity approval are pending for this work date';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_production_fact_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order";
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || NEW."orderId"));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:salary-identity:' || NEW."workerId"));
  SELECT * INTO o FROM "Order" WHERE id=NEW."orderId";
  IF NEW."workDate" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || NEW."workDate"::text));
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."workerId" || ':' || NEW."workDate"::text));
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='COMPLETED' AND NEW.status<>'COMPLETED'
    AND EXISTS (SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=OLD."workerId" AND "workDate"=OLD."workDate") THEN
    RAISE EXCEPTION 'Settled-day production facts are immutable even without a wage row';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='REQUESTED' AND NEW.status='CANCELLED' AND NOT EXISTS (
    SELECT 1 FROM "OrderLog" WHERE "orderId"=OLD."orderId" AND action='PRODUCTION_QUANTITY_REJECTED'
      AND "changedFields"->>'jobId'=OLD.id AND "changedFields"->>'notActuallyProduced'='true') THEN
    RAISE EXCEPTION 'Requested production cannot be discarded by a revision or cancellation';
  END IF;
  IF NEW."workOrderVersion"=o."workOrderVersion" AND NEW.status IN ('PENDING','REQUESTED','COMPLETED')
    AND EXISTS (SELECT 1 FROM "ProductionFactReview" r JOIN "ProductionJob" j ON j.id=r."jobId"
      WHERE j."orderId"=NEW."orderId" AND j.id<>NEW.id AND j."workOrderVersion"<NEW."workOrderVersion" AND r.status IN ('OPEN','CONFLICT')) THEN
    RAISE EXCEPTION 'Resolve historical production facts before dependent production writes';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionJob_fact_guard" BEFORE INSERT OR UPDATE ON "ProductionJob"
FOR EACH ROW EXECUTE FUNCTION guard_production_fact_write();
