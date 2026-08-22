CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'TEMPORARY');
CREATE TYPE "OrderChangeRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'STALE'
);
CREATE TYPE "CsSalesEntryType" AS ENUM (
  'ORDER_SUBMITTED',
  'ORDER_CHANGED',
  'ORDER_CANCELLED',
  'MANUAL_ADJUSTMENT'
);
CREATE TYPE "OrderCostCategory" AS ENUM (
  'MATERIAL',
  'PIECEWORK',
  'SETUP',
  'OUTSOURCE',
  'SHIPPING',
  'MEAL',
  'ELECTRICITY',
  'CUSTOM',
  'ADJUSTMENT'
);

ALTER TABLE "User"
  ADD COLUMN "employmentType" "EmploymentType",
  ADD COLUMN "employmentStartDate" DATE,
  ADD COLUMN "employmentEndDate" DATE;

UPDATE "User"
SET
  "employmentType" = 'FULL_TIME'::"EmploymentType",
  "employmentStartDate" = "createdAt"::date
WHERE "isActive" = true
  AND "role" <> 'ADMIN'::"Role";

ALTER TABLE "Order"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "OrderShipment"
  ADD COLUMN "weightKg" DECIMAL(10, 3);

ALTER TABLE "OrderShipment"
  ADD CONSTRAINT "OrderShipment_weightKg_nonnegative"
  CHECK ("weightKg" IS NULL OR "weightKg" >= 0);

ALTER TABLE "Craft"
  ADD COLUMN "inHouseMachineTypes" "MachineType"[] NOT NULL DEFAULT ARRAY[]::"MachineType"[];

UPDATE "Craft"
SET
  "defaultWorkerType" = 'MACHINE'::"WorkerType",
  "inHouseMachineTypes" = ARRAY[
    'HAND_PRESS'::"MachineType",
    'WINDMILL'::"MachineType"
  ]
WHERE "code" IN ('COLOR_PRINT_FOIL', 'COATED_COLOR_PRINT_FOIL');

UPDATE "SalaryRule"
SET
  "ruleValue" = "ruleValue" || jsonb_build_object(
    'smallOrderInclusive', true,
    'largeOrderSetupFee', 10
  ),
  "remark" = '风车机师傅计件规则（1000 个及以下 20 元；以上每个 0.01 元 + 装板 10 元）'
WHERE "ruleType" = 'WORKER_MACHINE'::"SalaryRuleType"
  AND "ruleKey" = 'WINDMILL'
  AND "effectiveTo" IS NULL;

CREATE TABLE "OrderChangeRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "status" "OrderChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "proposedChanges" JSONB NOT NULL,
  "reviewedById" TEXT,
  "reviewRemark" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderChangeRequest_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderChangeRequest_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderChangeRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OrderChangeRequest_orderId_status_createdAt_idx"
  ON "OrderChangeRequest"("orderId", "status", "createdAt");
CREATE INDEX "OrderChangeRequest_requesterId_createdAt_idx"
  ON "OrderChangeRequest"("requesterId", "createdAt");
CREATE INDEX "OrderChangeRequest_status_createdAt_idx"
  ON "OrderChangeRequest"("status", "createdAt");
CREATE UNIQUE INDEX "OrderChangeRequest_one_pending_per_order"
  ON "OrderChangeRequest"("orderId")
  WHERE "status" = 'PENDING'::"OrderChangeRequestStatus";

ALTER TABLE "Attendance"
  ADD COLUMN "workUnits" DECIMAL(2, 1) NOT NULL DEFAULT 1,
  ADD COLUMN "leaveUnits" DECIMAL(2, 1) NOT NULL DEFAULT 0,
  ADD COLUMN "leaveType" TEXT;

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_workUnits_half_day"
  CHECK ("workUnits" IN (0, 0.5, 1)),
  ADD CONSTRAINT "Attendance_leaveUnits_half_day"
  CHECK ("leaveUnits" IN (0, 0.5, 1)),
  ADD CONSTRAINT "Attendance_day_units_limit"
  CHECK ("workUnits" + "leaveUnits" <= 1);

CREATE TABLE "CsSalesEntry" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "csUserId" TEXT NOT NULL,
  "salaryPeriodId" TEXT NOT NULL,
  "orderId" TEXT,
  "orderRevision" INTEGER,
  "type" "CsSalesEntryType" NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CsSalesEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CsSalesEntry_csUserId_fkey"
    FOREIGN KEY ("csUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CsSalesEntry_salaryPeriodId_fkey"
    FOREIGN KEY ("salaryPeriodId") REFERENCES "SalaryPeriod"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CsSalesEntry_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CsSalesEntry_eventKey_key"
  ON "CsSalesEntry"("eventKey");
CREATE INDEX "CsSalesEntry_csUserId_createdAt_idx"
  ON "CsSalesEntry"("csUserId", "createdAt");
CREATE INDEX "CsSalesEntry_salaryPeriodId_createdAt_idx"
  ON "CsSalesEntry"("salaryPeriodId", "createdAt");
CREATE INDEX "CsSalesEntry_orderId_idx"
  ON "CsSalesEntry"("orderId");

CREATE TABLE "BillPayment" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT,
  "referenceNo" TEXT,
  "remark" TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillPayment_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "BillPayment_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "Bill"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillPayment_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BillPayment_billId_paidAt_idx"
  ON "BillPayment"("billId", "paidAt");
CREATE INDEX "BillPayment_recordedById_createdAt_idx"
  ON "BillPayment"("recordedById", "createdAt");

CREATE TABLE "OrderCostEntry" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "category" "OrderCostCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12, 3),
  "unit" TEXT,
  "unitPrice" DECIMAL(12, 4),
  "amount" DECIMAL(12, 2) NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "remark" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderCostEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderCostEntry_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderCostEntry_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OrderCostEntry_orderId_category_createdAt_idx"
  ON "OrderCostEntry"("orderId", "category", "createdAt");
CREATE INDEX "OrderCostEntry_sourceType_sourceId_idx"
  ON "OrderCostEntry"("sourceType", "sourceId");
CREATE INDEX "OrderCostEntry_createdById_createdAt_idx"
  ON "OrderCostEntry"("createdById", "createdAt");
