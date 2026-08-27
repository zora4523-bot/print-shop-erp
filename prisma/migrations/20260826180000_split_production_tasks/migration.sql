-- Allow one item/craft production operation to be split across multiple
-- workers. `plannedQty` is the quantity allocated to each individual task;
-- scheduleOrder validates that every item/craft group's total equals the
-- immutable OrderItem.quantity before the order leaves SUBMITTED.

DROP INDEX IF EXISTS "ProductionTask_orderItemId_craftId_key";

CREATE INDEX IF NOT EXISTS "ProductionTask_orderItemId_craftId_idx"
ON "ProductionTask"("orderItemId", "craftId");
