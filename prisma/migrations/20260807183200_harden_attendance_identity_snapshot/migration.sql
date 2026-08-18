-- Compatibility phase A is intentionally committed on its own. Databases that
-- already ran the early 183000/183100 draft may contain snapshots inferred from
-- Attendance.updatedAt. Every existing row starts unverified; a later failure
-- leaves this marker available for explicit DBA reconciliation.
BEGIN;

LOCK TABLE "Attendance" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "Attendance"
  ADD COLUMN IF NOT EXISTS "identitySnapshotVerified" BOOLEAN
  NOT NULL DEFAULT FALSE;

COMMIT;

-- Compatibility phase B re-proves every old snapshot from immutable evidence.
-- The application must remain stopped throughout this migration and any
-- recovery. A retry preserves rows explicitly marked verified by the DBA.
BEGIN;

LOCK TABLE "Attendance" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "HourlyWorkerPayroll" IN SHARE MODE;
LOCK TABLE "User" IN SHARE MODE;

-- Exact worker-month payroll snapshots outrank every mutable account field.
UPDATE "Attendance" AS attendance
SET
  "roleSnapshot" = 'WORKER'::"Role",
  "workerTypeSnapshot" =
    (payroll."salaryRuleSnapshot" ->> 'workerType')::"WorkerType",
  "identitySnapshotVerified" = TRUE
FROM "HourlyWorkerPayroll" AS payroll
WHERE payroll."workerId" = attendance."workerId"
  AND payroll."month" = to_char(attendance."date", 'YYYY-MM')
  AND attendance."identitySnapshotVerified" = FALSE
  AND jsonb_typeof(payroll."salaryRuleSnapshot") = 'object'
  AND payroll."salaryRuleSnapshot" ->> 'workerType'
    IN ('PACKER', 'CLEANER', 'COOK');

-- The current account is proof only when it predates first attendance entry.
-- Never use Attendance.updatedAt: PACKER at T1 -> COOK at T2 -> re-entry at T3
-- would otherwise silently rewrite the old day as COOK.
UPDATE "Attendance" AS attendance
SET
  "roleSnapshot" = account."role",
  "workerTypeSnapshot" = CASE
    WHEN account."role" = 'WORKER'::"Role" THEN account."workerType"
    ELSE NULL
  END,
  "identitySnapshotVerified" = TRUE
FROM "User" AS account
WHERE account."id" = attendance."workerId"
  AND attendance."identitySnapshotVerified" = FALSE
  AND account."updatedAt" <= attendance."createdAt";

DO $$
DECLARE
  unresolved_count INTEGER;
  unresolved_details TEXT;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO unresolved_count
  FROM "Attendance"
  WHERE "identitySnapshotVerified" = FALSE
     OR "roleSnapshot" IS NULL
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
        '%s(worker=%s,date=%s,verified=%s,roleSnapshot=%s,workerTypeSnapshot=%s,attendanceCreated=%s,attendanceUpdated=%s,userUpdated=%s,currentRole=%s,currentWorkerType=%s)',
        sample."id",
        sample."workerId",
        sample."date",
        sample.snapshot_verified,
        COALESCE(sample.role_snapshot, 'null'),
        COALESCE(sample.worker_type_snapshot, 'null'),
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
        attendance."identitySnapshotVerified"::TEXT AS snapshot_verified,
        attendance."roleSnapshot"::TEXT AS role_snapshot,
        attendance."workerTypeSnapshot"::TEXT AS worker_type_snapshot,
        attendance."createdAt"::TEXT AS attendance_created,
        attendance."updatedAt"::TEXT AS attendance_updated,
        account."updatedAt"::TEXT AS user_updated,
        account."role"::TEXT AS current_role,
        account."workerType"::TEXT AS current_worker_type
      FROM "Attendance" AS attendance
      JOIN "User" AS account ON account."id" = attendance."workerId"
      WHERE attendance."identitySnapshotVerified" = FALSE
         OR attendance."roleSnapshot" IS NULL
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
        'Attendance identity hardening blocked: %s row(s) are not proven by payroll or User.updatedAt <= Attendance.createdAt, or violate role/type consistency. Keep the app stopped; explicitly repair roleSnapshot/workerTypeSnapshot and set identitySnapshotVerified=TRUE from personnel evidence, then resolve this migration as rolled-back and retry. %s',
        unresolved_count,
        COALESCE(unresolved_details, '')
      );
  END IF;
END
$$;

ALTER TABLE "Attendance"
  DROP CONSTRAINT IF EXISTS "Attendance_worker_type_snapshot_role_check";

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

ALTER TABLE "Attendance"
  ALTER COLUMN "identitySnapshotVerified" SET DEFAULT TRUE;

COMMIT;
