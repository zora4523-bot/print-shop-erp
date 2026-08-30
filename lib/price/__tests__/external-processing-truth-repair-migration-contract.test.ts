import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260830090000_external_processing_truth_repair/migration.sql',
  ),
  'utf8',
);

describe('external processing price-truth repair migration', () => {
  it('publishes one successor and never rewrites historical rules', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain('cpb_external_processing_truth_repair_v1');
    expect(migration).toContain('source."version" + 1');
    expect(migration).toContain(
      'current_book."id" = source."id"',
    );
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/DELETE\s+FROM/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderPriceVersionLock"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/u);
  });

  it('repairs the two documented amounts and omits the unsupported square', () => {
    expect(migration).toContain(
      "WHEN 'BASE_STOCK-PEARL-RED-160-LARGE' THEN 0.1300",
    );
    expect(migration).toContain(
      "WHEN 'BASE_STOCK-SOFT-TOUCH-200-LARGE' THEN 0.2500",
    );
    expect(migration).toContain(
      "rule.\"code\"::TEXT <> 'BASE_STOCK-SOFT-TOUCH-200-SQUARE'",
    );
    expect(migration).toContain(
      "product.\"code\" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT",
    );
    expect(migration).toMatch(
      /UPDATE\s+"Product"[\s\S]*?"isActive"\s*=\s*FALSE/u,
    );
    expect(migration).toContain(
      'Processing truth-repair successor rule count is not 144',
    );
  });

  it('is lineage-guarded, idempotent, continuous and does not invent a rule hash', () => {
    expect(migration).toContain("source.\"version\" >= 4");
    expect(migration).toContain(
      "source.\"notes\" ->> 'ruleVersion' = '2026-08-29-five-tier'",
    );
    expect(migration).toContain(
      "repaired.\"id\" = 'cpb_external_processing_truth_repair_v1'",
    );
    expect(migration).toContain(
      'source."effectiveTo" = repaired."effectiveFrom"',
    );
    expect(migration).toContain("- 'ruleSetSha256'");
    expect(migration).toContain("'status', 'SYSTEM_RELEASE'");
    expect(migration).toContain("'publishedBy', 'SYSTEM_MIGRATION'");
    expect(migration).toContain('不伪造ruleSetSha256');
    expect(migration).not.toMatch(
      /'ruleSetSha256'\s*,\s*'[0-9a-f]{64}'/u,
    );
  });
});
