-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'FOREMAN', 'SALES', 'CUSTOMER_SERVICE', 'WORKER');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('MACHINE', 'PACKER', 'CLEANER', 'COOK');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('HAND_PRESS', 'WINDMILL', 'GLUE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SCHEDULING', 'IN_PRODUCTION', 'COMPLETED', 'SHIPPED', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DesignFileType" AS ENUM ('IMAGE', 'CDR');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutsourceStatus" AS ENUM ('SENT', 'IN_PROGRESS', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('BLANK_STOCK', 'GENERIC_STOCK', 'CUSTOM_FLAT_FOIL', 'COLOR_PRINT', 'STOCK_FOIL_ADD', 'BYO_MATERIAL');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('PER_SHEET', 'PER_PIECE', 'PER_ORDER', 'PER_10K');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('PAPER', 'FOIL', 'BAG', 'FINISHED_STOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "TxDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "SalaryRuleType" AS ENUM ('CS_COMMISSION', 'WORKER_MACHINE', 'WORKER_HOURLY', 'COOK_SALARY');

-- CreateEnum
CREATE TYPE "SalaryPeriodStatus" AS ENUM ('IN_PROGRESS', 'SETTLED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIAL_PAID', 'FULLY_PAID');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SUCCESS', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "workerType" "WorkerType",
    "machineType" "MachineType",
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "avatar" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "submitterRole" "Role" NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "customerRef" TEXT,
    "receiverName" TEXT,
    "receiverPhone" TEXT,
    "receiverAddress" TEXT,
    "expressCode" TEXT,
    "packageRequirement" TEXT,
    "remark" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "trackingNo" TEXT,
    "submittedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "specification" TEXT,
    "paperType" TEXT,
    "quantity" INTEGER NOT NULL,
    "crafts" TEXT[],
    "foilColor" TEXT,
    "isDoubleSided" BOOLEAN NOT NULL DEFAULT false,
    "isDoubleColor" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "suggestedPrice" DECIMAL(12,2),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemDesign" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "fileType" "DesignFileType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "thumbnailUrl" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedFields" JSONB,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "craftId" TEXT NOT NULL,
    "workerId" TEXT,
    "machineType" "MachineType",
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "plannedQty" INTEGER NOT NULL,
    "boardCount" INTEGER NOT NULL DEFAULT 0,
    "pressCount" INTEGER NOT NULL DEFAULT 0,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "defectQty" INTEGER NOT NULL DEFAULT 0,
    "reworkQty" INTEGER NOT NULL DEFAULT 0,
    "pieceworkAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "salaryRuleSnapshot" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutsourceOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemIds" TEXT[],
    "supplierName" TEXT NOT NULL,
    "supplierContact" TEXT,
    "craftDescription" TEXT,
    "specialRequirement" TEXT,
    "totalQty" INTEGER,
    "expectedDate" TIMESTAMP(3),
    "actualDate" TIMESTAMP(3),
    "amount" DECIMAL(12,2),
    "status" "OutsourceStatus" NOT NULL DEFAULT 'SENT',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutsourceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignBundle" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dateRangeFrom" TIMESTAMP(3) NOT NULL,
    "dateRangeTo" TIMESTAMP(3) NOT NULL,
    "orderIds" TEXT[],
    "designIds" TEXT[],
    "zipFileUrl" TEXT NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Craft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isOutsource" BOOLEAN NOT NULL DEFAULT false,
    "defaultMachineType" "MachineType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Craft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "paperType" TEXT,
    "baseUnitPrice" DECIMAL(10,4),
    "minOrderQty" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAdjustment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,
    "triggerCondition" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaterialCategory" NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "currentStock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(12,2),
    "averageCost" DECIMAL(10,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialTransaction" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "direction" "TxDirection" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "reasonType" TEXT NOT NULL,
    "relatedOrderId" TEXT,
    "relatedTaskId" TEXT,
    "operatorId" TEXT NOT NULL,
    "unitCost" DECIMAL(10,4),
    "remark" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRule" (
    "id" TEXT NOT NULL,
    "ruleType" "SalaryRuleType" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleValue" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyWorkerSalary" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "machineType" "MachineType" NOT NULL,
    "baseSalary" DECIMAL(10,2) NOT NULL,
    "totalPieceworkAmount" DECIMAL(10,2) NOT NULL,
    "actualSalary" DECIMAL(10,2) NOT NULL,
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "calculationDetail" JSONB,
    "salaryRuleSnapshot" JSONB NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyWorkerSalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPeriod" (
    "id" TEXT NOT NULL,
    "csUserId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "durationMonths" INTEGER NOT NULL DEFAULT 4,
    "totalSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "initialSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyBase" DECIMAL(10,2) NOT NULL,
    "status" "SalaryPeriodStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerServiceCommission" (
    "id" TEXT NOT NULL,
    "csUserId" TEXT NOT NULL,
    "salaryPeriodId" TEXT NOT NULL,
    "totalSales" DECIMAL(12,2) NOT NULL,
    "tierRate" DECIMAL(6,4) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "monthlyBaseTotal" DECIMAL(10,2) NOT NULL,
    "totalIncome" DECIMAL(12,2) NOT NULL,
    "paidBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidCommission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isFullyPaid" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerServiceCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyWorkerPayroll" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totalWorkHours" DECIMAL(6,2) NOT NULL,
    "totalOtHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(6,2) NOT NULL,
    "otMultiplier" DECIMAL(4,2) NOT NULL,
    "baseSalary" DECIMAL(10,2) NOT NULL,
    "otSalary" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalSalary" DECIMAL(10,2) NOT NULL,
    "dailyDetail" JSONB,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourlyWorkerPayroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelIds" TEXT[],
    "messageTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageContent" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "relatedOrderId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "remark" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ChannelRules" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ChannelRules_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_workerType_idx" ON "User"("workerType");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_submitterId_idx" ON "Order"("submitterId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_isUrgent_idx" ON "Order"("isUrgent");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItemDesign_orderItemId_idx" ON "OrderItemDesign"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemDesign_fileType_idx" ON "OrderItemDesign"("fileType");

-- CreateIndex
CREATE INDEX "OrderItemDesign_uploadedAt_idx" ON "OrderItemDesign"("uploadedAt");

-- CreateIndex
CREATE INDEX "OrderLog_orderId_idx" ON "OrderLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderLog_createdAt_idx" ON "OrderLog"("createdAt");

-- CreateIndex
CREATE INDEX "ProductionTask_workerId_idx" ON "ProductionTask"("workerId");

-- CreateIndex
CREATE INDEX "ProductionTask_status_idx" ON "ProductionTask"("status");

-- CreateIndex
CREATE INDEX "ProductionTask_completedAt_idx" ON "ProductionTask"("completedAt");

-- CreateIndex
CREATE INDEX "OutsourceOrder_orderId_idx" ON "OutsourceOrder"("orderId");

-- CreateIndex
CREATE INDEX "OutsourceOrder_status_idx" ON "OutsourceOrder"("status");

-- CreateIndex
CREATE INDEX "OutsourceOrder_expectedDate_idx" ON "OutsourceOrder"("expectedDate");

-- CreateIndex
CREATE INDEX "DesignBundle_createdById_idx" ON "DesignBundle"("createdById");

-- CreateIndex
CREATE INDEX "DesignBundle_createdAt_idx" ON "DesignBundle"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Craft_name_key" ON "Craft"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Craft_code_key" ON "Craft"("code");

-- CreateIndex
CREATE INDEX "Craft_isActive_idx" ON "Craft"("isActive");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "PriceTier_productId_idx" ON "PriceTier"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_category_idx" ON "Material"("category");

-- CreateIndex
CREATE INDEX "MaterialTransaction_materialId_idx" ON "MaterialTransaction"("materialId");

-- CreateIndex
CREATE INDEX "MaterialTransaction_occurredAt_idx" ON "MaterialTransaction"("occurredAt");

-- CreateIndex
CREATE INDEX "SalaryRule_ruleType_idx" ON "SalaryRule"("ruleType");

-- CreateIndex
CREATE INDEX "SalaryRule_effectiveFrom_effectiveTo_idx" ON "SalaryRule"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRule_ruleType_ruleKey_effectiveFrom_key" ON "SalaryRule"("ruleType", "ruleKey", "effectiveFrom");

-- CreateIndex
CREATE INDEX "DailyWorkerSalary_date_idx" ON "DailyWorkerSalary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkerSalary_workerId_date_key" ON "DailyWorkerSalary"("workerId", "date");

-- CreateIndex
CREATE INDEX "SalaryPeriod_csUserId_idx" ON "SalaryPeriod"("csUserId");

-- CreateIndex
CREATE INDEX "SalaryPeriod_status_idx" ON "SalaryPeriod"("status");

-- CreateIndex
CREATE INDEX "SalaryPeriod_periodEnd_idx" ON "SalaryPeriod"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerServiceCommission_salaryPeriodId_key" ON "CustomerServiceCommission"("salaryPeriodId");

-- CreateIndex
CREATE INDEX "CustomerServiceCommission_csUserId_idx" ON "CustomerServiceCommission"("csUserId");

-- CreateIndex
CREATE INDEX "CustomerServiceCommission_settledAt_idx" ON "CustomerServiceCommission"("settledAt");

-- CreateIndex
CREATE INDEX "HourlyWorkerPayroll_month_idx" ON "HourlyWorkerPayroll"("month");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyWorkerPayroll_workerId_month_key" ON "HourlyWorkerPayroll"("workerId", "month");

-- CreateIndex
CREATE INDEX "Bill_status_idx" ON "Bill"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_salesUserId_period_key" ON "Bill"("salesUserId", "period");

-- CreateIndex
CREATE INDEX "BillItem_billId_idx" ON "BillItem"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_channelKey_key" ON "NotificationChannel"("channelKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_eventType_key" ON "NotificationRule"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_idx" ON "NotificationLog"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE INDEX "_ChannelRules_B_index" ON "_ChannelRules"("B");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDesign" ADD CONSTRAINT "OrderItemDesign_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_craftId_fkey" FOREIGN KEY ("craftId") REFERENCES "Craft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutsourceOrder" ADD CONSTRAINT "OutsourceOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignBundle" ADD CONSTRAINT "DesignBundle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTransaction" ADD CONSTRAINT "MaterialTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTransaction" ADD CONSTRAINT "MaterialTransaction_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyWorkerSalary" ADD CONSTRAINT "DailyWorkerSalary_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPeriod" ADD CONSTRAINT "SalaryPeriod_csUserId_fkey" FOREIGN KEY ("csUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerServiceCommission" ADD CONSTRAINT "CustomerServiceCommission_csUserId_fkey" FOREIGN KEY ("csUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerServiceCommission" ADD CONSTRAINT "CustomerServiceCommission_salaryPeriodId_fkey" FOREIGN KEY ("salaryPeriodId") REFERENCES "SalaryPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyWorkerPayroll" ADD CONSTRAINT "HourlyWorkerPayroll_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChannelRules" ADD CONSTRAINT "_ChannelRules_A_fkey" FOREIGN KEY ("A") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChannelRules" ADD CONSTRAINT "_ChannelRules_B_fkey" FOREIGN KEY ("B") REFERENCES "NotificationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
