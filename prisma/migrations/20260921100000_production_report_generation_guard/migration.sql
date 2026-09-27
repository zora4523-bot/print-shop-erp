-- New production facts must belong to the current order generation.
-- Reports reference their parent generation; they have no order/version columns.
-- Historical REVERSAL/ADJUSTMENT entries remain protected by the existing
-- anchor, administrator and settlement guards and must remain possible.
CREATE OR REPLACE FUNCTION validate_report_current_production_generation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_id TEXT;
  parent_version INTEGER;
  current_version INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ProductionReport' THEN
    IF NEW."entryType" <> 'REPORT' THEN RETURN NEW; END IF;
    SELECT "orderId" INTO order_id FROM "ProductionOperation" WHERE id = NEW."operationId";
  ELSE
    SELECT "orderId" INTO order_id FROM "ProductionProgressStep" WHERE id = NEW."progressStepId";
  END IF;
  IF order_id IS NULL THEN
    RAISE EXCEPTION 'Production report must match current work-order version';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || order_id));
  IF TG_TABLE_NAME = 'ProductionReport' THEN
    SELECT "workOrderVersion" INTO parent_version FROM "ProductionOperation" WHERE id = NEW."operationId";
  ELSE
    SELECT "workOrderVersion" INTO parent_version FROM "ProductionProgressStep" WHERE id = NEW."progressStepId";
  END IF;
  SELECT "workOrderVersion" INTO current_version FROM "Order" WHERE id = order_id;
  IF current_version IS NULL OR parent_version IS DISTINCT FROM current_version THEN
    RAISE EXCEPTION 'Production report must match current work-order version';
  END IF;
  RETURN NEW;
END;
$$;

-- Alphabetic BEFORE-trigger ordering: take the order lock before the existing
-- ProductionReport_00_foil_wage trigger locks the operation row.
DROP TRIGGER IF EXISTS "ProductionReport_00_current_generation" ON "ProductionReport";
CREATE TRIGGER "ProductionReport_00_current_generation"
BEFORE INSERT ON "ProductionReport"
FOR EACH ROW EXECUTE FUNCTION validate_report_current_production_generation();

DROP TRIGGER IF EXISTS "ProductionProgressReport_00_current_generation" ON "ProductionProgressReport";
CREATE TRIGGER "ProductionProgressReport_00_current_generation"
BEFORE INSERT ON "ProductionProgressReport"
FOR EACH ROW EXECUTE FUNCTION validate_report_current_production_generation();
