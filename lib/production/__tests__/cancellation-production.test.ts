import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { productionMinimumByItem } from '../cancellation-production';
const job = (lane: string, qty: number) => ({ status: 'COMPLETED', completedQty: new Decimal(qty), sourceKey: `${lane}:a`, snapshot: { items: [{ id: 'a', quantity: 1000 }], lane } });
describe('cancellation physical production floor', () => {
  it('adds real batches while counting different crafts on the same piece only once', () => {
    const facts = [job('PARTIAL', 990), job('PARTIAL', 310), job('FULL', 1000), { ...job('PARTIAL', 1000), status: 'CARRIED' }];
    expect(productionMinimumByItem(facts).get('a')?.toString()).toBe('1300');
  });
  it('requires explicit per-style actual quantities when an aggregate is ambiguous', () => {
    const fact = { ...job('PARTIAL', 1990), snapshot: { items: [{ id: 'a', quantity: 1000 }, { id: 'b', quantity: 1000 }], lane: 'PARTIAL' } };
    expect(() => productionMinimumByItem([fact])).toThrow('逐款');
    const result = productionMinimumByItem([{ ...fact, snapshot: { ...fact.snapshot, actualItemQuantities: { a: '1000', b: '990' } } }]);
    expect(result.get('a')?.toString()).toBe('1000'); expect(result.get('b')?.toString()).toBe('990');
  });
});
