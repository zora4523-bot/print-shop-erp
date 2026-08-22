import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807183000_attendance_worker_type_snapshot',
    'migration.sql',
  ),
  'utf8',
);
const enforcementMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807183100_enforce_attendance_identity_snapshot',
    'migration.sql',
  ),
  'utf8',
);
const hardeningMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807183200_harden_attendance_identity_snapshot',
    'migration.sql',
  ),
  'utf8',
);

describe('attendance identity snapshot migration contract', () => {
  it('locks attendance, payroll and account identity in one fixed order before backfill', () => {
    for (const sql of [migration, enforcementMigration, hardeningMigration]) {
      const attendanceLock = sql.indexOf(
        'LOCK TABLE "Attendance" IN ACCESS EXCLUSIVE MODE',
      );
      const payrollLock = sql.indexOf(
        'LOCK TABLE "HourlyWorkerPayroll" IN SHARE MODE',
      );
      const userLock = sql.indexOf('LOCK TABLE "User" IN SHARE MODE');
      const firstBackfill = sql.indexOf('UPDATE "Attendance"');

      expect(attendanceLock).toBeGreaterThan(-1);
      expect(payrollLock).toBeGreaterThan(attendanceLock);
      expect(userLock).toBeGreaterThan(payrollLock);
      expect(firstBackfill).toBeGreaterThan(userLock);
    }
  });

  it('uses exact historical payroll evidence before considering current identity', () => {
    const payrollBackfill = migration.indexOf(
      'FROM "HourlyWorkerPayroll" AS payroll',
    );
    const currentIdentityBackfill = migration.indexOf(
      'FROM "User" AS account',
    );

    expect(payrollBackfill).toBeGreaterThan(-1);
    expect(currentIdentityBackfill).toBeGreaterThan(payrollBackfill);
    expect(migration).toContain(
      'payroll."month" = to_char(attendance."date", \'YYYY-MM\')',
    );
    expect(migration).toContain(
      "payroll.\"salaryRuleSnapshot\" ->> 'workerType'",
    );
  });

  it('only backfills from current identity when timestamps prove no later account change', () => {
    for (const sql of [migration, enforcementMigration, hardeningMigration]) {
      expect(sql).toContain(
        'account."updatedAt" <= attendance."createdAt"',
      );
      expect(sql).not.toContain(
        'account."updatedAt" <= attendance."updatedAt"',
      );
      expect(sql).not.toMatch(/spareHours[\s\S]*(?:PACKER|COOK)/);
      expect(sql).not.toMatch(/normalHours[\s\S]*workerTypeSnapshot/);
    }
  });

  it('fails closed on every unresolved legacy identity before making the role snapshot required', () => {
    const guard = enforcementMigration.indexOf(
      'Attendance identity enforcement blocked',
    );
    const notNull = enforcementMigration.indexOf(
      'ALTER COLUMN "roleSnapshot" SET NOT NULL',
    );

    expect(guard).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(guard);
    expect(enforcementMigration).toContain("ERRCODE = 'check_violation'");
    expect(enforcementMigration).toContain('WHERE "roleSnapshot" IS NULL');
    expect(enforcementMigration).toContain(
      '"roleSnapshot" = \'WORKER\'::"Role"\n       AND "workerTypeSnapshot" IS NULL',
    );
    expect(enforcementMigration).toContain(
      '"roleSnapshot" <> \'WORKER\'::"Role"\n       AND "workerTypeSnapshot" IS NOT NULL',
    );
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(enforcementMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(enforcementMigration.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('commits repairable nullable columns before enforcement and documents retry recovery', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "roleSnapshot" "Role"',
    );
    expect(migration).not.toContain(
      'ALTER COLUMN "roleSnapshot" SET NOT NULL',
    );
    expect(migration).not.toContain('RAISE EXCEPTION');
    expect(enforcementMigration).toContain(
      'prisma migrate resolve --rolled-back 20260807183100_enforce_attendance_identity_snapshot',
    );
    expect(enforcementMigration).toContain(
      'application must remain stopped',
    );
  });

  it('enforces the role/type snapshot invariant in both directions while allowing MACHINE', () => {
    const check = enforcementMigration.slice(
      enforcementMigration.indexOf(
        'ADD CONSTRAINT "Attendance_worker_type_snapshot_role_check"',
      ),
    );

    expect(check).toContain(
      '"roleSnapshot" = \'WORKER\'::"Role"\n          AND "workerTypeSnapshot" IS NOT NULL',
    );
    expect(check).toContain(
      '"roleSnapshot" <> \'WORKER\'::"Role"\n          AND "workerTypeSnapshot" IS NULL',
    );
    expect(check).not.toContain(
      '"workerTypeSnapshot" IN (\'PACKER\', \'CLEANER\', \'COOK\')',
    );
  });

  it('re-audits databases that ran the old updatedAt draft without silently trusting old snapshots', () => {
    expect(hardeningMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "identitySnapshotVerified" BOOLEAN',
    );
    expect(hardeningMigration).toContain(
      '"identitySnapshotVerified" = FALSE',
    );
    expect(hardeningMigration).toContain(
      'account."updatedAt" <= attendance."createdAt"',
    );
    expect(hardeningMigration).toContain(
      'Attendance identity hardening blocked',
    );
    expect(hardeningMigration).toContain(
      'set identitySnapshotVerified=TRUE from personnel evidence',
    );
    expect(hardeningMigration.match(/\bCOMMIT;/g)).toHaveLength(2);
  });
});
