import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260829013000_external_processing_five_tier/migration.sql',
  ),
  'utf8',
);

describe('external processing five-tier migration', () => {
  it('publishes a successor without rewriting historical rules or orders', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain('cpb_external_processing_rule_v4_five_tier');
    expect(migration).toContain('cpb_external_processing_rule_v3');
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderPriceVersionLock"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/u);
    expect(migration).not.toMatch(/DELETE\s+FROM/u);
  });

  it('keeps the 30k interval and adds all five 50k product rows', () => {
    expect(migration).toContain('THEN 40000');
    expect(migration).toContain('40001,');
    expect(migration).toContain('0.1600');
    expect(migration).toContain('0.1800');
    expect(migration).toContain("'EXT-CUSTOM-MID'");
    expect(migration).toContain("'EXT-CUSTOM-SQUARE'");
    expect(migration).toContain("'EXT-CUSTOM-WEST-MID'");
    expect(migration).toContain("'EXT-CUSTOM-LARGE'");
    expect(migration).toContain("'EXT-CUSTOM-WEST-LARGE'");
    expect(migration).toContain('successor custom tier count is not 50');
    expect(migration).toContain('Custom tiers contain a gap, overlap');
  });

  it('records the confirmed source and retires only the incompatible schedule', () => {
    expect(migration).toContain(
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
    );
    expect(migration).toContain(
      'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e',
    );
    expect(migration).toContain('Legacy scheduled processing version is already referenced');
    expect(migration).toContain('"isActive" = FALSE');
    expect(migration).toContain('supersedesScheduledPriceBookId');
    expect(migration).toContain('不伪造ruleSetSha256');
  });
});
