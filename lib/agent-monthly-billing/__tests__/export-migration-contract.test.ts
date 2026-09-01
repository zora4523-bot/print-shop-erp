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
    '20260902120400_agent_monthly_bill_exports',
    'migration.sql',
  ),
  'utf8',
);

function prismaBlock(kind: 'enum' | 'model', name: string): string {
  const match = schema.match(
    new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`Missing Prisma ${kind} ${name}`);
  return match[1];
}

describe('agent monthly bill export additive migration contract', () => {
  it('uses a dedicated export ledger and status enum', () => {
    expect(prismaBlock('enum', 'AgentMonthlyBillExportStatus')).toMatch(
      /PENDING[\s\S]*READY[\s\S]*FAILED[\s\S]*EXPIRED/,
    );
    const model = prismaBlock('model', 'AgentMonthlyBillExport');
    for (const field of [
      'requestKey',
      'createdById',
      'filters',
      'snapshotAt',
      'schemaVersion',
      'backgroundJobId',
      'matchedBillCount',
      'artifactName',
      'byteSize',
      'expiresAt',
      'downloadCount',
      'lastErrorCode',
    ]) {
      expect(model).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(model).toContain('AgentMonthlyBillExportStatus');
    expect(model).not.toContain('OrderExportStatus');
  });

  it('does not alter the legacy OrderExport ledger or any billing fact', () => {
    expect(migration).toContain('CREATE TABLE "AgentMonthlyBillExport"');
    expect(migration).toContain(
      'CREATE TYPE "AgentMonthlyBillExportStatus"',
    );
    expect(migration).not.toMatch(/ALTER TABLE "OrderExport"/);
    expect(migration).not.toMatch(/ALTER TABLE "(?:Bill|AgentMonthlyBill)"/);
    expect(migration).not.toMatch(
      /DROP\s+(?:TYPE|TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"/i,
    );
  });

  it('enforces ownership, unique idempotency and valid terminal shapes', () => {
    expect(migration).toContain(
      '"AgentMonthlyBillExport_requestKey_key"',
    );
    expect(migration).toContain(
      '"AgentMonthlyBillExport_backgroundJobId_key"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AgentMonthlyBillExport_state_shape_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AgentMonthlyBillExport_createdById_fkey"',
    );
    expect(migration).toContain('ON DELETE RESTRICT');
  });
});
