-- Add (billId, orderId) uniqueness on BillItem so concurrent
-- generateBillsForPeriod runs can't both createMany a duplicate item
-- for the same order (Codex round 52 / P1). lib-level advisory lock
-- handles the common case; this is the DB-level last-line guard.
--
-- Pre-dedupe first (Codex round 53 / P1). If any duplicate rows
-- already exist from the pre-fix race, CREATE UNIQUE INDEX would
-- fail outright and block the deploy. Keep the earliest row per
-- (billId, orderId) — orderAmount is derived from Order.totalAmount
-- so duplicate rows are equivalent; picking the earliest is safe.
-- On an empty / pre-production table this is a no-op.
DELETE FROM "BillItem"
WHERE "id" NOT IN (
  SELECT MIN("id") FROM "BillItem" GROUP BY "billId", "orderId"
);

CREATE UNIQUE INDEX "BillItem_billId_orderId_key"
  ON "BillItem"("billId", "orderId");
