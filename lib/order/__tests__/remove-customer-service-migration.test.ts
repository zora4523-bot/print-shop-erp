import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260924110000_remove_customer_service_role/migration.sql',
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

describe('remove customer service / internal and factory-direct settlement migration', () => {
  const guard = migration.slice(0, migration.indexOf('END $$;'));

  it('fails closed on every business reference before changing anything', () => {
    for (const reference of [
      `FROM "User" WHERE "role"::text = 'CUSTOMER_SERVICE'`,
      `FROM "Order" WHERE "submitterRole"::text = 'CUSTOMER_SERVICE'`,
      `FROM "Order" WHERE "settlementType"::text IN ('INTERNAL_SALES', 'FACTORY_DIRECT')`,
      `FROM "OrderPricingRevision"`,
      `FROM "CustomerPriceBook" WHERE "settlementType"::text IN ('INTERNAL_SALES', 'FACTORY_DIRECT')`,
      `FROM "Attendance" WHERE "roleSnapshot"::text = 'CUSTOMER_SERVICE'`,
      `FROM "BusinessAuditLog" WHERE "actorRole"::text = 'CUSTOMER_SERVICE'`,
      'FROM "SalaryPeriod"',
      'FROM "CsSalesEntry"',
      'FROM "CustomerServiceCommission"',
      'FROM "CsPayrollPayment"',
      'FROM "BackgroundJob"',
    ]) {
      expect(guard, reference).toContain(reference);
    }
    expect(guard.match(/RAISE EXCEPTION '/g)?.length).toBe(12);
    const firstWrite = migration.search(/\n(?:DELETE|UPDATE|ALTER|DROP|CREATE)\b/);
    expect(firstWrite).toBeGreaterThan(migration.indexOf('END $$;'));
  });

  it('never wraps itself in an explicit transaction that would hide the RAISE message', () => {
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
  });

  it('deletes only configuration rows and cancels queued removed jobs', () => {
    expect(migration).toContain(`DELETE FROM "SalaryRule" WHERE "ruleType"::text = 'CS_COMMISSION';`);
    expect(migration).toContain(
      `DELETE FROM "NotificationRule" WHERE "eventType" IN ('CS_PERIOD_ENDING', 'CS_PERIOD_SETTLED');`,
    );
    expect(migration).toMatch(
      /UPDATE "BackgroundJob"[\s\S]*"status" = 'CANCELLED'[\s\S]*"status" = 'PENDING'[\s\S]*'CRON_CS_SETTLE', 'CRON_CS_PERIOD_ENDING'/,
    );
    expect(migration).not.toMatch(/DELETE FROM "(User|Order|Attendance|BusinessAuditLog|CustomerPriceBook|OrderPricingRevision)"/);
  });

  it('drops the four customer-service payroll tables and their enums', () => {
    for (const table of ['CsPayrollPayment', 'CustomerServiceCommission', 'CsSalesEntry', 'SalaryPeriod']) {
      expect(migration).toContain(`DROP TABLE "${table}";`);
    }
    expect(migration).toContain('DROP TYPE "CsSalesEntryType";');
    expect(migration).toContain('DROP TYPE "SalaryPeriodStatus";');
  });

  it('recreates every enum and every dependent column, constraint and trigger', () => {
    expect(migration).toContain(`CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'WORKER');`);
    expect(migration).toContain(`CREATE TYPE "OrderSettlementType" AS ENUM ('EXTERNAL_SALES', 'NO_CHARGE');`);
    expect(migration).toContain(`CREATE TYPE "SalaryRuleType" AS ENUM ('WORKER_MACHINE', 'WORKER_HOURLY');`);
    for (const column of [
      'ALTER TABLE "User"\n  ALTER COLUMN "role"',
      'ALTER TABLE "Order"\n  ALTER COLUMN "submitterRole"',
      'ALTER TABLE "Attendance"\n  ALTER COLUMN "roleSnapshot"',
      'ALTER TABLE "BusinessAuditLog"\n  ALTER COLUMN "actorRole"',
      'ALTER TABLE "Order"\n  ALTER COLUMN "settlementType"',
      'ALTER TABLE "CustomerPriceBook"\n  ALTER COLUMN "settlementType"',
      'ALTER TABLE "SalaryRule"\n  ALTER COLUMN "ruleType"',
    ]) {
      expect(migration, column).toContain(column);
    }
    for (const constraint of [
      'Order_settlement_role_consistent',
      'Order_billing_settlement_consistent',
      'Order_priceRevision_check',
      'Attendance_worker_type_snapshot_role_check',
    ]) {
      expect(migration).toContain(`DROP CONSTRAINT "${constraint}"`);
      expect(migration).toContain(`ADD CONSTRAINT "${constraint}"`);
    }
    expect(migration).toContain('DROP TRIGGER "Order_protect_billed_settlement" ON "Order";');
    expect(migration).toContain('CREATE TRIGGER "Order_protect_billed_settlement"');
    const roleConstraint = migration.slice(
      migration.indexOf('ADD CONSTRAINT "Order_settlement_role_consistent"'),
    );
    expect(roleConstraint.slice(0, roleConstraint.indexOf(');'))).toContain(
      `"submitterRole" = 'SALES'::"Role"`,
    );
  });

  it('keeps the Prisma schema in step with the migration', () => {
    expect(block(schema, 'enum Role {')).toBe('enum Role {\n  ADMIN\n  SALES\n  WORKER\n}');
    expect(block(schema, 'enum OrderSettlementType {')).not.toMatch(/INTERNAL_SALES|FACTORY_DIRECT/);
    expect(block(schema, 'enum SalaryRuleType {')).not.toContain('CS_COMMISSION');
    for (const removed of ['model SalaryPeriod', 'model CsSalesEntry', 'model CustomerServiceCommission', 'model CsPayrollPayment', 'enum SalaryPeriodStatus', 'enum CsSalesEntryType']) {
      expect(schema).not.toContain(removed);
    }
  });
});
