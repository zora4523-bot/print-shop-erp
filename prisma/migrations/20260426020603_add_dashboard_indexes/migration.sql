-- CreateIndex
CREATE INDEX "Bill_period_idx" ON "Bill"("period");

-- CreateIndex
CREATE INDEX "Order_submittedAt_idx" ON "Order"("submittedAt");

-- CreateIndex
CREATE INDEX "Order_completedAt_idx" ON "Order"("completedAt");

-- CreateIndex
CREATE INDEX "Order_shippedAt_idx" ON "Order"("shippedAt");
