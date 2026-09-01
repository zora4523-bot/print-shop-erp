-- Close salary-rule input domains under their persisted combination outputs.
-- These are widening-only changes; no historical finance value is rewritten.
BEGIN;

ALTER TABLE "HourlyWorkerPayroll"
  ALTER COLUMN "baseSalary" TYPE DECIMAL(11, 2),
  ALTER COLUMN "otSalary" TYPE DECIMAL(11, 2),
  ALTER COLUMN "spareSalary" TYPE DECIMAL(11, 2),
  ALTER COLUMN "totalSalary" TYPE DECIMAL(11, 2);

ALTER TABLE "CustomerServiceCommission"
  ALTER COLUMN "monthlyBaseTotal" TYPE DECIMAL(12, 2),
  ALTER COLUMN "totalIncome" TYPE DECIMAL(13, 2);

-- Salary eligibility now relies on this interval. Keep direct SQL and legacy
-- import paths from creating an inverted employment fact. NOT VALID avoids a
-- long blocking validation scan while the constraint is installed; VALIDATE
-- then fails closed without rewriting any historical row.
ALTER TABLE "User"
  ADD CONSTRAINT "User_employment_dates_order_check"
  CHECK (
    "employmentStartDate" IS NULL
    OR "employmentEndDate" IS NULL
    OR "employmentStartDate" <= "employmentEndDate"
  ) NOT VALID;

ALTER TABLE "User"
  VALIDATE CONSTRAINT "User_employment_dates_order_check";

COMMIT;
