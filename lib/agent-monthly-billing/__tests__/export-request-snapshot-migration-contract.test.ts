import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120800_agent_monthly_bill_export_request_snapshots',
    'migration.sql',
  ),
  'utf8',
);

describe('agent monthly bill export request snapshot migration', () => {
  it('adds an immutable ordered request-time manifest without changing legacy ledgers', () => {
    expect(schema).toContain('model AgentMonthlyBillExportSnapshot');
    expect(schema).toMatch(
      /model AgentMonthlyBillExportSnapshot[\s\S]*exportId\s+String[\s\S]*billId\s+String[\s\S]*sequence\s+Int[\s\S]*payload\s+Json/,
    );
    expect(migration).toContain(
      'CREATE TABLE "AgentMonthlyBillExportSnapshot"',
    );
    expect(migration).toContain(
      '"AgentMonthlyBillExportSnapshot_exportId_sequence_key"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AgentMonthlyBillExportSnapshot_immutable"',
    );
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/i);
    expect(migration).not.toMatch(/ALTER TABLE "(?:Bill|BillItem|BillPayment)"/);
  });

  it('locks member orders before the final confirmation revalidation', () => {
    const lock = migration.indexOf('FOR SHARE OF order_row');
    const revalidation = migration.indexOf(
      'Agent monthly bill contains stale order snapshots',
    );
    expect(lock).toBeGreaterThan(0);
    expect(revalidation).toBeGreaterThan(lock);
  });
});
