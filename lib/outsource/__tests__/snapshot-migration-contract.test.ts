import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PREPARE = resolve(
  'prisma/migrations/20260822109000_prepare_outsource_snapshot_reconciliation/migration.sql',
);
const ENFORCE = resolve(
  'prisma/migrations/20260822110000_write_path_integrity/migration.sql',
);

describe('historical outsource snapshot migration contract', () => {
  it('only auto-verifies the unambiguous single-item recorded-total shape', async () => {
    const sql = await readFile(PREPARE, 'utf8');

    expect(sql).toContain('cardinality(outsource."orderItemIds") = 1');
    expect(sql).toContain('outsource."totalQty" > 0');
    expect(sql).toContain("'migration:single-item-totalQty'");
    expect(sql).toContain(
      'app_ops.outsource_snapshot_reconciliation_worklist',
    );

    const automaticInsert = sql.slice(
      sql.indexOf('INSERT INTO app_ops.outsource_snapshot_reconciliation'),
      sql.indexOf('-- Read-only worklist'),
    );
    expect(automaticInsert).toContain('outsource."totalQty"');
    expect(automaticInsert).not.toContain('item."quantity"');
  });

  it('fails before DDL when verified per-item evidence is incomplete', async () => {
    const sql = await readFile(ENFORCE, 'utf8');
    const preflight = sql.indexOf('Cannot backfill outsource snapshots');
    const firstDdl = Math.min(
      sql.indexOf('ALTER TABLE "ProductionTask"'),
      sql.indexOf('CREATE TABLE "OutsourceOrderItemSnapshot"'),
    );

    const transaction = sql.indexOf('\nBEGIN;', preflight);
    expect(sql.trimStart().startsWith('BEGIN;')).toBe(false);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(firstDdl);
    expect(transaction).toBeGreaterThan(preflight);
    expect(transaction).toBeLessThan(firstDdl);
    expect(sql).toContain(
      'These two expected preflight failures intentionally run before BEGIN',
    );
    expect(sql).toContain(
      'JOIN app_ops.outsource_snapshot_reconciliation AS reconciliation',
    );
    expect(sql).toContain('SUM(reconciliation.quantity)');
  });

  it('builds immutable snapshots from verified evidence, never current quantities', async () => {
    const sql = await readFile(ENFORCE, 'utf8');
    const snapshotInsert = sql.slice(
      sql.indexOf('INSERT INTO "OutsourceOrderItemSnapshot"'),
      sql.indexOf('UPDATE "OutsourceOrder"'),
    );

    expect(snapshotInsert).toContain('reconciliation.quantity');
    expect(snapshotInsert).not.toContain('item."quantity"');
    expect(snapshotInsert).not.toContain('"OrderItem" AS item');
  });
});
