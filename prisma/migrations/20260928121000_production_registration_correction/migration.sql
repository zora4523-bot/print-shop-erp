-- Controlled erroneous-registration reversal; real production/revisions never use this path.
CREATE OR REPLACE FUNCTION check_production_job_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order text; target_version integer; target_lane text;
BEGIN
  IF NEW."operationId" IS NOT NULL THEN
    SELECT "orderId", "workOrderVersion", "operationType"::text INTO target_order, target_version, target_lane FROM "ProductionOperation" WHERE id=NEW."operationId";
    IF target_lane = 'PACKING' THEN RAISE EXCEPTION 'Packing does not belong to production completion'; END IF;
  ELSE
    SELECT "orderId", "workOrderVersion" INTO target_order, target_version FROM "ProductionProgressStep" WHERE id=NEW."progressStepId";
  END IF;
  IF target_order IS DISTINCT FROM NEW."orderId" OR target_version IS DISTINCT FROM NEW."workOrderVersion" THEN RAISE EXCEPTION 'Production target mismatch'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('COMPLETED','CARRIED') AND NEW IS DISTINCT FROM OLD THEN
    IF NOT (OLD.status='COMPLETED' AND NEW.status='PENDING' AND NEW.revision=OLD.revision+1
      AND NEW."completedQty" IS NULL AND NEW."completedAt" IS NULL AND NEW."workDate" IS NULL
      AND NEW."workerId"=OLD."workerId" AND NEW."plannedQty"=OLD."plannedQty"
      AND NEW."orderId"=OLD."orderId" AND NEW."workOrderVersion"=OLD."workOrderVersion"
      AND NEW."operationId" IS NOT DISTINCT FROM OLD."operationId" AND NEW."progressStepId" IS NOT DISTINCT FROM OLD."progressStepId"
      AND EXISTS (SELECT 1 FROM "OrderLog" WHERE "orderId"=OLD."orderId" AND action='PRODUCTION_ERROR_CORRECTED'
        AND "changedFields"->>'jobId'=OLD.id AND ("changedFields"->>'correctionRevision')::integer=NEW.revision)
      AND NOT EXISTS (SELECT 1 FROM "ProductionWage" WHERE "jobId"=OLD.id AND ("settlementId" IS NOT NULL OR amount IS NULL OR amount<>0)))
    THEN RAISE EXCEPTION 'Completed production is immutable without an unsettled error correction'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION protect_production_wage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "PieceworkSettlement"; j "ProductionJob";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Production wages are append-only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || NEW."workDate"::text));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."workerId" || ':' || NEW."workDate"::text));
  SELECT * INTO j FROM "ProductionJob" WHERE id=NEW."jobId";
  IF TG_OP='INSERT' AND (j.status <> 'COMPLETED' OR j."workDate" IS DISTINCT FROM NEW."workDate") THEN RAISE EXCEPTION 'Wages require completed production on the same work date'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD."settlementId" IS NOT NULL OR OLD."jobId" <> NEW."jobId" OR OLD."workerId" <> NEW."workerId" OR OLD."workDate" <> NEW."workDate") THEN RAISE EXCEPTION 'Settled wages and wage identity are immutable'; END IF;
  SELECT * INTO s FROM "PieceworkSettlement" WHERE "reporterId"=NEW."workerId" AND "workDate"=NEW."workDate";
  IF s.id IS NOT NULL AND (NEW."settlementId" IS DISTINCT FROM s.id OR NEW.amount IS NULL OR TG_OP <> 'UPDATE' OR NEW.amount IS DISTINCT FROM OLD.amount) THEN RAISE EXCEPTION 'Work date is already settled'; END IF;
  IF NEW."settlementId" IS NOT NULL AND (s.id IS DISTINCT FROM NEW."settlementId" OR NEW.amount IS NULL) THEN RAISE EXCEPTION 'Settlement identity mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_simple_production_legacy_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id text;
BEGIN
  IF TG_TABLE_NAME='ProductionReport' THEN
    SELECT "orderId" INTO order_id FROM "ProductionOperation" WHERE id=NEW."operationId";
  ELSE
    SELECT "orderId" INTO order_id FROM "ProductionProgressStep" WHERE id=NEW."progressStepId";
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || order_id));
  IF EXISTS (SELECT 1 FROM "Order" WHERE id=order_id AND "simpleProduction") THEN RAISE EXCEPTION 'Assigned production requires completion registration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionReport_assigned_guard" BEFORE INSERT ON "ProductionReport" FOR EACH ROW EXECUTE FUNCTION guard_simple_production_legacy_insert();
CREATE TRIGGER "ProductionProgressReport_assigned_guard" BEFORE INSERT ON "ProductionProgressReport" FOR EACH ROW EXECUTE FUNCTION guard_simple_production_legacy_insert();
