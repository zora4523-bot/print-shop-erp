import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260830091000_external_processing_truth_repair_integrity_guard/migration.sql',
  ),
  'utf8',
);

describe('external processing truth-repair integrity guard', () => {
  it('is an assertion-only fail-closed migration', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain(
      'cpb_external_processing_truth_repair_v1',
    );
    expect(migration).toContain(
      'Processing truth-repair target id is occupied by invalid provenance',
    );
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/iu);
    expect(migration).not.toMatch(/\bUPDATE\s+"/iu);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it('locks the documented amounts, unsupported combination and provenance', () => {
    expect(migration).toContain(
      "rule.\"code\"::TEXT = 'BASE_STOCK-PEARL-RED-160-LARGE'",
    );
    expect(migration).toContain('rule."amount" = 0.1300');
    expect(migration).toContain(
      "rule.\"code\"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-LARGE'",
    );
    expect(migration).toContain('rule."amount" = 0.2500');
    expect(migration).toContain(
      "product.\"code\" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'::CITEXT",
    );
    expect(migration).toContain('2026-08-30-price-truth-repair');
    expect(migration).toContain(
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
    );
  });
});
