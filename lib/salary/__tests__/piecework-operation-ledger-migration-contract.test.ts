import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = process.cwd();
const migration = readFileSync(
  join(
    workspace,
    'prisma/migrations/20260828110000_piecework_operation_ledger/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(join(workspace, 'prisma/schema.prisma'), 'utf8');
const seed = readFileSync(join(workspace, 'prisma/seed.ts'), 'utf8');

describe('piecework operation-ledger migration contract', () => {
  it('is one additive transaction and never mutates protected customer price tables', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toMatch(
      /(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+"CustomerPrice(?:Book|Rule)"/i,
    );
    expect(migration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"CustomerPrice(?:Book|Rule)"/i,
    );
    expect(migration).not.toContain('CREATE EXTENSION');
  });

  it('declares only the three operation keyed rates and keeps null distinct from zero', () => {
    expect(migration).toContain(
      `CREATE TYPE "PieceworkOperationType" AS ENUM ('PARTIAL', 'FULL', 'PACKING')`,
    );
    expect(migration).toContain(
      `CREATE TYPE "PieceworkRateUnit" AS ENUM ('PER_PASS', 'PER_PIECE', 'PER_BAG')`,
    );
    expect(schema).toContain('amount        Decimal?');
    expect(migration).toContain(
      'A published piecework price book cannot contain null rates',
    );
    expect(seed).toContain('seedPieceworkPriceBookV1Placeholder(db)');
  });

  it('keeps operations independent of workers and machines', () => {
    const operation = schema.match(
      /model ProductionOperation \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(operation).toBeDefined();
    expect(operation).not.toMatch(/workerId|machineType/);
    expect(operation).toContain('operationType PieceworkOperationType');
    expect(schema).toContain('model ProductionOperationSource {');
    expect(migration).toContain('"ProductionOperationSource_shape_check"');
  });

  it('makes reports append-only and corrections exact reversal rows', () => {
    expect(schema).toContain('model ProductionReport {');
    expect(migration).toContain('"ProductionReport_idempotencyKey_key"');
    expect(migration).toContain('"ProductionReport_immutable"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "ProductionReport"');
    expect(migration).toContain('validate_production_report_reversal');
    expect(migration).toContain('validate_production_report_price_snapshot');
    expect(migration).toContain(
      `IF NEW."entryType" = 'REVERSAL' THEN\n    RETURN NEW;`,
    );
    expect(migration).toContain(
      'Only completed quantity is chargeable for this operation',
    );
    expect(migration).toContain(
      'Production report does not match an effective published rate',
    );
    expect(migration).toContain(
      'A reversal must be the exact negation of its original report',
    );
  });

  it('protects published books/rules and enforces non-overlapping half-open windows', () => {
    expect(migration).toContain(
      '"PieceworkPriceBook_published_window_no_overlap"',
    );
    expect(migration).toContain("'[)'");
    expect(migration).toContain('"PieceworkPriceBook_protect_history"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "PieceworkPriceRule"');
    expect(migration).toContain('Published PieceworkPriceRule rows are immutable');
  });

  it('creates a settlement boundary that cannot share legacy task keys', () => {
    const item = schema.match(
      /model PieceworkSettlementItem \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(item).toBeDefined();
    expect(item).toContain('reportId');
    expect(item).not.toContain('productionTaskId');
    expect(item).not.toContain('dailySalaryId');
    expect(migration).toContain('"PieceworkSettlementItem_immutable"');
  });
});
