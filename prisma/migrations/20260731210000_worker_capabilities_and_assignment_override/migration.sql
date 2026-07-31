-- Separate a worker's primary machine from all machines they can safely run.
ALTER TABLE "User"
ADD COLUMN "machineCapabilities" "MachineType"[] NOT NULL DEFAULT ARRAY[]::"MachineType"[];

UPDATE "User"
SET "machineCapabilities" = ARRAY["machineType"]::"MachineType"[]
WHERE "role" = 'WORKER'
  AND "workerType" = 'MACHINE'
  AND "machineType" IS NOT NULL;

CREATE TABLE "WorkerCraftCapability" (
    "workerId" TEXT NOT NULL,
    "craftId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerCraftCapability_pkey" PRIMARY KEY ("workerId", "craftId")
);

CREATE INDEX "WorkerCraftCapability_craftId_idx"
ON "WorkerCraftCapability"("craftId");

ALTER TABLE "WorkerCraftCapability"
ADD CONSTRAINT "WorkerCraftCapability_workerId_fkey"
FOREIGN KEY ("workerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkerCraftCapability"
ADD CONSTRAINT "WorkerCraftCapability_craftId_fkey"
FOREIGN KEY ("craftId") REFERENCES "Craft"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve current production behavior: every active worker/craft pair that
-- was assignable before this migration becomes an initial recommended pair.
INSERT INTO "WorkerCraftCapability" ("workerId", "craftId")
SELECT u."id", c."id"
FROM "User" u
CROSS JOIN "Craft" c
WHERE u."role" = 'WORKER'
  AND u."isActive" = TRUE
  AND c."isActive" = TRUE
  AND c."defaultWorkerType" IS NOT NULL
  AND c."defaultWorkerType" <> 'COOK'
  AND u."workerType" = c."defaultWorkerType"
  AND (
    c."defaultWorkerType" <> 'MACHINE'
    OR (
      cardinality(c."inHouseMachineTypes") > 0
      AND u."machineType" = ANY(c."inHouseMachineTypes")
    )
    OR (
      cardinality(c."inHouseMachineTypes") = 0
      AND u."machineType" = c."defaultMachineType"
    )
  )
  AND (c."isOutsource" = FALSE OR cardinality(c."inHouseMachineTypes") > 0)
ON CONFLICT DO NOTHING;
