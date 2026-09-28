-- A resolved inclusion must account for the whole old request and cannot consume
-- more than the linked physical registration. Existing order locks serialize it.
CREATE FUNCTION guard_production_inclusion_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "ProductionJob"; later "ProductionJob"; included numeric;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='RESOLVED' AND OLD.evidence->>'resolution' IN ('INCLUDED_LATER','CONTINUED')
    AND (NEW.status<>OLD.status OR NEW.evidence IS DISTINCT FROM OLD.evidence) THEN
    RAISE EXCEPTION 'A continued or included production fact cannot become an independent missing registration';
  END IF;
  IF NEW.status<>'RESOLVED' OR NEW.evidence->>'resolution' IS DISTINCT FROM 'INCLUDED_LATER' THEN RETURN NEW; END IF;
  SELECT * INTO j FROM "ProductionJob" WHERE id=NEW."jobId";
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:order-cascade:' || j."orderId"));
  SELECT * INTO later FROM "ProductionJob" WHERE id=NEW.evidence->>'relatedJobId';
  IF NEW.evidence->>'quantity' IS NULL OR NEW.evidence->>'quantity' !~ '^[1-9][0-9]{0,9}$'
    OR later.id IS NULL OR later."orderId"<>j."orderId" OR later."workOrderVersion"<=j."workOrderVersion"
    OR later.status<>'COMPLETED' OR j.status<>'CANCELLED' OR later."workerId"<>j."workerId"
    OR later."workDate" IS DISTINCT FROM j."workDate" OR j."workDate" IS NULL
    OR j.snapshot->>'fingerprint' IS NULL OR j.snapshot->>'fingerprint' IS DISTINCT FROM later.snapshot->>'fingerprint'
    OR (j."requestedQty" IS NOT NULL AND (NEW.evidence->>'quantity')::numeric<>j."requestedQty") THEN
    RAISE EXCEPTION 'Historical inclusion requires the whole original quantity and matching completed evidence';
  END IF;
  SELECT COALESCE(sum((r.evidence->>'quantity')::numeric),0) INTO included
  FROM "ProductionFactReview" r WHERE r.id<>NEW.id AND r.status='RESOLVED'
    AND r.evidence->>'resolution'='INCLUDED_LATER' AND r.evidence->>'relatedJobId'=later.id;
  IF later."completedQty" IS NULL OR included+(NEW.evidence->>'quantity')::numeric>later."completedQty" THEN
    RAISE EXCEPTION 'Included historical quantities exceed the completed production';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProductionFactReview_validate_inclusion" BEFORE INSERT OR UPDATE ON "ProductionFactReview"
FOR EACH ROW EXECUTE FUNCTION guard_production_inclusion_evidence();
