BEGIN;

-- Recovery runbook (application must remain stopped):
-- 1. Inspect the sample ids in the exception and the full query below.
-- 2. Verify each row against payroll/personnel evidence, then explicitly
--    UPDATE Attendance.roleSnapshot + workerTypeSnapshot. Do not copy the
--    user's current role unless independent evidence proves it was unchanged.
-- 3. If Prisma recorded this transaction as failed, run:
--      pnpm prisma migrate resolve --rolled-back 20260807183100_enforce_attendance_identity_snapshot
--    Then rerun `pnpm prisma migrate deploy`.
-- Phase 1 has already committed the nullable columns, so these repairs remain
-- possible even though this enforcement transaction rolls back.
LOCK TABLE "Attendance" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "HourlyWorkerPayroll" IN SHARE MODE;
LOCK TABLE "User" IN SHARE MODE;

-- Re-run both safe proofs under the enforcement locks. This is idempotent and
-- covers rows inserted after phase 1 only if deployment was accidentally not
-- stopped; ambiguous rows still fail below.
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

DO $$
DECLARE
  unresolved_count INTEGER;
  unresolved_details TEXT;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO unresolved_count
  FROM "Attendance"
  WHERE "roleSnapshot" IS NULL
     OR (
       "roleSnapshot" = 'WORKER'::"Role"
       AND "workerTypeSnapshot" IS NULL
     )
     OR (
       "roleSnapshot" <> 'WORKER'::"Role"
       AND "workerTypeSnapshot" IS NOT NULL
     );

  IF unresolved_count > 0 THEN
    SELECT string_agg(
      format(
        '%s(worker=%s,date=%s,attendanceCreated=%s,attendanceUpdated=%s,userUpdated=%s,currentRole=%s,currentWorkerType=%s)',
        sample."id",
        sample."workerId",
        sample."date",
        sample.attendance_created,
        sample.attendance_updated,
        sample.user_updated,
        sample.current_role,
        COALESCE(sample.current_worker_type, 'null')
      ),
      '; '
    )
    INTO unresolved_details
    FROM (
      SELECT
        attendance."id",
        attendance."workerId",
        attendance."date",
        attendance."createdAt"::TEXT AS attendance_created,
        attendance."updatedAt"::TEXT AS attendance_updated,
        account."updatedAt"::TEXT AS user_updated,
        account."role"::TEXT AS current_role,
        account."workerType"::TEXT AS current_worker_type
      FROM "Attendance" AS attendance
      JOIN "User" AS account ON account."id" = attendance."workerId"
      WHERE attendance."roleSnapshot" IS NULL
         OR (
           attendance."roleSnapshot" = 'WORKER'::"Role"
           AND attendance."workerTypeSnapshot" IS NULL
         )
         OR (
           attendance."roleSnapshot" <> 'WORKER'::"Role"
           AND attendance."workerTypeSnapshot" IS NOT NULL
         )
      ORDER BY attendance."date", attendance."id"
      LIMIT 20
    ) AS sample;

    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Attendance identity enforcement blocked: %s row(s) need an evidence-backed roleSnapshot/workerTypeSnapshot repair while the application remains stopped. %s',
        unresolved_count,
        COALESCE(unresolved_details, '')
      );
  END IF;
END
$$;

ALTER TABLE "Attendance"
  ALTER COLUMN "roleSnapshot" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Attendance_worker_type_snapshot_role_check'
      AND conrelid = '"Attendance"'::regclass
  ) THEN
    ALTER TABLE "Attendance"
      ADD CONSTRAINT "Attendance_worker_type_snapshot_role_check"
      CHECK (
        (
          "roleSnapshot" = 'WORKER'::"Role"
          AND "workerTypeSnapshot" IS NOT NULL
        )
        OR (
          "roleSnapshot" <> 'WORKER'::"Role"
          AND "workerTypeSnapshot" IS NULL
        )
      );
  END IF;
END
$$;

COMMIT;
