import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260827103000_external_processing_rule_v3_conditions/migration.sql',
  ),
  'utf8',
);

describe('external processing rule v3 migration', () => {
  it('creates a new half-open version without rewriting v2 rules or orders', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain('cpb_external_processing_rule_v3');
    expect(migration).toContain('MAX(book."version")');
    expect(migration).toContain('source."sourceEffectiveTo"');
    expect(migration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/u);
    expect(migration).not.toMatch(/UPDATE\s+"Order"/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderCustomerCharge"/u);
  });

  it('upgrades only the explicit system packaging predecessor lineage', () => {
    expect(migration).toContain(
      'book."id" = \'cpb_external_processing_rule_v2_packaging\'',
    );
    expect(migration).toContain(
      "book.\"notes\"->'workflow'->>'status' = 'SYSTEM_RELEASE'",
    );
    expect(migration).toContain(
      "book.\"notes\"->>'supersedesPriceBookId' =",
    );
    expect(migration).toContain(
      "book.\"notes\"->'workflow'->'basedOn'->>'id' =",
    );
  });

  it('keeps a non-system current version as a deliberate no-op', () => {
    expect(migration).toContain(
      'IF (SELECT COUNT(*) FROM "_ExternalProcessingV3Source") = 0 THEN',
    );
    expect(migration).toContain(
      'CROSS JOIN "_ExternalProcessingV3Source" source',
    );
    expect(migration).toContain(
      'IF EXISTS (SELECT 1 FROM "_ExternalProcessingV3Source") THEN',
    );
    expect(migration).toMatch(
      /An\s+--\s+administrator-owned current version must remain untouched/u,
    );
  });

  it('moves lamination eligibility into typed rule conditions', () => {
    expect(migration).toContain("'{laminations}'");
    expect(migration).toContain("'[\"MATTE\"]'::JSONB");
    expect(migration).toContain("'[\"NONE\"]'::JSONB");
    expect(migration).toContain('COLOR_NONSTANDARD_LAMINATION_MANUAL');
    expect(migration).toContain(
      '"laminations":["SOFT_TOUCH","NEW_GLOSS","LASER"]',
    );
  });

  it('expresses double-sided and back-side pricing boundaries as blockers', () => {
    expect(migration).toContain('CUSTOM_DOUBLE_SIDED_MANUAL');
    expect(migration).toContain('COLOR_BACK_SIDE_FOIL_MANUAL');
    expect(migration).toContain('"isDoubleSided":true');
    expect(migration).not.toMatch(
      /COLOR_BACK_SIDE_FOIL_MANUAL[\s\S]{0,300}"foilPassCount"/u,
    );
  });

  it('fails closed if any cloned color base lacks a lamination condition', () => {
    expect(migration).toContain(
      'Color-print v3 base rules are missing lamination facts',
    );
    expect(migration).toContain(
      'External processing v3 blocker rules are incomplete',
    );
  });
});
