-- Keep production history and prevent closing a work day with unapproved actual quantities.
CREATE FUNCTION forbid_production_job_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Production job history cannot be deleted; cancel or correct with an audit record';
END $$;
CREATE TRIGGER "ProductionJob_delete_guard" BEFORE DELETE ON "ProductionJob"
FOR EACH ROW EXECUTE FUNCTION forbid_production_job_delete();

CREATE FUNCTION protect_production_quantity_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-reporting-day:' || NEW."workDate"::text));
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-settlement:' || NEW."reporterId" || ':' || NEW."workDate"::text));
  IF EXISTS (SELECT 1 FROM "ProductionJob" WHERE "workerId"=NEW."reporterId" AND "workDate"=NEW."workDate" AND status='REQUESTED') THEN
    RAISE EXCEPTION 'Production quantity approval is pending for this work date';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PieceworkSettlement_quantity_guard" BEFORE INSERT ON "PieceworkSettlement"
FOR EACH ROW EXECUTE FUNCTION protect_production_quantity_settlement();
