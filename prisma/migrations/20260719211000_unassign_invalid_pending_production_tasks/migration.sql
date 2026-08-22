-- Older releases allowed any active WORKER to be assigned to any craft.
-- Do not guess a replacement during upgrade: detach only still-PENDING,
-- incompatible assignments and preserve the task for the administrator's new
-- reassignment workflow. Started/completed payroll history is never rewritten.
UPDATE "ProductionTask" AS task
SET
  "workerId" = NULL,
  "workerType" = craft."defaultWorkerType",
  "machineType" = craft."defaultMachineType"
FROM "Craft" AS craft, "User" AS worker
WHERE task."craftId" = craft."id"
  AND task."workerId" = worker."id"
  AND task."status" = 'PENDING'::"TaskStatus"
  AND (
    worker."role" <> 'WORKER'::"Role"
    OR worker."isActive" = false
    OR worker."workerType" IS DISTINCT FROM craft."defaultWorkerType"
    OR (
      craft."defaultWorkerType" = 'MACHINE'::"WorkerType"
      AND worker."machineType" IS DISTINCT FROM craft."defaultMachineType"
    )
  );
