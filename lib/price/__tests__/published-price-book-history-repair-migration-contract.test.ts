import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260826174000_restore_published_price_book_history/migration.sql',
  ),
  'utf8',
);

const auditedSourceSha =
  '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733';

describe('published price-book history repair migration', () => {
  it('runs atomically under the shared price-rule lock', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain('LOCK TABLE');
  });

  it('strictly scopes restoration to audited processing books v1/v2', () => {
    expect(migration.match(new RegExp(auditedSourceSha, 'g'))?.length).toBeGreaterThanOrEqual(
      5,
    );
    expect(migration).toContain(
      `book."code" = 'EXTERNAL_SALES_PROCESSING_202608'::CITEXT`,
    );
    expect(migration).toContain('book."version" IN (1, 2)');
    expect(migration).toContain(
      `book."settlementType" = 'EXTERNAL_SALES'::"OrderSettlementType"`,
    );
    expect(migration).toContain(
      `book."purpose" = 'PROCESSING'::"CustomerPriceBookPurpose"`,
    );
  });

  it('removes only migration-added condition keys from general source rules', () => {
    expect(migration).toContain("- 'schemaVersion'");
    expect(migration).toContain("- 'pricingRoutes'");
    expect(migration).toContain("- 'target'");
    expect(migration).toContain("NULLIF(");
    expect(migration).toContain("'{}'::JSONB");
    expect(migration).toContain(
      'Published workbook history still contains structural migration keys',
    );
  });

  it('restores packaging reference semantics without overwriting version amounts', () => {
    const packagingStart = migration.indexOf(
      '-- Restore the two workbook references to their source semantics',
    );
    const packagingEnd = migration.indexOf(
      '-- The cloned structural books must not inherit',
    );
    const packagingBlock = migration.slice(packagingStart, packagingEnd);
    expect(packagingBlock).toContain("THEN '单款入袋参考价'");
    expect(packagingBlock).toContain(
      "THEN '两款及以上混装入袋参考价'",
    );
    expect(packagingBlock).toContain(
      `'REFERENCE'::"CustomerPriceRuleKind"`,
    );
    expect(packagingBlock).toContain(
      `'PER_PIECE'::"CustomerPriceCalculationType"`,
    );
    expect(packagingBlock).toContain(
      '{"craftCodes":["PACKING"],"maxItemCount":1}',
    );
    expect(packagingBlock).toContain(
      '{"craftCodes":["PACKING"],"minItemCount":2}',
    );
    expect(packagingBlock).toContain(
      '2个款起算混装 0.2 元/袋；是否替代单款规则未确认，仅供人工报价参考。',
    );
    expect(packagingBlock).not.toMatch(/"amount"\s*=/);
  });

  it('replaces inherited workflow/hash with hashless system-release provenance', () => {
    const cleanupStart = migration.indexOf(
      '-- The cloned structural books must not inherit',
    );
    const cleanupEnd = migration.indexOf('DO $$', cleanupStart);
    const cleanupBlock = migration.slice(cleanupStart, cleanupEnd);
    expect(cleanupBlock).toContain("- 'workflow'");
    expect(cleanupBlock).toContain("- 'ruleSetSha256'");
    expect(cleanupBlock).toContain("'status', 'SYSTEM_RELEASE'");
    expect(cleanupBlock).toContain("'createdBy', 'SYSTEM_MIGRATION'");
    expect(cleanupBlock).not.toMatch(/'ruleSetSha256'\s*,/);
    expect(migration).toContain(
      'Structured system release still carries inherited workflow/hash evidence',
    );
  });
});
