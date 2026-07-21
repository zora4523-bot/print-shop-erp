-- Production scheduling integrity:
-- 1. snapshot whether an order has outsource work;
-- 2. model the worker type required by each internal craft and snapshot it on tasks;
-- 3. prevent duplicate tasks for the same order-item/craft pair.

ALTER TABLE "Order"
ADD COLUMN "requiresOutsource" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Craft"
ADD COLUMN "defaultWorkerType" "WorkerType";

ALTER TABLE "ProductionTask"
ADD COLUMN "workerType" "WorkerType";

-- Machine crafts are handled by machine workers. The two built-in manual
-- production crafts have dedicated hourly-worker types. Outsource crafts do
-- not create internal tasks, so their worker type remains NULL.
UPDATE "Craft"
SET "defaultWorkerType" = CASE
  WHEN "isOutsource" THEN NULL
  WHEN "code" = 'PACKING' THEN 'PACKER'::"WorkerType"
  WHEN "code" = 'CLEANING' THEN 'CLEANER'::"WorkerType"
  WHEN "defaultMachineType" IS NOT NULL THEN 'MACHINE'::"WorkerType"
  ELSE NULL
END;

-- Preserve the worker category that governed every existing assignment.
UPDATE "ProductionTask" AS task
SET "workerType" = COALESCE(
  worker."workerType",
  CASE
    WHEN task."machineType" IS NOT NULL THEN 'MACHINE'::"WorkerType"
    ELSE NULL
  END
)
FROM "User" AS worker
WHERE worker."id" = task."workerId";

UPDATE "ProductionTask"
SET "workerType" = 'MACHINE'::"WorkerType"
WHERE "workerType" IS NULL AND "machineType" IS NOT NULL;

-- Existing orders need the same outsource gate as newly scheduled orders.
UPDATE "Order" AS target
SET "requiresOutsource" = EXISTS (
  SELECT 1
  FROM "OrderItem" AS item
  JOIN "Craft" AS craft ON craft."id" = ANY(item."crafts")
  WHERE item."orderId" = target."id"
    AND craft."isOutsource" = true
);

-- The pre-migration audit found no duplicates. Keep the database as the last
-- line of defence against two task rows for one item/craft combination.
CREATE UNIQUE INDEX "ProductionTask_orderItemId_craftId_key"
ON "ProductionTask"("orderItemId", "craftId");
