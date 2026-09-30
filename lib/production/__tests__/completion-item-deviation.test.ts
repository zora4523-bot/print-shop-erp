import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/production-completion', () => ({ dispatchProductionCompletionNotification: vi.fn() }));

const { itemQuantitiesDeviateFromPlan } = await import('../completion-registration');

describe('itemQuantitiesDeviateFromPlan', () => {
  const planned = { a: '1000', b: '1000' };
  it('treats an absent per-item split as the dispatched plan', () => {
    expect(itemQuantitiesDeviateFromPlan(undefined, planned)).toBe(false);
  });
  it('accepts a split identical to the plan', () => {
    expect(itemQuantitiesDeviateFromPlan({ a: '1000', b: '1000' }, planned)).toBe(false);
  });
  it('flags a redistribution whose total still matches the plan (A 0 / B 2000)', () => {
    expect(itemQuantitiesDeviateFromPlan({ a: '0', b: '2000' }, planned)).toBe(true);
  });
  it('flags missing or unknown styles', () => {
    expect(itemQuantitiesDeviateFromPlan({ a: '2000' }, planned)).toBe(true);
    expect(itemQuantitiesDeviateFromPlan({ a: '1000', b: '1000', c: '0' }, planned)).toBe(true);
  });
  it('compares against the remaining production quantities of a revision job', () => {
    expect(itemQuantitiesDeviateFromPlan({ a: '0', b: '310' }, { a: '0', b: '310' })).toBe(false);
    expect(itemQuantitiesDeviateFromPlan({ a: '310', b: '0' }, { a: '0', b: '310' })).toBe(true);
  });
});
