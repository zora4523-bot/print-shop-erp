import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260827102000_repair_external_pricing_v2_history/migration.sql',
  ),
  'utf8',
);

describe('external pricing v2 forward repair migration', () => {
  it('runs atomically under the shared price-version lock', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain('LOCK TABLE');
  });

  it('restores only future books bearing the v2 deactivation fingerprint', () => {
    expect(migration).toContain("'cpb_external_processing_rule_v2'");
    expect(migration).toContain("'cpb_external_logistics_rule_v2'");
    expect(migration).toContain(
      'scheduled."updatedAt" = release_marker."createdAt"',
    );
    expect(migration).toMatch(
      /current_replacement\."id"\s*=\s*'cpb_external_processing_rule_v2_packaging'/u,
    );
    expect(migration).toContain(
      'scheduled."effectiveFrom" > current_replacement."effectiveFrom"',
    );
    expect(migration).toMatch(
      /scheduled\."effectiveFrom"\s*>\s*\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/u,
    );
    expect(migration).toMatch(
      /scheduled\."effectiveTo" IS NULL[\s\S]*scheduled\."effectiveTo"\s*>\s*\(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/u,
    );
    expect(migration).toContain(
      "COALESCE(scheduled.\"notes\"->'workflow'->>'status', '') <> 'DRAFT'",
    );
    expect(migration).toContain('conflict."isActive" = TRUE');
    expect(migration).toContain('SET\n  "effectiveTo" = repair."firstScheduledFrom"');
    expect(migration).toContain('SET\n  "isActive" = TRUE');
    expect(migration).toContain(
      'External pricing v2 scheduled versions were not restored safely',
    );
  });

  it('restores the audited mixed-book and carton source evidence', () => {
    expect(migration).toContain(
      '长昆中通报价表(1).xlsx + 纸箱价格表1(1).xlsx',
    );
    expect(migration).toContain(
      'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
    );
    expect(migration).toContain('纸箱价格表1(1).xlsx');
    expect(migration).toContain(
      '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
    );
    expect(migration).toContain('"sourceSheet" = \'Sheet1\'');
    expect(migration).toContain(
      'External carton source evidence was not repaired',
    );
  });

  it('removes synthetic weight derivation metadata in favor of carrier facts', () => {
    for (const key of [
      'billableWeightRounding',
      'minimumBillableWeightKg',
      'gramsPerItemByPaperWeightGsm',
      'tenThousandEnvelopeGramsPerItem',
    ]) {
      expect(migration).toContain(`- '${key}'`);
    }
    expect(migration).toContain(
      "'billableWeightInput', 'CARRIER_CONFIRMED'",
    );
    expect(migration).toContain(
      'External logistics book still contains synthetic billable-weight facts',
    );
  });

  it('does not rewrite historical orders, charges, or migration files', () => {
    expect(migration).not.toMatch(/UPDATE\s+"Order"/);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/);
    expect(migration).not.toMatch(/DELETE\s+FROM/);
  });
});
