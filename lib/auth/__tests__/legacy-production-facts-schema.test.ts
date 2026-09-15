import { describe, expect, it } from 'vitest';
import { repairLegacyProductionFactsSchema } from '../schemas';
const valid = { orderId: 'order-1', expectedOrderRevision: '2', items: [{ itemId: 'item-1', craft: 'PARTIAL', unitsPerBag: '10' }], packagingMode: 'SINGLE_STYLE' };
describe('repairLegacyProductionFactsSchema', () => {
  it('解析版本与每包数量，并接受三种工艺', () => {
    for (const craft of ['PARTIAL', 'FULL', 'PRINT']) expect(repairLegacyProductionFactsSchema.parse({ ...valid, items: [{ ...valid.items[0], craft }] })).toMatchObject({ expectedOrderRevision: 2, items: [{ craft, unitsPerBag: 10 }] });
  });
  it.each(['0', '-1', '1.5', '10000000', 'NaN'])('拒绝每包数量 %s', (unitsPerBag) => {
    expect(repairLegacyProductionFactsSchema.safeParse({ ...valid, items: [{ ...valid.items[0], unitsPerBag }] }).success).toBe(false);
  });
  it('缺省可选字段，拒绝非法工艺、包装、版本和重复款式', () => {
    expect(repairLegacyProductionFactsSchema.safeParse({ ...valid, items: [{ itemId: 'item-1' }] }).success).toBe(true);
    for (const patch of [{ items: [{ itemId: 'item-1', craft: 'UNKNOWN' }] }, { packagingMode: 'UNKNOWN' }, { expectedOrderRevision: '-1' }, { items: [valid.items[0], valid.items[0]] }]) expect(repairLegacyProductionFactsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
