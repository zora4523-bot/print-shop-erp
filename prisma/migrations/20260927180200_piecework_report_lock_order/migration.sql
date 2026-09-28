-- Direct SQL and normal reporting must enter the order boundary before the
-- shared publication boundary. Reversals/adjustments also take this order lock:
-- wage review already holds it before the operation row and reporting-day locks.
-- Taking publication first could deadlock against a normal report holding its
-- order lock when an exclusive publication/cancellation is queued in between.
CREATE OR REPLACE FUNCTION coordinate_piecework_report_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id TEXT;
BEGIN
  SELECT "orderId" INTO order_id FROM "ProductionOperation" WHERE id=NEW."operationId";
  IF order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || order_id));
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('print-shop-erp:piecework-price-book:publish'));
  IF EXISTS (SELECT 1 FROM "PieceworkPriceBook" WHERE (id=NEW."priceBookId" OR id=NEW.snapshot #>> '{payroll,policyBookId}') AND status='CANCELLED')
    OR (NEW."entryType" NOT IN ('REVERSAL','ADJUSTMENT') AND NEW.snapshot #>> '{payroll,policyBookId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceBook" WHERE id=NEW.snapshot #>> '{payroll,policyBookId}' AND status='PUBLISHED'
        AND "workerId"=NEW."reporterId" AND "effectiveFrom" <= NEW."reportedAt" AND ("effectiveTo" IS NULL OR "effectiveTo" > NEW."reportedAt")
    ))
  THEN RAISE EXCEPTION 'Production report cannot reference a cancelled or inapplicable piecework policy'; END IF;
  RETURN NEW;
END; $$;

-- Make the independent shape check fail closed on SQL NULL as well as false.
ALTER TABLE "PieceworkCancellation" DROP CONSTRAINT "PieceworkCancellation_shape_check";
ALTER TABLE "PieceworkCancellation" ADD CONSTRAINT "PieceworkCancellation_shape_check" CHECK ((
  length(btrim(reason)) BETWEEN 2 AND 500 AND "requestHash" ~ '^[0-9a-f]{64}$'
  AND ("targetEffectiveTo" IS NULL OR "targetEffectiveTo" > "targetEffectiveFrom")
  AND (("predecessorBookId" IS NULL AND "predecessorPreviousTo" IS NULL AND "predecessorNewTo" IS NULL AND "predecessorUpdatedAt" IS NULL)
    OR ("predecessorBookId" IS NOT NULL AND "predecessorPreviousTo" = "targetEffectiveFrom" AND "predecessorUpdatedAt" IS NOT NULL AND "predecessorNewTo" IS NOT DISTINCT FROM "targetEffectiveTo"))
  AND (("successorBookId" IS NULL AND "targetEffectiveTo" IS NULL AND "successorEffectiveFrom" IS NULL AND "successorEffectiveTo" IS NULL AND "successorUpdatedAt" IS NULL)
    OR ("successorBookId" IS NOT NULL AND "targetEffectiveTo" IS NOT NULL AND "successorEffectiveFrom" = "targetEffectiveTo" AND "successorUpdatedAt" IS NOT NULL))
) IS TRUE);
