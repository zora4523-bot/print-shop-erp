-- 「点打印即记已打印」的打印尝试账本（业主 2026-10-02，DECISIONS 同日）。
-- 打印页每次渲染、批量打印文件每次打开 / 下载，每张工单各一个尝试；结果落库后同一尝试的
-- 重试只返回原结果，不会认领之后才新建的打印任务。只新增表，不改已有数据。

-- CreateEnum
CREATE TYPE "OrderPrintAttemptOutcome" AS ENUM ('MARKED', 'ALREADY_PRINTED', 'STALE', 'NOT_PRINTABLE');

-- CreateTable
CREATE TABLE "OrderPrintAttempt" (
    "id" TEXT NOT NULL,
    "attemptKey" VARCHAR(128) NOT NULL,
    "orderId" TEXT NOT NULL,
    "workOrderVersion" INTEGER NOT NULL,
    "outcome" "OrderPrintAttemptOutcome" NOT NULL,
    "receiptId" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPrintAttempt_pkey" PRIMARY KEY ("id"),
    -- 只有本次写入了打印回执（MARKED）才指向回执；其余结果不得挂回执。
    CONSTRAINT "OrderPrintAttempt_receipt_matches_outcome" CHECK (("outcome" = 'MARKED') = ("receiptId" IS NOT NULL)),
    CONSTRAINT "OrderPrintAttempt_workOrderVersion_positive" CHECK ("workOrderVersion" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderPrintAttempt_attemptKey_key" ON "OrderPrintAttempt"("attemptKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPrintAttempt_receiptId_key" ON "OrderPrintAttempt"("receiptId");

-- CreateIndex
CREATE INDEX "OrderPrintAttempt_orderId_createdAt_idx" ON "OrderPrintAttempt"("orderId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "OrderPrintAttempt" ADD CONSTRAINT "OrderPrintAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPrintAttempt" ADD CONSTRAINT "OrderPrintAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPrintAttempt" ADD CONSTRAINT "OrderPrintAttempt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "OrderPrintJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
