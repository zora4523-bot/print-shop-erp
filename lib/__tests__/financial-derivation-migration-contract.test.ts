import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260830180000_financial_derivation_integrity',
    'migration.sql',
  ),
  'utf8',
);
const prismaSchema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('financial derivation integrity migration contract', () => {
  it('atomically serializes bill and receipt writes while installing guards', () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]+BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      'LOCK TABLE "Bill", "BillItem", "PurchaseReceipt"',
    );
  });

  it('uses a per-sales/month sequence and preserves issued statements', () => {
    expect(migration).toContain(
      'ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1',
    );
    expect(migration).toContain(
      '"Bill"("salesUserId", "period", "sequence")',
    );
    expect(prismaSchema).toContain('sequence      Int        @default(1)');
    expect(prismaSchema).toContain(
      '@@unique([salesUserId, period, sequence])',
    );
  });

  it('fails migration on duplicate order collection before adding global uniqueness', () => {
    const guard = migration.indexOf('HAVING COUNT(*) > 1');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "BillItem_orderId_key"');
    expect(guard).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(guard);
    expect(prismaSchema).toContain('@@unique([orderId])');
  });

  it('stores only normalized SHA-256 receipt request fingerprints', () => {
    expect(migration).toContain(
      'ADD COLUMN "requestFingerprint" VARCHAR(64)',
    );
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(prismaSchema).toMatch(
      /requestFingerprint\s+String\?\s+@db\.VarChar\(64\)/,
    );
  });
});
