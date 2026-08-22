-- Piecework payroll audit trail: worker-specific versioned rules, immutable
-- task-level daily ledgers, and append-only manual adjustments.

CREATE TYPE "SalaryAdjustmentType" AS ENUM ('BONUS', 'DEDUCTION', 'CORRECTION');

ALTER TABLE "DailyWorkerSalary"
  ADD COLUMN "adjustmentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE "WorkerMachineSalaryRule" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "machineType" "MachineType" NOT NULL,
  "ruleValue" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "remark" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerMachineSalaryRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyWorkerSalaryItem" (
  "id" TEXT NOT NULL,
  "dailySalaryId" TEXT NOT NULL,
  "productionTaskId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "orderItemName" TEXT NOT NULL,
  "craftId" TEXT NOT NULL,
  "craftName" TEXT NOT NULL,
  "machineType" "MachineType" NOT NULL,
  "completedQty" INTEGER NOT NULL,
  "defectQty" INTEGER NOT NULL,
  "reworkQty" INTEGER NOT NULL,
  "boardCount" INTEGER NOT NULL,
  "pressCount" INTEGER NOT NULL,
  "pieceworkAmount" DECIMAL(10,2) NOT NULL,
  "salaryRuleSnapshot" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyWorkerSalaryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalaryAdjustment" (
  "id" TEXT NOT NULL,
  "dailySalaryId" TEXT NOT NULL,
  "type" "SalaryAdjustmentType" NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalaryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerMachineSalaryRule_workerId_machineType_effectiveFrom__idx"
  ON "WorkerMachineSalaryRule"("workerId", "machineType", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "WorkerMachineSalaryRule_workerId_machineType_effectiveFrom_key"
  ON "WorkerMachineSalaryRule"("workerId", "machineType", "effectiveFrom");
CREATE UNIQUE INDEX "DailyWorkerSalaryItem_productionTaskId_key"
  ON "DailyWorkerSalaryItem"("productionTaskId");
CREATE INDEX "DailyWorkerSalaryItem_dailySalaryId_idx"
  ON "DailyWorkerSalaryItem"("dailySalaryId");
CREATE INDEX "DailyWorkerSalaryItem_orderId_idx"
  ON "DailyWorkerSalaryItem"("orderId");
CREATE INDEX "DailyWorkerSalaryItem_completedAt_idx"
  ON "DailyWorkerSalaryItem"("completedAt");
CREATE INDEX "SalaryAdjustment_dailySalaryId_createdAt_idx"
  ON "SalaryAdjustment"("dailySalaryId", "createdAt");
CREATE INDEX "SalaryAdjustment_createdById_idx"
  ON "SalaryAdjustment"("createdById");

ALTER TABLE "WorkerMachineSalaryRule"
  ADD CONSTRAINT "WorkerMachineSalaryRule_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerMachineSalaryRule"
  ADD CONSTRAINT "WorkerMachineSalaryRule_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyWorkerSalaryItem"
  ADD CONSTRAINT "DailyWorkerSalaryItem_dailySalaryId_fkey"
  FOREIGN KEY ("dailySalaryId") REFERENCES "DailyWorkerSalary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyWorkerSalaryItem"
  ADD CONSTRAINT "DailyWorkerSalaryItem_productionTaskId_fkey"
  FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaryAdjustment"
  ADD CONSTRAINT "SalaryAdjustment_dailySalaryId_fkey"
  FOREIGN KEY ("dailySalaryId") REFERENCES "DailyWorkerSalary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryAdjustment"
  ADD CONSTRAINT "SalaryAdjustment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve auditability for salaries computed before this feature shipped.
-- Prisma stores DateTime as UTC wall-clock timestamps, while salary dates are
-- Shanghai calendar dates, so the bounds below explicitly convert both sides.
INSERT INTO "DailyWorkerSalaryItem" (
  "id", "dailySalaryId", "productionTaskId", "orderId", "orderNo",
  "orderItemId", "orderItemName", "craftId", "craftName", "machineType",
  "completedQty", "defectQty", "reworkQty", "boardCount", "pressCount",
  "pieceworkAmount", "salaryRuleSnapshot", "completedAt"
)
SELECT
  'legacy_' || md5(pt."id" || dws."id"),
  dws."id",
  pt."id",
  o."id",
  o."orderNo",
  oi."id",
  oi."name",
  c."id",
  c."name",
  pt."machineType",
  pt."completedQty",
  pt."defectQty",
  pt."reworkQty",
  pt."boardCount",
  pt."pressCount",
  pt."pieceworkAmount",
  COALESCE(pt."salaryRuleSnapshot", '{}'::jsonb),
  pt."completedAt"
FROM "DailyWorkerSalary" dws
JOIN "ProductionTask" pt
  ON pt."workerId" = dws."workerId"
  AND pt."status" = 'COMPLETED'
  AND pt."completedAt" IS NOT NULL
  AND pt."completedAt" >= (((dws."date"::date)::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC')
  AND pt."completedAt" < ((((dws."date"::date + 1)::timestamp) AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC')
JOIN "OrderItem" oi ON oi."id" = pt."orderItemId"
JOIN "Order" o ON o."id" = oi."orderId"
JOIN "Craft" c ON c."id" = pt."craftId"
WHERE pt."machineType" IS NOT NULL
ON CONFLICT ("productionTaskId") DO NOTHING;
