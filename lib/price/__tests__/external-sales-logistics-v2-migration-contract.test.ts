import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260826185000_external_sales_logistics_rule_v2',
  'migration.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const historicalMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260808100000_external_sales_logistics_charges',
    'migration.sql',
  ),
  'utf8',
);

describe('external-sales logistics rule v2 migration contract', () => {
  it('publishes one guarded forward-only logistics price-book version', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain(
      'CREATE TEMP TABLE "_ExternalLogisticsV2SourceBook"',
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'Cannot publish external logistics rule v2 without one active source book'",
    );
    expect(migration).toContain(
      "'LOGISTICS'::\"CustomerPriceBookPurpose\"",
    );
    expect(migration).toContain("'EXTERNAL_SALES'::\"OrderSettlementType\"");
    expect(migration).toContain("'cpb_external_logistics_rule_v2'");
    expect(migration).toContain("'EXTERNAL_SALES_LOGISTICS_RULES'");
    expect(migration).toMatch(
      /UPDATE "CustomerPriceBook"[\s\S]+"effectiveTo" = clock\."releasedAt"/,
    );
  });

  it('stores the order-level segmented carton rule as an automatic charge', () => {
    expect(migration).toContain("'scope', 'ORDER_TOTAL_QUANTITY'");
    expect(migration).toContain("'segmentQuantity', 5000");
    expect(migration).toContain("'segmentAmount', 8");
    expect(migration).toContain("'segmentedAboveMaximum', TRUE");
    expect(migration).toContain("'CARTON_ORDER_QUANTITY_TIER'");
    expect(migration).toMatch(
      /WHEN category\."code" = 'PACKING_MATERIAL'[\s\S]+FALSE,[\s\S]+TRUE,/,
    );
    expect(migration).not.toContain('纸箱表没有 5000 个以上规则');
  });

  it('stores the ZTO 2000-item boundary and upward weight-rounding facts', () => {
    expect(migration).toContain("'ztoMaximumOrderQuantity', 2000");
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
  });

  it('copies only active shipping and carton rules into the new version', () => {
    expect(migration).toContain('source_rule."isActive" = TRUE');
    expect(migration).toContain(
      "category.\"code\" IN ('SHIPPING_FEE', 'PACKING_MATERIAL')",
    );
    expect(migration).toContain("WHEN category.\"code\" = 'PACKING_MATERIAL'");
    expect(migration).toContain("ELSE source_rule.\"triggerCondition\"");
    expect(migration).toContain("ELSE source_rule.\"sourceName\"");
  });

  it('does not rewrite historical migrations or historical order totals', () => {
    expect(historicalMigration).toContain(
      "'EXTERNAL_SALES_LOGISTICS_202608'",
    );
    expect(historicalMigration).toContain('纸箱表没有 5000 个以上规则');
    expect(migration).not.toMatch(/UPDATE\s+"Order"/);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"CustomerPrice/);
  });
});
