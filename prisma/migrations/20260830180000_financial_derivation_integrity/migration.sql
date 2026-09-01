-- Preserve issued monthly bills while giving late finished orders an explicit
-- supplemental sequence. Existing rows are the first statement by default.
BEGIN;

LOCK TABLE "Bill", "BillItem", "PurchaseReceipt"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Bill"
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_sequence_positive" CHECK ("sequence" >= 1) NOT VALID;

ALTER TABLE "Bill"
  VALIDATE CONSTRAINT "Bill_sequence_positive";

DROP INDEX "Bill_salesUserId_period_key";

CREATE UNIQUE INDEX "Bill_salesUserId_period_sequence_key"
  ON "Bill"("salesUserId", "period", "sequence");

-- A receivable order must never be collected by two monthly/supplemental
-- statements. Finance history is not auto-deduplicated: stop deployment and
-- require reconciliation if legacy data already violates the invariant.
DO $$
DECLARE
  duplicate_order_id TEXT;
BEGIN
  SELECT "orderId"
    INTO duplicate_order_id
    FROM "BillItem"
   GROUP BY "orderId"
  HAVING COUNT(*) > 1
   ORDER BY "orderId"
   LIMIT 1;

  IF duplicate_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'BillItem orderId % appears on more than one bill; reconcile finance history before applying this migration',
      duplicate_order_id;
  END IF;
END
$$;

CREATE UNIQUE INDEX "BillItem_orderId_key"
  ON "BillItem"("orderId");

-- New purchase receipts retain the exact normalized business command. Older
-- rows remain nullable and are replay-checked from receipt/item/stock-ledger
-- evidence because the original null-vs-default location bit was not stored.
ALTER TABLE "PurchaseReceipt"
  ADD COLUMN "requestFingerprint" VARCHAR(64);

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_requestFingerprint_sha256"
  CHECK (
    "requestFingerprint" IS NULL
    OR "requestFingerprint" ~ '^[0-9a-f]{64}$'
  ) NOT VALID;

ALTER TABLE "PurchaseReceipt"
  VALIDATE CONSTRAINT "PurchaseReceipt_requestFingerprint_sha256";

COMMIT;
