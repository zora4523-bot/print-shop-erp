BEGIN;

-- Older application code rounded each hourly-payroll component for storage
-- but rounded the unrounded grand total separately. An unpaid row is derived
-- data and can be reconciled safely from its already-stored cent components.
-- A paid row is finance-of-record, so changing it requires an explicit human
-- decision and must block deployment instead of silently rewriting history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "HourlyWorkerPayroll"
    WHERE "isPaid" = true
      AND "totalSalary" <> "baseSalary" + "otSalary" + "spareSalary"
  ) THEN
    RAISE EXCEPTION
      'Paid hourly payroll components do not reconcile with totalSalary; manual finance review required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "HourlyWorkerPayroll"
    WHERE "isPaid" = false
      AND ABS("baseSalary" + "otSalary" + "spareSalary") > 99999999.99
  ) THEN
    RAISE EXCEPTION
      'Unpaid hourly payroll component sum exceeds Decimal(10,2); manual finance review required';
  END IF;
END $$;

UPDATE "HourlyWorkerPayroll"
SET "totalSalary" = "baseSalary" + "otSalary" + "spareSalary"
WHERE "isPaid" = false
  AND "totalSalary" <> "baseSalary" + "otSalary" + "spareSalary";

ALTER TABLE "HourlyWorkerPayroll"
  ADD CONSTRAINT "HourlyWorkerPayroll_component_total_reconciles"
  CHECK ("totalSalary" = "baseSalary" + "otSalary" + "spareSalary")
  NOT VALID;
ALTER TABLE "HourlyWorkerPayroll"
  VALIDATE CONSTRAINT "HourlyWorkerPayroll_component_total_reconciles";

-- Migration-created opening receipts preserve the amount but cannot recover
-- the original per-payment timestamp. Make that limitation explicit in the
-- immutable ledger instead of presenting the placeholder timestamp as fact.
UPDATE "BillPayment"
SET "remark" = '付款流水启用前的累计已收金额；具体收款时间未知'
WHERE "idempotencyKey" LIKE 'migration:20260802:bill-payment:%';

COMMIT;
