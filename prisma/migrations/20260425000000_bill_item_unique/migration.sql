-- Add (billId, orderId) uniqueness on BillItem so concurrent
-- generateBillsForPeriod runs can't both createMany a duplicate item
-- for the same order (Codex round 52 / P1). lib-level advisory lock
-- handles the common case; this is the DB-level last-line guard.
CREATE UNIQUE INDEX "BillItem_billId_orderId_key"
  ON "BillItem"("billId", "orderId");
