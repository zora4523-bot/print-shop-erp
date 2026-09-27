-- A single future publication may be cancelled, preserving every published
-- fact except the predecessor's explicitly recorded restored end boundary.
CREATE TABLE "PieceworkCancellation" (
  "id" TEXT PRIMARY KEY,
  "clientRequestId" UUID NOT NULL,
  "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "workerId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetBookId" TEXT NOT NULL REFERENCES "PieceworkPriceBook"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetEffectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "targetEffectiveTo" TIMESTAMPTZ(3),
  "targetUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "predecessorBookId" TEXT REFERENCES "PieceworkPriceBook"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "predecessorPreviousTo" TIMESTAMPTZ(3),
  "predecessorNewTo" TIMESTAMPTZ(3),
  "predecessorUpdatedAt" TIMESTAMPTZ(3),
  "successorBookId" TEXT REFERENCES "PieceworkPriceBook"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "successorEffectiveFrom" TIMESTAMPTZ(3),
  "successorEffectiveTo" TIMESTAMPTZ(3),
  "successorUpdatedAt" TIMESTAMPTZ(3),
  "reason" TEXT NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  CONSTRAINT "PieceworkCancellation_shape_check" CHECK (
    length(btrim(reason)) BETWEEN 2 AND 500 AND "requestHash" ~ '^[0-9a-f]{64}$'
    AND ("targetEffectiveTo" IS NULL OR "targetEffectiveTo" > "targetEffectiveFrom")
    AND (("predecessorBookId" IS NULL AND "predecessorPreviousTo" IS NULL AND "predecessorNewTo" IS NULL AND "predecessorUpdatedAt" IS NULL)
      OR ("predecessorBookId" IS NOT NULL AND "predecessorPreviousTo" = "targetEffectiveFrom" AND "predecessorUpdatedAt" IS NOT NULL AND "predecessorNewTo" IS NOT DISTINCT FROM "targetEffectiveTo"))
    AND (("successorBookId" IS NULL AND "targetEffectiveTo" IS NULL AND "successorEffectiveFrom" IS NULL AND "successorEffectiveTo" IS NULL AND "successorUpdatedAt" IS NULL)
      OR ("successorBookId" IS NOT NULL AND "targetEffectiveTo" IS NOT NULL AND "successorEffectiveFrom" = "targetEffectiveTo" AND "successorUpdatedAt" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "PieceworkCancellation_actorId_clientRequestId_key" ON "PieceworkCancellation"("actorId", "clientRequestId");
CREATE UNIQUE INDEX "PieceworkCancellation_targetBookId_key" ON "PieceworkCancellation"("targetBookId");
CREATE INDEX "PieceworkCancellation_workerId_createdAt_idx" ON "PieceworkCancellation"("workerId", "createdAt");

ALTER TABLE "PieceworkPriceBook"
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancellationId" TEXT REFERENCES "PieceworkCancellation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PieceworkPriceBook_cancellationId_key" ON "PieceworkPriceBook"("cancellationId");
ALTER TABLE "PieceworkPriceBook" DROP CONSTRAINT "PieceworkPriceBook_publication_shape_check";
ALTER TABLE "PieceworkPriceBook" ADD CONSTRAINT "PieceworkPriceBook_publication_shape_check" CHECK ((
  (status = 'DRAFT' AND "effectiveTo" IS NULL AND "publishedById" IS NULL AND "publishedAt" IS NULL
    AND "manifestSha256" IS NULL AND "ruleSetSha256" IS NULL
    AND ("publishNote" IS NULL OR length("publishNote") <= 500)
    AND ("sourceName" IS NULL OR length("sourceName") <= 500)
    AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL AND "cancellationId" IS NULL)
  OR
  (status IN ('PUBLISHED', 'CANCELLED') AND "effectiveFrom" IS NOT NULL
    AND "publishedById" IS NOT NULL AND "publishedAt" IS NOT NULL AND "sourceName" IS NOT NULL
    AND "sourceSha256" IS NOT NULL AND "manifestSha256" IS NOT NULL AND "ruleSetSha256" IS NOT NULL
    AND "publishNote" IS NOT NULL AND length(btrim("publishNote")) BETWEEN 2 AND 500
    AND ((status = 'PUBLISHED' AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL AND "cancellationId" IS NULL)
      OR (status = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancellationId" IS NOT NULL
        AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) BETWEEN 2 AND 500)))
) IS TRUE);

CREATE FUNCTION validate_piecework_cancellation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "PieceworkPriceBook"; p "PieceworkPriceBook"; n "PieceworkPriceBook";
BEGIN
  IF NEW."workerId" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:salary-identity:' || NEW."workerId"));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'));
  SELECT * INTO s FROM "PieceworkPriceBook" WHERE id=NEW."targetBookId";
  IF s.id IS NULL OR s.status <> 'PUBLISHED' OR s."workerId" IS DISTINCT FROM NEW."workerId"
    OR s."effectiveFrom" IS DISTINCT FROM NEW."targetEffectiveFrom" OR s."effectiveTo" IS DISTINCT FROM NEW."targetEffectiveTo"
    OR s."updatedAt" IS DISTINCT FROM NEW."targetUpdatedAt" OR s."effectiveFrom" <= clock_timestamp()
    OR NEW."createdTransactionId" <> txid_current() OR NEW."createdAt" > clock_timestamp()
    OR EXISTS (SELECT 1 FROM "ProductionReport" WHERE "priceBookId"=s.id OR snapshot #>> '{payroll,policyBookId}'=s.id)
  THEN RAISE EXCEPTION 'Piecework cancellation target changed, effective or referenced' USING ERRCODE='23514'; END IF;
  -- No hidden gaps: the nearest surviving predecessor and successor are the
  -- only allowed neighbours. Earlier cancelled publications are historical.
  SELECT * INTO p FROM "PieceworkPriceBook" WHERE status='PUBLISHED' AND "workerId" IS NOT DISTINCT FROM s."workerId"
    AND "effectiveFrom" < s."effectiveFrom" ORDER BY "effectiveFrom" DESC LIMIT 1;
  SELECT * INTO n FROM "PieceworkPriceBook" WHERE status='PUBLISHED' AND "workerId" IS NOT DISTINCT FROM s."workerId"
    AND "effectiveFrom" > s."effectiveFrom" ORDER BY "effectiveFrom" LIMIT 1;
  IF p.id IS DISTINCT FROM NEW."predecessorBookId" OR n.id IS DISTINCT FROM NEW."successorBookId"
    OR (p.id IS NOT NULL AND (p.version >= s.version OR p."effectiveTo" IS DISTINCT FROM s."effectiveFrom"
      OR p."updatedAt" IS DISTINCT FROM NEW."predecessorUpdatedAt"
      OR p."effectiveTo" IS DISTINCT FROM NEW."predecessorPreviousTo" OR NEW."predecessorNewTo" IS DISTINCT FROM s."effectiveTo"))
    OR (p.id IS NULL AND (NEW."predecessorPreviousTo" IS NOT NULL OR NEW."predecessorNewTo" IS NOT NULL OR NEW."predecessorUpdatedAt" IS NOT NULL))
    OR (n.id IS NOT NULL AND (n.version <= s.version OR n."effectiveFrom" IS DISTINCT FROM s."effectiveTo"
      OR n."effectiveFrom" IS DISTINCT FROM NEW."successorEffectiveFrom" OR n."effectiveTo" IS DISTINCT FROM NEW."successorEffectiveTo" OR n."updatedAt" IS DISTINCT FROM NEW."successorUpdatedAt"))
    OR (n.id IS NULL AND (s."effectiveTo" IS NOT NULL OR NEW."successorEffectiveFrom" IS NOT NULL OR NEW."successorEffectiveTo" IS NOT NULL OR NEW."successorUpdatedAt" IS NOT NULL))
  THEN RAISE EXCEPTION 'Piecework cancellation neighbours changed or have a gap' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "PieceworkCancellation_validate_insert" BEFORE INSERT ON "PieceworkCancellation" FOR EACH ROW EXECUTE FUNCTION validate_piecework_cancellation_insert();
CREATE FUNCTION protect_piecework_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Piecework cancellation facts are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER "PieceworkCancellation_immutable" BEFORE UPDATE OR DELETE ON "PieceworkCancellation" FOR EACH ROW EXECUTE FUNCTION protect_piecework_cancellation();

CREATE OR REPLACE FUNCTION protect_piecework_price_book_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "PieceworkCancellation";
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status='CANCELLED' THEN RAISE EXCEPTION 'Piecework cancellation requires an existing published target' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='CANCELLED' OR (TG_OP='DELETE' AND OLD.status='PUBLISHED') THEN
    RAISE EXCEPTION 'Published or cancelled PieceworkPriceBook rows are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.id <> OLD.id OR NEW.version <> OLD.version THEN RAISE EXCEPTION 'PieceworkPriceBook identity is immutable'; END IF;
  IF OLD.status='PUBLISHED' THEN
    IF NEW.status='CANCELLED' THEN
      SELECT * INTO c FROM "PieceworkCancellation" WHERE id=NEW."cancellationId";
      IF c.id IS NULL OR c."createdTransactionId" <> txid_current() OR c."targetBookId" <> OLD.id
        OR c."targetUpdatedAt" IS DISTINCT FROM OLD."updatedAt" OR c."workerId" IS DISTINCT FROM OLD."workerId"
        OR c."targetEffectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" OR c."targetEffectiveTo" IS DISTINCT FROM OLD."effectiveTo"
        OR c."createdAt" IS DISTINCT FROM NEW."cancelledAt" OR c."actorId" IS DISTINCT FROM NEW."cancelledById" OR c.reason IS DISTINCT FROM NEW."cancelReason"
        OR OLD."effectiveFrom" <= clock_timestamp() OR NEW."updatedAt" <= OLD."updatedAt"
        OR (to_jsonb(NEW)-ARRAY['status','cancelledAt','cancelledById','cancelReason','cancellationId','updatedAt']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','cancelledAt','cancelledById','cancelReason','cancellationId','updatedAt'])
        OR EXISTS (SELECT 1 FROM "ProductionReport" WHERE "priceBookId"=OLD.id OR snapshot #>> '{payroll,policyBookId}'=OLD.id)
      THEN RAISE EXCEPTION 'Piecework cancellation requires matching current facts' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    IF NEW.status <> 'PUBLISHED' OR (to_jsonb(NEW)-'effectiveTo'-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'effectiveTo'-'updatedAt') THEN
      RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable';
    END IF;
    SELECT * INTO c FROM "PieceworkCancellation" WHERE "predecessorBookId"=OLD.id
      AND "createdTransactionId"=txid_current() AND "predecessorPreviousTo" IS NOT DISTINCT FROM OLD."effectiveTo"
      AND "predecessorNewTo" IS NOT DISTINCT FROM NEW."effectiveTo" AND "predecessorUpdatedAt" IS NOT DISTINCT FROM OLD."updatedAt";
    IF c.id IS NOT NULL THEN
      IF NEW."updatedAt" <= OLD."updatedAt" OR NOT EXISTS (SELECT 1 FROM "PieceworkPriceBook" WHERE id=c."targetBookId" AND status='CANCELLED' AND "cancellationId"=c.id) THEN
        RAISE EXCEPTION 'Piecework cancellation must precede predecessor restoration' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Preserve the pre-existing prospective successor-publication exception.
    IF OLD."effectiveTo" IS NOT NULL OR NEW."effectiveTo" IS NULL OR NEW."effectiveTo" < CURRENT_TIMESTAMP OR NEW."effectiveTo" <= OLD."effectiveFrom"
      OR EXISTS (SELECT 1 FROM "ProductionReport" WHERE ("priceBookId"=OLD.id OR snapshot #>> '{payroll,policyBookId}'=OLD.id) AND "reportedAt" >= NEW."effectiveTo")
    THEN RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable'; END IF;
  ELSIF NEW.status='CANCELLED' THEN
    RAISE EXCEPTION 'Piecework cancellation requires a published target' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER "PieceworkPriceBook_protect_history" ON "PieceworkPriceBook";
CREATE TRIGGER "PieceworkPriceBook_protect_history" BEFORE INSERT OR UPDATE OR DELETE ON "PieceworkPriceBook" FOR EACH ROW EXECUTE FUNCTION protect_piecework_price_book_history();

CREATE FUNCTION check_piecework_cancellation_complete(operation_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c "PieceworkCancellation"; s "PieceworkPriceBook"; p "PieceworkPriceBook"; n "PieceworkPriceBook";
BEGIN
  SELECT * INTO c FROM "PieceworkCancellation" WHERE id=operation_id;
  SELECT * INTO s FROM "PieceworkPriceBook" WHERE id=c."targetBookId";
  IF c.id IS NULL OR c."createdTransactionId" <> txid_current() OR s.status IS DISTINCT FROM 'CANCELLED' OR s."cancellationId" IS DISTINCT FROM c.id
    OR s."effectiveFrom" IS DISTINCT FROM c."targetEffectiveFrom" OR s."effectiveTo" IS DISTINCT FROM c."targetEffectiveTo"
    OR s."cancelledAt" IS DISTINCT FROM c."createdAt" OR s."cancelledById" IS DISTINCT FROM c."actorId" OR s."cancelReason" IS DISTINCT FROM c.reason
    OR c."targetEffectiveFrom" <= clock_timestamp()
    OR EXISTS (SELECT 1 FROM "ProductionReport" WHERE "priceBookId"=s.id OR snapshot #>> '{payroll,policyBookId}'=s.id)
  THEN RAISE EXCEPTION 'Piecework cancellation is incomplete, effective or referenced at commit' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM "PieceworkPriceBook" WHERE status='PUBLISHED' AND "workerId" IS NOT DISTINCT FROM c."workerId"
    AND "effectiveFrom" < c."targetEffectiveFrom" ORDER BY "effectiveFrom" DESC LIMIT 1;
  SELECT * INTO n FROM "PieceworkPriceBook" WHERE status='PUBLISHED' AND "workerId" IS NOT DISTINCT FROM c."workerId"
    AND "effectiveFrom" > c."targetEffectiveFrom" ORDER BY "effectiveFrom" LIMIT 1;
  IF p.id IS DISTINCT FROM c."predecessorBookId" OR n.id IS DISTINCT FROM c."successorBookId"
    OR (p.id IS NOT NULL AND (p."effectiveTo" IS DISTINCT FROM c."predecessorNewTo" OR p."updatedAt" <= c."predecessorUpdatedAt"))
    OR (n.id IS NOT NULL AND (n."effectiveFrom" IS DISTINCT FROM c."successorEffectiveFrom" OR n."effectiveTo" IS DISTINCT FROM c."successorEffectiveTo" OR n."updatedAt" IS DISTINCT FROM c."successorUpdatedAt"))
  THEN RAISE EXCEPTION 'Piecework cancellation predecessor/successor restoration incomplete' USING ERRCODE='23514'; END IF;
END; $$;
CREATE FUNCTION require_piecework_cancellation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='PieceworkCancellation' THEN PERFORM check_piecework_cancellation_complete(NEW.id);
  ELSIF NEW.status='CANCELLED' THEN PERFORM check_piecework_cancellation_complete(NEW."cancellationId"); END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "PieceworkCancellation_require_complete" AFTER INSERT ON "PieceworkCancellation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_piecework_cancellation_complete();
CREATE CONSTRAINT TRIGGER "PieceworkPriceBook_require_cancellation" AFTER INSERT OR UPDATE ON "PieceworkPriceBook" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_piecework_cancellation_complete();

CREATE OR REPLACE FUNCTION require_piecework_successor_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation_id TEXT;
BEGIN
  IF OLD.status='PUBLISHED' AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    SELECT id INTO operation_id FROM "PieceworkCancellation" WHERE "predecessorBookId"=OLD.id AND "createdTransactionId"=txid_current()
      AND "predecessorPreviousTo" IS NOT DISTINCT FROM OLD."effectiveTo" AND "predecessorNewTo" IS NOT DISTINCT FROM NEW."effectiveTo";
    IF operation_id IS NOT NULL THEN PERFORM check_piecework_cancellation_complete(operation_id); END IF;
    IF NEW."effectiveTo" IS NULL THEN
      IF operation_id IS NULL THEN RAISE EXCEPTION 'Reopening a piecework price book requires a valid tail cancellation'; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM "PieceworkPriceBook" successor WHERE successor.status='PUBLISHED' AND successor.version > OLD.version
      AND successor."workerId" IS NOT DISTINCT FROM OLD."workerId" AND successor."effectiveFrom"=NEW."effectiveTo") THEN
      RAISE EXCEPTION 'Closing a piecework price book requires its published successor';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION protect_published_piecework_price_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "PieceworkPriceBook" WHERE id=OLD."priceBookId" AND status IN ('PUBLISHED','CANCELLED')))
    OR (TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "PieceworkPriceBook" WHERE id=NEW."priceBookId" AND status IN ('PUBLISHED','CANCELLED')))
  THEN RAISE EXCEPTION 'Published or cancelled PieceworkPriceRule rows are immutable'; END IF;
  RETURN COALESCE(NEW,OLD);
END; $$;

-- Coordinate direct SQL reporting too; normal reporting already owns this
-- shared publication lock after the salary identity lock. The existing pricing
-- validator remains intact, including payroll amounts and reversal checks.
CREATE FUNCTION coordinate_piecework_report_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('print-shop-erp:piecework-price-book:publish'));
  IF EXISTS (SELECT 1 FROM "PieceworkPriceBook" WHERE (id=NEW."priceBookId" OR id=NEW.snapshot #>> '{payroll,policyBookId}') AND status='CANCELLED')
    OR (NEW."entryType" NOT IN ('REVERSAL','ADJUSTMENT') AND NEW.snapshot #>> '{payroll,policyBookId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceBook" WHERE id=NEW.snapshot #>> '{payroll,policyBookId}' AND status='PUBLISHED'
        AND "workerId"=NEW."reporterId" AND "effectiveFrom" <= NEW."reportedAt" AND ("effectiveTo" IS NULL OR "effectiveTo" > NEW."reportedAt")
    ))
  THEN RAISE EXCEPTION 'Production report cannot reference a cancelled or inapplicable piecework policy'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ProductionReport_00_coordinate_publication" BEFORE INSERT ON "ProductionReport" FOR EACH ROW EXECUTE FUNCTION coordinate_piecework_report_publication();
