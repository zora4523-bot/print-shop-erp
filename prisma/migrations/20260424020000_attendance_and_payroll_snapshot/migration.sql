-- Attendance table for 时薪工 (PACKER / CLEANER / COOK) daily record
-- keeping. Foremen upsert per-worker per-day rows; @@unique makes
-- re-entry idempotent (recording the same day twice overwrites).
CREATE TABLE "Attendance" (
  "id"          TEXT PRIMARY KEY,
  "workerId"    TEXT    NOT NULL,
  "date"        DATE    NOT NULL,
  "normalHours" DECIMAL(6, 2) NOT NULL DEFAULT 0,
  "otHours"     DECIMAL(6, 2) NOT NULL DEFAULT 0,
  "spareHours"  DECIMAL(6, 2) NOT NULL DEFAULT 0,
  "remark"      TEXT,
  "createdById" TEXT    NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Attendance_workerId_fkey"    FOREIGN KEY ("workerId")    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Attendance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Attendance_workerId_date_key" ON "Attendance"("workerId", "date");
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- HourlyWorkerPayroll: add COOK-aware fields + rule snapshot so the
-- settled row is self-auditable (CLAUDE.md §4.4). Matches the
-- CS-commission snapshot pattern from migration 20260424015000.
ALTER TABLE "HourlyWorkerPayroll"
  ADD COLUMN "totalSpareHours"    DECIMAL(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "spareSalary"        DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "salaryRuleSnapshot" JSONB;
