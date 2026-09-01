import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260830170000_external_processing_print_null_sentinel/migration.sql',
  ),
  'utf8',
);

describe('external processing print null-sentinel migration', () => {
  it('publishes the next truth-repair successor without rewriting source rules', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain(
      "source.\"id\" = 'cpb_external_processing_truth_repair_v1'",
    );
    expect(migration).not.toContain('source."version" = 7');
    expect(migration).toContain('SELECT MAX(candidate."version")');
    expect(migration).toContain('source."version" + 1');
    expect(migration).toContain(
      "'cpb_external_processing_print_sentinel_v1'",
    );
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/DELETE\s+FROM/u);
  });

  it('adds the exact evidenced Q2000 blank and keeps it distinct from zero', () => {
    expect(migration).toContain(
      'DROP CONSTRAINT "CustomerPriceRule_values_valid"',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "CustomerPriceRule_values_valid" CHECK',
    );
    expect(migration).toContain('"exclusiveGroup" = \'COLOR_BASE\'');
    expect(migration).toMatch(
      /"calculationType"\s*=\s*'FIXED_AMOUNT'::"CustomerPriceCalculationType"/u,
    );
    expect(migration).toContain(
      "'BASE_COLOR-ICE-WHITE-160-MID_Q2000'",
    );
    expect(migration).toContain(
      "'\u00a73 \u51b0\u767d\u7eb8160g\u4e2d\u53f7\u8868 Q2000 \u7a7a\u683c'",
    );
    expect(migration).toMatch(
      /'BASE_COLOR-ICE-WHITE-160-MID_Q2000',[\s\S]*?rule\."calculationType",\s*NULL,[\s\S]*?2000,\s*2000,/u,
    );
    expect(migration).toContain('rule."amount" IS NULL');
    expect(migration).toContain('rule."blocksAutomaticQuote" = FALSE');
  });

  it('guards lineage, terminal closure, provenance and one current version', () => {
    expect(migration).toContain(
      'Expected current processing truth-repair identity has invalid source provenance',
    );
    expect(migration).toContain(
      'book."effectiveFrom" <= clock."releasedAt"',
    );
    expect(migration).toContain(
      'book."effectiveTo" > clock."releasedAt"',
    );
    expect(migration).toContain(
      'current_book."id" = \'cpb_external_processing_truth_repair_v1\'',
    );
    expect(migration).toContain(
      'Expected processing truth-repair source to contain 144 rules',
    );
    expect(migration).toContain('Print-sentinel successor rule count is not 145');
    expect(migration).toContain('A COLOR_BASE null sentinel is not terminal');
    expect(migration).toContain('source."effectiveTo" = successor."effectiveFrom"');
    expect(migration).toContain("'status', 'SYSTEM_RELEASE'");
    expect(migration).toContain("'publishedBy', 'SYSTEM_MIGRATION'");
    expect(migration).toContain('Processing current version is not unique after sentinel release');
    expect(migration).not.toMatch(
      /'ruleSetSha256'\s*,\s*'[0-9a-f]{64}'/u,
    );
  });
});
