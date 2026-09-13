import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { catalogPaperPricingFacts } from '../../../lib/order/create-order-quote-facts-adapter';
import { obsoletePaperImports, retireUnusedPaperImports } from '../retire-unused-paper-imports';

function fixture() {
  const rows = [
    ...obsoletePaperImports.map(([id, code, name]) => ({ id, code, name })),
    ...[
      ['PAPER-ICE-WHITE-160', '160g冰白纸'], ['PAPER-RED-CARD-160', '160g红卡'],
      ['PAPER-PEARL-FLASH-160', '160g珠光艳闪'], ['PAPER-PEARL-RED-160', '160g珠光闪红'],
    ].map(([code, name]) => ({ id: code, code, name })),
  ].map((row) => ({ ...row, category: 'PAPER', specification: null, unit: '张', currentStock: '0.00', averageCost: null, safetyStock: null, isActive: true, outOfStock: false }));
  const state = { reference: false, snapshot: false, audited: false, failDelete: false };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('current_database()')) return { rows: [{ name: 'repair_test' }] };
    if (sql.includes('SELECT * FROM "Material"')) return { rows };
    if (sql.includes('FROM pg_constraint')) return { rows: [{ schema: 'public', table: 'Product', column: 'paperMaterialId' }] };
    if (sql.includes('FROM information_schema')) return { rows: [{ table: 'Order', column: 'snapshot' }] };
    if (sql.startsWith('SELECT 1 FROM "public"')) return { rows: [], rowCount: state.reference ? 1 : 0 };
    if (sql.startsWith('SELECT 1 FROM "Order"')) return { rows: [], rowCount: state.snapshot ? 1 : 0 };
    if (sql.startsWith('SELECT 1 FROM "BusinessAuditLog"')) return { rows: [], rowCount: state.audited ? 1 : 0 };
    if (sql.startsWith('DELETE') && state.failDelete) throw new Error('delete failed');
    return { rows: [], rowCount: 1 };
  });
  return { rows, state, query, client: { query } as unknown as Pick<Client, 'query'> };
}

describe('unused paper import retirement', () => {
  it('demonstrates the duplicate identity and preserves unique canonical facts after retirement', () => {
    const { rows } = fixture();
    const count = (papers: typeof rows, name: string) => papers.flatMap(catalogPaperPricingFacts).filter((fact) => fact.paperType === name && fact.paperWeightGsm === 160).length;
    expect(count(rows, '红卡')).toBe(3);
    expect(count(rows, '冰白纸')).toBe(2);
    const retained = rows.slice(3);
    for (const name of ['红卡', '冰白纸', '珠光艳闪', '珠光闪红']) expect(count(retained, name)).toBe(1);
  });
  it('defaults to rollback after exercising all three deletes and audit inserts', async () => {
    const f = fixture();
    const result = await retireUnusedPaperImports(f.client);
    expect(result.removed).toHaveLength(3);
    expect(result.applied).toBe(false);
    expect(f.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(3);
    expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  });
  it('requires the connected database name before any write', async () => {
    const f = fixture();
    await expect(retireUnusedPaperImports(f.client, { apply: true, confirmDatabase: 'wrong' })).rejects.toThrow('数据库确认');
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
  it.each(['reference', 'snapshot', 'failDelete'] as const)('rolls back on %s', async (key) => {
    const f = fixture(); f.state[key] = true;
    await expect(retireUnusedPaperImports(f.client, { apply: true, confirmDatabase: 'repair_test' })).rejects.toThrow();
    expect(f.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  });
  it.each(['name', 'currentStock', 'averageCost', 'specification'] as const)('refuses changed %s', async (key) => {
    const f = fixture(); Object.assign(f.rows[0]!, { [key]: key === 'currentStock' ? '0.01' : 'changed' });
    await expect(retireUnusedPaperImports(f.client)).rejects.toThrow('导入记录已改变');
  });
  it('refuses unavailable canonical papers', async () => {
    const f = fixture(); f.rows[3]!.isActive = false;
    await expect(retireUnusedPaperImports(f.client)).rejects.toThrow('标准纸张');
  });
  it('refuses an additional unknown duplicate rather than guessing which record to retain', async () => {
    const f = fixture(); f.rows.push({ ...f.rows[3]!, id: 'unknown', code: 'unknown' });
    await expect(retireUnusedPaperImports(f.client)).rejects.toThrow('仍不能唯一匹配');
  });
  it('commits only with matching database confirmation', async () => {
    const f = fixture();
    await retireUnusedPaperImports(f.client, { apply: true, confirmDatabase: 'repair_test' });
    expect(f.query.mock.calls.at(-1)).toEqual(['COMMIT']);
  });
  it('requires repair evidence for an absent import, and is idempotent with it', async () => {
    const f = fixture(); f.rows.splice(0, 3);
    await expect(retireUnusedPaperImports(f.client)).rejects.toThrow('缺少原记录及修复审计');
    f.state.audited = true;
    expect((await retireUnusedPaperImports(f.client)).removed).toEqual([]);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
});
