import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260829012500_external_processing_five_tier_fresh_install/migration.sql',
  ),
  'utf8',
);

describe('external processing five-tier fresh-install compatibility migration', () => {
  it('runs before the original handoff migration and preserves published history', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain("source.\"id\" = 'cpb_external_processing_rule_v3'");
    expect(migration).toContain(
      "'cpb_external_processing_rule_v4_five_tier'",
    );
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderPriceVersionLock"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/u);
    expect(migration).not.toMatch(/DELETE\s+FROM/u);
  });

  it('only handles the exact no-schedule v3 shape and does not invent schedule evidence', () => {
    expect(migration).toContain(
      "future_book.\"effectiveFrom\" > clock.\"releasedAt\"",
    );
    expect(migration).toContain(
      "\"id\" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'",
    );
    expect(migration).toContain(
      'Fresh-install release invented scheduled-version evidence',
    );
    expect(
      migration.match(/supersedesScheduledPriceBookId/gu),
    ).toHaveLength(1);
    expect(migration).toContain("'supersedesPriceBookId', source.\"id\"");
    expect(migration).toContain("- 'ruleSetSha256'");
    expect(migration).toContain("'status', 'SYSTEM_RELEASE'");
    expect(migration).not.toMatch(
      /'ruleSetSha256'\s*,\s*'[0-9a-f]{64}'/u,
    );
  });

  it('publishes the documented continuous 30k and 50k tiers', () => {
    expect(migration).toContain('THEN 40000');
    expect(migration).toContain('40001,');
    expect(migration).toContain('0.1600');
    expect(migration).toContain('0.1800');
    expect(migration).toContain('Fresh-install five-tier successor rule count is not 145');
    expect(migration).toContain('Fresh-install five-tier custom tier count is not 50');
    expect(migration).toContain('Fresh-install custom tiers contain a discontinuity');
    expect(migration).toContain(
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
    );
  });
});
