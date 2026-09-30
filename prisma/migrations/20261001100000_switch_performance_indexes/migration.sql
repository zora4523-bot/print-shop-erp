-- 功能切换性能审查（2026-10-01）：两条逐行 EXISTS / 相关子查询在 3 万工单下退化为整表扫描。
-- 实测（3 万工单 / 9 万款式）：产品目录引用计数 385 ms → 0.9 ms；代理商账单代理人筛选 4.9 s → 0.5 ms。

-- CreateIndex
CREATE INDEX "OrderItem_productId_orderId_idx" ON "OrderItem"("productId", "orderId");

-- CreateIndex
CREATE INDEX "Order_submitterId_settlementType_idx" ON "Order"("submitterId", "settlementType");
