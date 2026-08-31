import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260827101000_external_processing_v2_packaging_rules',
    'migration.sql',
  ),
  'utf8',
);

describe('external processing v2 packaging-rule repair migration', () => {
  it('releases a complete successor instead of rewriting published rules', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      'cpb_external_processing_rule_v2_packaging',
    );
    expect(migration).toContain(
      'WHERE "id" = source_book."id"',
    );
    expect(migration).toContain(
      `WHERE rule."priceBookId" = source_book."id"`,
    );
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/i);
    expect(migration).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"OrderPricingRevision"/i,
    );
  });

  it('publishes exactly the confirmed single-style and mixed-style rates', () => {
    expect(migration).toContain('PACKAGING_SINGLE_STYLE_PER_BAG');
    expect(migration).toContain('PACKAGING_MIXED_STYLE_PER_BAG');
    expect(migration).toContain(`'PER_BAG'::"CustomerPriceCalculationType"`);
    expect(migration).toContain(`'ADD_ON'::"CustomerPriceRuleKind"`);
    expect(migration).toContain(`'PACKAGING_GROUP_MODE'`);
    expect(migration).toContain(`'PACKING'::CITEXT`);
    expect(migration).toContain('0.1000');
    expect(migration).toContain('0.2000');
    expect(migration).toContain(
      `"packagingModes":["SINGLE_STYLE"]`,
    );
    expect(migration).toContain(
      `"packagingModes":["MIXED_STYLE"]`,
    );
    expect(migration).toContain(`'§4'`);
  });

  it('fails closed for partial or conflicting repair state', () => {
    expect(migration).toContain(
      'requires exactly one current external processing book',
    );
    expect(migration).toContain(
      'superseded v2 without complete packaging rules',
    );
    expect(migration).toContain(
      'partial packaging rules; automatic repair is unsafe',
    );
    expect(migration).toContain(
      'released_rule_count <> source_rule_count + 2',
    );
    expect(migration).toContain(
      'target_rule_count <> 2 OR valid_packaging_count <> 2',
    );
  });

  it('records the two constants without claiming an application rule-set hash', () => {
    expect(migration).toContain(`'singleStyleBagFee', 0.1`);
    expect(migration).toContain(`'mixedStyleBagFee', 0.2`);
    expect(migration).toContain(`- 'ruleSetSha256'`);
    expect(migration).toContain('不伪造 ruleSetSha256');
  });
});
