BEGIN;

-- Phase 1 deliberately commits nullable repair columns. If the enforcement
-- migration (183100) finds ambiguous legacy rows, these columns remain
-- available for an evidence-backed DBA correction while the application stays
-- stopped. IF NOT EXISTS plus predicate-limited UPDATE keep this phase safe to
-- inspect/re-run during recovery.
LOCK TABLE "Attendance" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "HourlyWorkerPayroll" IN SHARE MODE;
LOCK TABLE "User" IN SHARE MODE;

ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "roleSnapshot" "Role",
  ADD COLUMN IF NOT EXISTS "workerTypeSnapshot" "WorkerType";

-- An existing payroll snapshot is the strongest available historical fact:
-- it records the worker type actually used for this exact worker-month.
UPDATE "Attendance" AS attendance
SET
  "roleSnapshot" = 'WORKER'::"Role",
  "workerTypeSnapshot" =
    (payroll."salaryRuleSnapshot" ->> 'workerType')::"WorkerType"
FROM "HourlyWorkerPayroll" AS payroll
WHERE payroll."workerId" = attendance."workerId"
  AND payroll."month" = to_char(attendance."date", 'YYYY-MM')
  AND attendance."roleSnapshot" IS NULL
  AND jsonb_typeof(payroll."salaryRuleSnapshot") = 'object'
  AND payroll."salaryRuleSnapshot" ->> 'workerType'
    IN ('PACKER', 'CLEANER', 'COOK');

-- Current identity is evidence only when the User row has not changed since
-- attendance was first recorded. Attendance.updatedAt is deliberately NOT
-- evidence: re-entering an old day after a transfer advances that timestamp.
UPDATE "Attendance" AS attendance
SET
  "roleSnapshot" = account."role",
  "workerTypeSnapshot" = CASE
    WHEN account."role" = 'WORKER'::"Role" THEN account."workerType"
    ELSE NULL
  END
FROM "User" AS account
WHERE account."id" = attendance."workerId"
  AND attendance."roleSnapshot" IS NULL
  AND account."updatedAt" <= attendance."createdAt";

COMMIT;
