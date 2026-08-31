import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260827104000_external_logistics_weight_policy_v3/migration.sql',
  ),
  'utf8',
);

describe('external logistics weight policy v3 migration', () => {
  it('publishes forward-only successors for the current and future timeline', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain(
      "'cpb_external_logistics_weight_policy_v3'",
    );
    expect(migration).toContain(
      "'EXTERNAL_SALES_LOGISTICS_RULES'",
    );
    expect(migration).toContain('MAX(book."version")');
    expect(migration).toContain('ranked."successorOrdinal"');
    expect(migration).toContain('source."sourceEffectiveFrom"');
    expect(migration).toContain('source."sourceEffectiveTo"');
    expect(migration).not.toContain("'cpb_external_logistics_rule_v2'");
    expect(migration).toMatch(/SET\s+"isActive"\s*=\s*FALSE/u);
    expect(migration).toContain('AND NOT source."isCurrent"');
    expect(migration).toContain(
      "'cpb_external_logistics_weight_v3_' || substr(",
    );
    expect(migration).toContain(
      'External logistics weight policy v3 source has no rules',
    );
    expect(migration).toContain(
      'External logistics v3 did not create every successor',
    );
    expect(migration).toContain(
      'External logistics v3 created an overlapping timeline',
    );
  });

  it('stores the complete authoritative estimate and override policy', () => {
    expect(migration).toContain(
      "'billableWeightInput', 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'",
    );
    expect(migration).toContain("'ACTUAL_FULFILLMENT_WEIGHT'");
    expect(migration).toContain("'SERVER_ESTIMATE'");
    expect(migration).toContain("'maxOrderQuantity', 2000");
    expect(migration).toContain("'billableWeightRounding', 'CEIL_KG'");
    expect(migration).toContain("'minimumBillableWeightKg', 1");
    for (const [paperWeightGsm, gramsPerItem] of [
      ['120', '4.5'],
      ['150', '6'],
      ['160', '6'],
      ['180', '6.75'],
      ['200', '8'],
      ['230', '10'],
    ]) {
      expect(migration).toContain(`'${paperWeightGsm}', ${gramsPerItem}`);
    }
    expect(migration).toContain("'tenThousandEnvelopeGramsPerItem', 10");
    expect(migration).toContain("'fileName', '加工费计费规则.md'");
    expect(migration).toContain(
      '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
    );
  });

  it('clones every segment rule without rewriting predecessor or order evidence', () => {
    expect(migration).toContain(
      'External logistics v3 did not preserve every source rule',
    );
    expect(migration).not.toMatch(
      /FROM "CustomerPriceRule" rule[\s\S]{0,300}rule\."isActive" = TRUE/u,
    );
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/UPDATE\s+"Order"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/u);
    expect(migration).not.toMatch(/DELETE\s+FROM/u);
    expect(migration).toContain(
      'md5(source."targetId" || \':\' || rule."id")',
    );
    expect(migration).toContain(
      'predecessor."notes" IS DISTINCT FROM source."notes"',
    );
    expect(migration).toContain(
      'jsonb_typeof(source."notes"->\'workflow\') = \'object\'',
    );
    expect(migration).toContain(
      'External logistics v3 rewrote predecessor evidence',
    );
  });
});
