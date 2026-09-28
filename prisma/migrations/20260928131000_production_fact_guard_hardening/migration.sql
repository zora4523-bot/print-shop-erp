-- Forward-only hardening: original identities/dates and unresolved obligations
-- must also survive older writers that do not use the new application service.
CREATE OR REPLACE FUNCTION guard_production_fact_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "Order"; owner_id text; fact_day date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || NEW."orderId"));
  IF TG_OP='UPDATE' AND (NEW."orderId"<>OLD."orderId" OR NEW."workOrderVersion"<>OLD."workOrderVersion"
    OR NEW."sourceKey"<>OLD."sourceKey" OR NEW."operationId" IS DISTINCT FROM OLD."operationId"
    OR NEW."progressStepId" IS DISTINCT FROM OLD."progressStepId") THEN
    RAISE EXCEPTION 'Production task identity is immutable';
  END IF;
  FOR owner_id IN SELECT DISTINCT value FROM unnest(ARRAY[NEW."workerId", CASE WHEN TG_OP='UPDATE' THEN OLD."workerId" ELSE NEW."workerId" END]) value ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:salary-identity:' || owner_id));
  END LOOP;
  SELECT * INTO o FROM "Order" WHERE id=NEW."orderId";
  fact_day := CASE WHEN TG_OP='UPDATE' THEN COALESCE(OLD."workDate", NEW."workDate") ELSE NEW."workDate" END;
  IF fact_day IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || fact_day::text));
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."workerId" || ':' || fact_day::text));
  END IF;
  IF TG_OP='UPDATE' AND NEW."workerId"<>OLD."workerId" AND (OLD.status<>'PENDING' OR NOT EXISTS (
    SELECT 1 FROM "ProductionFactReview" WHERE "jobId"=OLD.id AND status='UNPRODUCED' AND "jobRevision"=OLD.revision)) THEN
    RAISE EXCEPTION 'Verify no actual production before transferring its owner';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='COMPLETED' AND NEW.status<>'COMPLETED'
    AND EXISTS (SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=OLD."workerId" AND "workDate"=OLD."workDate") THEN
    RAISE EXCEPTION 'Settled-day production facts are immutable even without a wage row';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='REQUESTED' THEN
    IF NEW.status IN ('PENDING','CANCELLED') THEN
      IF NOT EXISTS (SELECT 1 FROM "OrderLog" WHERE "orderId"=OLD."orderId" AND action='PRODUCTION_QUANTITY_REJECTED'
        AND "changedFields"->>'jobId'=OLD.id AND "changedFields"->>'notActuallyProduced'='true'
        AND "changedFields"->>'rejectedRevision'=OLD.revision::text
        AND "changedFields"->>'workerId'=OLD."workerId" AND "changedFields"->>'workDate'=OLD."workDate"::text) THEN
        RAISE EXCEPTION 'Requested production requires matching no-production rejection evidence';
      END IF;
    ELSIF NEW.status NOT IN ('REQUESTED','COMPLETED') OR NEW."workDate" IS DISTINCT FROM OLD."workDate"
      OR NEW."requestedQty" IS DISTINCT FROM OLD."requestedQty" THEN
      RAISE EXCEPTION 'Quantity approval must preserve the original request and work date';
    END IF;
  END IF;
  IF NEW.status='REQUESTED' AND EXISTS (SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=NEW."workerId" AND "workDate"=NEW."workDate") THEN
    RAISE EXCEPTION 'New quantity requests cannot be written to a settled work date';
  END IF;
  IF NEW."workOrderVersion"=o."workOrderVersion" AND NEW.status IN ('PENDING','REQUESTED','COMPLETED') AND (
    EXISTS (SELECT 1 FROM "ProductionFactReview" r JOIN "ProductionJob" j ON j.id=r."jobId"
      WHERE j."orderId"=NEW."orderId" AND j.id<>NEW.id AND j."workOrderVersion"<NEW."workOrderVersion" AND r.status IN ('OPEN','CONFLICT'))
    OR EXISTS (SELECT 1 FROM "ProductionJob" j WHERE j."orderId"=NEW."orderId" AND j."workOrderVersion"<NEW."workOrderVersion" AND j.status='REQUESTED')) THEN
    RAISE EXCEPTION 'Resolve historical production facts before dependent production writes';
  END IF;
  RETURN NEW;
END $$;

-- A closed-day confirmation has a durable unpaid obligation, never a silent
-- successful completion with neither a wage nor an obligation. Deferred so both
-- rows can be written atomically in either order by the application service.
CREATE FUNCTION require_settled_production_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "ProductionJob";
BEGIN
  SELECT * INTO j FROM "ProductionJob" WHERE id=NEW.id;
  IF j.status='COMPLETED' AND j."operationId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "PieceworkSettlement" WHERE "reporterId"=j."workerId" AND "workDate"=j."workDate")
    AND NOT EXISTS (SELECT 1 FROM "ProductionWage" WHERE "jobId"=j.id AND "workerId"=j."workerId" AND "workDate"=j."workDate" AND "settlementId" IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM "ProductionFactReview" WHERE "jobId"=j.id AND status IN ('WAGES_DUE','DISMISSED') AND "jobRevision"=j.revision) THEN
    RAISE EXCEPTION 'Settled-day production requires its original wage or an unpaid obligation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ProductionJob_settled_obligation" AFTER INSERT OR UPDATE ON "ProductionJob"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settled_production_obligation();
