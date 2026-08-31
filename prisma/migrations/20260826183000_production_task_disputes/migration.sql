CREATE TYPE "ProductionTaskDisputeStatus" AS ENUM (
  'PENDING',
  'RESOLVED',
  'REJECTED'
);

CREATE TABLE "ProductionTaskDispute" (
  "id" TEXT NOT NULL,
  "productionTaskId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "status" "ProductionTaskDisputeStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "resolution" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductionTaskDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionTaskDispute_reason_check"
    CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000),
  CONSTRAINT "ProductionTaskDispute_resolution_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "resolution" IS NULL
        AND "resolvedById" IS NULL
        AND "resolvedAt" IS NULL
      )
      OR
      (
        "status" IN ('RESOLVED', 'REJECTED')
        AND char_length(btrim("resolution")) BETWEEN 2 AND 1000
        AND "resolvedById" IS NOT NULL
        AND "resolvedAt" IS NOT NULL
      )
    )
);

ALTER TABLE "ProductionTaskDispute"
  ADD CONSTRAINT "ProductionTaskDispute_productionTaskId_fkey"
  FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionTaskDispute"
  ADD CONSTRAINT "ProductionTaskDispute_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionTaskDispute"
  ADD CONSTRAINT "ProductionTaskDispute_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProductionTaskDispute_productionTaskId_createdAt_idx"
  ON "ProductionTaskDispute"("productionTaskId", "createdAt" DESC);
CREATE INDEX "ProductionTaskDispute_workerId_createdAt_idx"
  ON "ProductionTaskDispute"("workerId", "createdAt" DESC);
CREATE INDEX "ProductionTaskDispute_status_createdAt_idx"
  ON "ProductionTaskDispute"("status", "createdAt");
CREATE INDEX "ProductionTaskDispute_resolvedById_idx"
  ON "ProductionTaskDispute"("resolvedById");

CREATE UNIQUE INDEX "ProductionTaskDispute_one_pending_per_task_key"
  ON "ProductionTaskDispute"("productionTaskId")
  WHERE "status" = 'PENDING';

CREATE FUNCTION prevent_production_task_dispute_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ProductionTaskDispute records are audit history and cannot be deleted';
END;
$$;

CREATE TRIGGER "ProductionTaskDispute_prevent_delete"
BEFORE DELETE ON "ProductionTaskDispute"
FOR EACH ROW
EXECUTE FUNCTION prevent_production_task_dispute_delete();

CREATE FUNCTION protect_production_task_dispute_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Resolved ProductionTaskDispute records are immutable';
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."productionTaskId" <> OLD."productionTaskId"
     OR NEW."workerId" <> OLD."workerId"
     OR NEW."reason" <> OLD."reason"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'ProductionTaskDispute identity and reason are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionTaskDispute_protect_history"
BEFORE UPDATE ON "ProductionTaskDispute"
FOR EACH ROW
EXECUTE FUNCTION protect_production_task_dispute_history();
