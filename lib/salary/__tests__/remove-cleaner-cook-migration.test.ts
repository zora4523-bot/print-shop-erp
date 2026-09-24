import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260924100000_remove_cleaner_cook_cleaning/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(
  path.join(process.cwd(), 'prisma/schema.prisma'),
  'utf8',
);

function block(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start) + 1);
}

describe('remove cleaner / cook / cleaning migration', () => {
  it('fails closed on every business reference before changing anything', () => {
    const guard = migration.slice(0, migration.indexOf('END $$;'));
    for (const table of [
      '"User"',
      '"Attendance"',
      '"HourlyWorkerPayroll"',
      '"ProductionTask"',
      '"Craft"',
      '"OrderItem"',
      '"DailyWorkerSalaryItem"',
      '"OrderChangeRequest"',
      '"ProductionProgressStep"',
      '"BackgroundJob"',
    ]) {
      expect(guard, table).toContain(`FROM ${table}`);
    }
    expect(guard.match(/RAISE EXCEPTION/g)?.length).toBeGreaterThanOrEqual(12);
    const firstWrite = migration.search(/\n(?:DELETE|UPDATE|ALTER)\b/);
    expect(firstWrite).toBeGreaterThan(migration.indexOf('END $$;'));
  });

  it('never wraps itself in an explicit transaction that would hide the RAISE message', () => {
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
  });

  it('deletes only configuration rows and cancels queued removed cron jobs', () => {
    expect(migration).toContain('DELETE FROM "Craft" WHERE "code" = \'CLEANING\';');
    expect(migration).toMatch(
      /DELETE FROM "SalaryRule"[\s\S]*'COOK_SALARY'[\s\S]*'CLEANER_HOURLY', 'COOK_SPARE_HOURLY', 'OT_MULTIPLIER'/,
    );
    expect(migration).toMatch(
      /UPDATE "BackgroundJob"[\s\S]*"status" = 'CANCELLED'[\s\S]*"type" = 'CRON_HOURLY_PAYROLL' AND "status" = 'PENDING'/,
    );
    expect(migration).not.toMatch(/DELETE FROM "(User|Attendance|HourlyWorkerPayroll|ProductionTask|OrderItem)"/);
  });

  it('recreates both enums and every dependent column / constraint', () => {
    expect(migration).toContain(`CREATE TYPE "WorkerType" AS ENUM ('MACHINE', 'PACKER');`);
    expect(migration).toContain(
      `CREATE TYPE "SalaryRuleType" AS ENUM ('CS_COMMISSION', 'WORKER_MACHINE', 'WORKER_HOURLY');`,
    );
    for (const column of [
      'ALTER TABLE "User"\n  ALTER COLUMN "workerType"',
      'ALTER TABLE "Craft"\n  ALTER COLUMN "defaultWorkerType"',
      'ALTER TABLE "ProductionTask"\n  ALTER COLUMN "workerType"',
      'ALTER TABLE "Attendance"\n  ALTER COLUMN "workerTypeSnapshot"',
      'ALTER TABLE "SalaryRule"\n  ALTER COLUMN "ruleType"',
    ]) {
      expect(migration, column).toContain(column);
    }
    expect(migration).toContain('DROP CONSTRAINT "ProductionTask_self_claim_state_check"');
    expect(migration).toContain('ADD CONSTRAINT "ProductionTask_self_claim_state_check"');
    expect(migration).toContain('CHECK ("totalSalary" = "baseSalary" + "otSalary")');
    expect(migration).toContain('DROP COLUMN "spareHours"');
  });

  it('keeps the Prisma schema in step with the migration', () => {
    expect(block(schema, 'enum WorkerType {')).toBe(
      'enum WorkerType {\n  MACHINE\n  PACKER\n}',
    );
    expect(block(schema, 'enum SalaryRuleType {')).not.toContain('COOK');
    expect(block(schema, 'model Attendance {')).not.toContain('spareHours');
    expect(block(schema, 'model HourlyWorkerPayroll {')).not.toMatch(/spare/i);
  });
});
