import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260902120600_production_work_order_version_isolation/migration.sql',
  'utf8',
);

describe('production work-order generation migration contract', () => {
  it('versions every mutable production aggregate and keeps progress-step identity per generation', () => {
    expect(schema).toMatch(
      /model ProductionOperation[\s\S]*?workOrderVersion Int\s+@default\(1\)/,
    );
    expect(schema).toMatch(
      /model ProductionProgressStep[\s\S]*?workOrderVersion Int\s+@default\(1\)[\s\S]*?@@unique\(\[orderItemId, craftId, workOrderVersion\]\)/,
    );
    expect(schema).toMatch(
      /model ProductionWorkOrderProgress[\s\S]*?workOrderVersion\s+Int\s+@default\(1\)/,
    );
  });

  it('backfills before NOT NULL and validates new operations, steps, progress and scan claims against the current version', () => {
    expect(migration).toMatch(
      /UPDATE "ProductionOperation"[\s\S]*?SET "workOrderVersion" = orders\."workOrderVersion"/,
    );
    expect(migration.indexOf('UPDATE "ProductionOperation"')).toBeLessThan(
      migration.indexOf('ALTER COLUMN "workOrderVersion" SET NOT NULL'),
    );
    expect(migration).toContain('ProductionOperation_validate_generation');
    expect(migration).toContain('ProductionProgressStep_validate_generation');
    expect(migration).toContain(
      'operation_record."workOrderVersion" <> NEW."workOrderVersion"',
    );
    expect(migration).toContain(
      'order_record."workOrderVersion" <> NEW."workOrderVersion"',
    );
    expect(migration).toContain(
      'progress."workOrderVersion" = NEW."workOrderVersion"',
    );
    expect(migration).toContain(
      'target_record."workOrderVersion" <> NEW."workOrderVersion"',
    );
  });

  it('restores append-only protection after the one-time progress backfill', () => {
    expect(migration).toContain(
      'DROP TRIGGER "ProductionWorkOrderProgress_immutable"',
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "ProductionWorkOrderProgress_immutable"[\s\S]*?BEFORE UPDATE OR DELETE/,
    );
  });
});
