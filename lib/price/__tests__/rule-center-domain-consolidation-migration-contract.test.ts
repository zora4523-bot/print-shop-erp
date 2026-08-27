import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260826170000_rule_center_domain_consolidation/migration.sql',
  ),
  'utf8',
);

const openIntervalBoundaryMigration = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260826173000_rule_center_open_interval_utc_boundary/migration.sql',
  ),
  'utf8',
);

describe('rule-centre domain consolidation migration', () => {
  it('backfills quote papers into Material(PAPER) without deleting quote SKUs', () => {
    expect(migration).toContain('FROM "Product"');
    expect(migration).toContain("'PAPER'::\"MaterialCategory\"");
    expect(migration).toContain('INSERT INTO "Material"');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Product"/i);
  });

  it('soft-retires duplicated craft and empty legacy categories', () => {
    expect(migration).toContain('WHERE "code" = \'STOCK_FOIL\'');
    expect(migration).toContain('"isActive" = FALSE');
    expect(migration).toContain("'GENERIC_STOCK'::\"ProductCategory\"");
    expect(migration).toContain("'STOCK_FOIL_ADD'::\"ProductCategory\"");
    expect(migration).toContain("'BYO_MATERIAL'::\"ProductCategory\"");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Craft"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"ProductCategoryNode"/i);
  });

  it('publishes a new immutable price-book version for the resolved boundary', () => {
    expect(migration).toContain('COALESCE(MAX(book."version"), 0) + 1');
    expect(migration).toContain('"effectiveTo" = CASE');
    expect(migration).toContain('next_effective_from := GREATEST');
    expect(migration).toContain('INSERT INTO "CustomerPriceBook"');
    expect(migration).toContain("'supersedesPriceBookId'");
    expect(migration).toContain('STOCK_LOCAL_FOIL_SINGLE_GTE_1000');
    expect(migration).toContain('STOCK_LOCAL_FOIL_DOUBLE_GTE_1000');
  });

  it('records system-release provenance without inheriting or inventing a rule-set hash', () => {
    const notesBlock = migration.slice(
      migration.indexOf('next_notes :='),
      migration.indexOf('INSERT INTO "CustomerPriceBook"'),
    );
    expect(notesBlock).toContain("- 'workflow'");
    expect(notesBlock).toContain("- 'ruleSetSha256'");
    expect(notesBlock).toContain("'status', 'SYSTEM_RELEASE'");
    expect(notesBlock).toContain("'createdBy', 'SYSTEM_MIGRATION'");
    expect(notesBlock).not.toMatch(/'ruleSetSha256'\s*,/);
  });

  it('structures item and packaging rules only inside the cloned book', () => {
    const cloneEnd = migration.indexOf(
      'WHERE rule."priceBookId" = source_book."id";',
    );
    const itemTransform = migration.indexOf('WITH cloned_item_rules AS');
    const packagingTransform = migration.indexOf(
      '-- The confirmed 0.1 / 0.2 rates apply to packaging-group bag counts',
    );
    expect(itemTransform).toBeGreaterThan(cloneEnd);
    expect(packagingTransform).toBeGreaterThan(itemTransform);
    expect(
      migration.slice(itemTransform, migration.indexOf('-- Keep the old warning')),
    ).toContain('WHERE rule."priceBookId" = next_book_id');
  });

  it('uses disjoint ranges at the 1000 boundary and retains the legacy craft alias', () => {
    expect(migration).toContain("'STOCK_LOCAL_FOIL_SINGLE_LT_1000'");
    expect(migration).toContain("'STOCK_LOCAL_FOIL_DOUBLE_LT_1000'");
    expect(migration).toContain("'STOCK_LOCAL_FOIL_SINGLE_GTE_1000'");
    expect(migration).toContain("'STOCK_LOCAL_FOIL_DOUBLE_GTE_1000'");
    expect(migration).toContain('"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"]');
    expect(migration).toContain("'STOCK_TEN_THOUSAND_LOCAL_MACHINE_FEE'");
  });

  it('repairs open-ended immediate releases without moving scheduled versions', () => {
    expect(openIntervalBoundaryMigration).toContain(
      "CURRENT_TIMESTAMP AT TIME ZONE 'UTC'",
    );
    expect(openIntervalBoundaryMigration).toContain(
      'book."effectiveFrom" > utc_release_at',
    );
    expect(openIntervalBoundaryMigration).toContain(
      'book."effectiveFrom" <= CURRENT_TIMESTAMP::TIMESTAMP',
    );
    expect(openIntervalBoundaryMigration).not.toContain(
      'book."effectiveTo" IS NOT NULL',
    );
    expect(openIntervalBoundaryMigration).toContain(
      '"effectiveTo" = structured_book."effectiveFrom"',
    );
  });
});
