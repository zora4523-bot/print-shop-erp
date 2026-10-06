import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { readProductionRouting } from '../routing';

function order(craft: string = 'PARTIAL', purpose = 'STANDARD') {
  return { id: 'order-1', purpose,
    items: [{ id: 'item-1', sequence: 1, quantity: 100, craft, crafts: [] as string[],
      frontFoilColors: craft === 'PARTIAL' ? ['金'] : [], backFoilColors: [], hasLocalFoil: craft === 'PARTIAL' }],
    packagingGroups: [{ id: 'pack-1', sequence: 1, mode: 'SINGLE_STYLE', actualBagCount: 10, lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }] }], shipments: [] };
}
async function route(row: ReturnType<typeof order>, crafts: unknown[] = []) {
  const client = { order: { findMany: vi.fn().mockResolvedValue([row]) }, craft: { findMany: vi.fn().mockResolvedValue(crafts) } };
  const result = (await readProductionRouting(client as unknown as Prisma.TransactionClient, [row.id])).get(row.id)!;
  return { result, client };
}
describe('production routing uses canonical facts without writes', () => {
  it('assigns factory foil work and leaves packing-only work in its existing workflow', async () => {
    expect((await route(order())).result).toEqual({ kind: 'ASSIGN', issues: [] });
    expect((await route(order('PRINT'))).result).toEqual({ kind: 'PACKING', issues: [] });
  });
  it('routes samples directly even without factory craft or packaging facts', async () => {
    const row = order('PRINT', 'SAMPLE_SHIPMENT'); row.packagingGroups = [];
    const { result, client } = await route(row);
    expect(result).toEqual({ kind: 'SAMPLE', issues: [] });
    expect(client.craft.findMany).not.toHaveBeenCalled();
  });
  it('never treats invalid facts as zero production', async () => {
    const row = order(); row.packagingGroups = [];
    const { result } = await route(row);
    expect(result.kind).toBe('BLOCKED'); expect(result.issues.join('；')).toContain('包装组');
  });
  it('keeps external work separate and assigns mixed internal/external work', async () => {
    const row = order('PRINT'); row.items[0].crafts = ['external'];
    const crafts = [{ id: 'external', code: 'EXT', name: '外协', isActive: true, isOutsource: true }];
    expect((await route(row, crafts)).result.kind).toBe('OUTSOURCE');
    row.items[0].crafts.push('internal');
    expect((await route(row, [...crafts, { id: 'internal', code: 'DIE_CUT', name: '模切', isActive: true, isOutsource: false }])).result.kind).toBe('ASSIGN');
  });
  it('rejects missing and inactive craft definitions', async () => {
    const row = order('PRINT'); row.items[0].crafts = ['missing'];
    expect((await route(row)).result.kind).toBe('BLOCKED');
    expect((await route(row, [{ id: 'missing', code: 'OLD', name: '旧工艺', isActive: false, isOutsource: true }])).result.kind).toBe('BLOCKED');
  });
  it('recognizes unpacked orders with no factory work as ready for the completion gate', async () => {
    const row = order('PRINT'); row.packagingGroups[0].mode = 'UNPACKED'; row.packagingGroups[0].actualBagCount = 0;
    expect((await route(row)).result).toEqual({ kind: 'READY', issues: [] });
  });
});
