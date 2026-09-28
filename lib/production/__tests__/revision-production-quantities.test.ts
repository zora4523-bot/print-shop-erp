import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { revisionProductionQuantities } from '../revision-jobs';
const target = (a: number, b?: number) => ({ fingerprint: 'same-physical-designs', snapshot: { items: [{ id: 'a', quantity: a }, ...(b === undefined ? [] : [{ id: 'b', quantity: b }])] } });
const finished = (qty: number, a: number, b?: number, productionQuantities?: Record<string, string>) => ({ status: 'COMPLETED', completedQty: new Decimal(qty), snapshot: { ...target(a, b).snapshot, fingerprint: 'same-physical-designs', ...(productionQuantities ? { productionQuantities } : {}) } });
describe('revision physical quantity carryover', () => {
  it('does not use surplus from one style to cover another style with the same aggregate order quantity', () => {
    const result = revisionProductionQuantities(target(50, 150), [finished(200, 100, 100)]);
    expect(result.quantities).toEqual({ a: '0', b: '50' }); expect(result.remaining.toString()).toBe('50');
  });
  it('counts only the additional production of each revision', () => {
    expect(revisionProductionQuantities(target(1500), [finished(1000, 1000), finished(300, 1300, undefined, { a: '300' })]).remaining.toString()).toBe('200');
  });
  it('uses approved actual quantity for a single identifiable style', () => {
    expect(revisionProductionQuantities(target(1100), [finished(990, 1000)]).remaining.toString()).toBe('110');
  });
  it('preserves an approved completion through metadata-only revisions without inventing the missing ten pieces', () => {
    const result = revisionProductionQuantities(target(1000), [finished(990, 1000)]);
    expect(result.remaining.toString()).toBe('0');
    expect(result.actualQuantities).toEqual({ a: '990' });
    expect(revisionProductionQuantities(target(995), [finished(990, 1000)]).remaining.toString()).toBe('0');
  });
  it('uses actual production for a later increase, including a one-piece demand increase', () => {
    const history = [finished(990, 1000)];
    expect(revisionProductionQuantities(target(1300), history).remaining.toString()).toBe('310');
    expect(revisionProductionQuantities(target(1001), history).remaining.toString()).toBe('11');
  });
  it('does not count a carried completion as another physical production batch', () => {
    const original = finished(990, 1000);
    const carried = { status: 'CARRIED', completedQty: null, snapshot: { ...original.snapshot, fulfilledQuantities: { a: '1000' }, carriedQty: '990', productionQuantities: { a: '0' } } };
    expect(revisionProductionQuantities(target(1000), [carried, original]).remaining.toString()).toBe('0');
    expect(revisionProductionQuantities(target(1300), [carried, original]).remaining.toString()).toBe('310');
  });
  it('does not silently mark ambiguous multi-style actual production as complete', () => {
    expect(revisionProductionQuantities(target(100, 100), [finished(195, 100, 100)]).remaining.toString()).toBe('200');
  });
  it.each([
    { name: '增加款式', items: [{ id: 'a', quantity: 100 }, { id: 'b', quantity: 100 }, { id: 'c', quantity: 50 }], fingerprints: { a: 'a1', b: 'b1', c: 'c1' }, remaining: '50' },
    { name: '移除款式', items: [{ id: 'a', quantity: 100 }], fingerprints: { a: 'a1' }, remaining: '0' },
    { name: '仅一款改版', items: [{ id: 'a', quantity: 100 }, { id: 'b', quantity: 100 }], fingerprints: { a: 'a1', b: 'b2' }, remaining: '100' },
  ])('$name 保留同工种未变款式的真实产出', ({ items, fingerprints, remaining }) => {
    const history = finished(200, 100, 100);
    const previous = { ...history, snapshot: { ...history.snapshot, lane: 'PARTIAL', itemFingerprints: { a: 'a1', b: 'b1' } } };
    const next = { fingerprint: 'changed-group', snapshot: { items, lane: 'PARTIAL', itemFingerprints: fingerprints } };
    expect(revisionProductionQuantities(next, [previous]).remaining.toString()).toBe(remaining);
    expect(revisionProductionQuantities({ ...next, snapshot: { ...next.snapshot, lane: 'FULL' } }, [previous]).remaining.toString()).toBe(String(items.reduce((sum, item) => sum + item.quantity, 0)));
  });
});
