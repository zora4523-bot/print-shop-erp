BEGIN;

-- Manual salary adjustments are append-only money movements. Give legacy
-- rows deterministic request keys, then require every new write to carry a
-- unique key so browser retries cannot duplicate a bonus or deduction.
ALTER TABLE "SalaryAdjustment"
  ADD COLUMN "idempotencyKey" TEXT;

UPDATE "SalaryAdjustment"
SET "idempotencyKey" = 'legacy-salary-adjustment:' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "SalaryAdjustment"
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "SalaryAdjustment_idempotencyKey_key"
  ON "SalaryAdjustment"("idempotencyKey");

COMMIT;
