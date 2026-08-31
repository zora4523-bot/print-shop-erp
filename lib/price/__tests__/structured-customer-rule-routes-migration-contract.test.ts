import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(
    path.join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  );
}

const compatibilityMarker = migration(
  '20260826150000_structured_customer_rule_routes',
);
const structuredRelease = migration(
  '20260826170000_rule_center_domain_consolidation',
);

describe('structured customer-rule route migration contract', () => {
  it('keeps the earlier published-book migration as a non-mutating marker', () => {
    expect(compatibilityMarker.trimStart()).toMatch(/^BEGIN;/);
    expect(compatibilityMarker.trimEnd()).toMatch(/COMMIT;$/);
    expect(compatibilityMarker).not.toMatch(/UPDATE\s+"CustomerPriceRule"/i);
    expect(compatibilityMarker).not.toMatch(/DELETE\s+FROM\s+"CustomerPriceRule"/i);
    expect(compatibilityMarker).not.toMatch(/INSERT\s+INTO\s+"CustomerPriceRule"/i);
  });

  it('derives routes only after rules have been cloned to next_book_id', () => {
    const clone = structuredRelease.indexOf(
      'WHERE rule."priceBookId" = source_book."id";',
    );
    const transform = structuredRelease.indexOf('WITH cloned_item_rules AS');
    expect(clone).toBeGreaterThan(0);
    expect(transform).toBeGreaterThan(clone);

    const structuredBlock = structuredRelease.slice(
      transform,
      structuredRelease.indexOf(
        '-- Keep the old warning for audit',
        transform,
      ),
    );
    expect(structuredBlock).toContain(
      'WHERE rule."priceBookId" = next_book_id',
    );
    expect(structuredBlock).not.toContain(
      'WHERE rule."priceBookId" = source_book."id"',
    );
  });

  it('maps each reviewed product family and generic references to closed routes', () => {
    expect(structuredRelease).toContain(
      "WHEN product_code LIKE 'EXT-STOCK-%' THEN 'STOCK_BLANK'",
    );
    expect(structuredRelease).toContain(
      "THEN 'CUSTOM_SINGLE_FLAT_FOIL'",
    );
    expect(structuredRelease).toContain(
      "WHEN product_code LIKE 'EXT-COLOR-%' THEN 'COLOR_PRINT'",
    );
    expect(structuredRelease).toContain(
      `'["COLOR_PRINT","CUSTOM_SINGLE_FLAT_FOIL","STOCK_BLANK"]'::JSONB`,
    );
    expect(structuredRelease).toContain("'{schemaVersion}'");
    expect(structuredRelease).toContain("'{target}'");
    expect(structuredRelease).toContain("'{pricingRoutes}'");
  });

  it('fails the release if cloned item rules remain structurally incomplete', () => {
    expect(structuredRelease).toContain(
      'Structured pricing-route conversion left incomplete cloned item rules',
    );
    expect(structuredRelease).toContain(
      `rule."triggerCondition"->>'target' IS DISTINCT FROM 'ITEM'`,
    );
    expect(structuredRelease).toContain(
      `jsonb_typeof(rule."triggerCondition"->'pricingRoutes')`,
    );
  });
});
