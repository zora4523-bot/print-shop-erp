import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = process.cwd();
const schema = readFileSync(join(workspace, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(
    workspace,
    'prisma/migrations/20260826182000_order_manual_charges_and_plate_details/migration.sql',
  ),
  'utf8',
);

describe('structured commercial details migration contract', () => {
  it('adds soft-removable per-style multi-line plate details', () => {
    expect(schema).toContain('model OrderItemPlateDetail {');
    expect(schema).toMatch(/plateDetails\s+OrderItemPlateDetail\[\]/);
    expect(migration).toContain(
      'CREATE TABLE "OrderItemPlateDetail"',
    );
    expect(migration).toContain(
      '"OrderItemPlateDetail_orderItemId_sequence_key"',
    );
    expect(migration).toContain('"isActive" BOOLEAN NOT NULL DEFAULT TRUE');
    expect(migration).toContain('"removedById" TEXT');
  });

  it('seeds the canonical customer charge categories', () => {
    for (const code of [
      'PLATE_MAKING_FEE',
      'SAMPLE_FEE',
      'OTHER_PACKAGING_FEE',
      'APPROVED_ADJUSTMENT',
    ]) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it('validates the historical constraint before replacing it', () => {
    expect(migration).toContain(
      "conname = 'OrderCustomerCharge_values_valid'",
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "OrderCustomerCharge_values_valid"',
    );
    expect(migration).toContain(
      '("isAdjustment" AND "amount" BETWEEN -9999999999.99 AND 9999999999.99)',
    );
  });
});
