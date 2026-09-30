import { expect, it } from 'vitest';
import { billListReturnHref, billScopedHref, creditAllocationSummary, remainingCreditAmount } from '../presentation';

it('subtracts all recorded credits, including credit not yet allocated, without floating point loss', () => {
  expect(remainingCreditAmount('100.10', [{ requestedAmount: '-30.03' }, { requestedAmount: '-0.07' }])).toBe('70.00');
  expect(remainingCreditAmount('100.10', [{ requestedAmount: '-100.10' }])).toBe('0.00');
});
it('only returns to the authorized list and known applied filters', () => {
  expect(billListReturnHref('https://example.com')).toBe('/owner/agent-bills');
  expect(billListReturnHref('//example.com')).toBe('/owner/agent-bills');
  expect(billListReturnHref('/owner/agent-bills?period=2026-08&status=CONFIRMED&page=2&unknown=secret')).toBe('/owner/agent-bills?period=2026-08&status=CONFIRMED&page=2');
  expect(billListReturnHref('/sales/bills?period=2026-08&agentUserId=other&page=3', true)).toBe('/sales/bills?period=2026-08&page=3');
});

it('splits allocations on frozen bills from provisional DRAFT allocations without changing the remaining math', () => {
  expect(creditAllocationSummary({ requestedAmount: '-100.10', allocations: [
    { amount: '-30.03', bill: { status: 'CONFIRMED' } },
    { amount: '-0.07', bill: { status: 'PAID' } },
    { amount: '-50.00', bill: { status: 'DRAFT' } },
  ] })).toEqual({ requested: '100.10', confirmed: '30.10', pending: '50.00', remaining: '20.00' });
  expect(creditAllocationSummary({ requestedAmount: '-10.00', allocations: [] })).toEqual({ requested: '10.00', confirmed: '0.00', pending: '0.00', remaining: '10.00' });
});
it('carries only a sanitized list scope onto bill links', () => {
  expect(billScopedHref('/owner/agent-bills/b1', '/owner/agent-bills?period=2026-08&page=2&x=1')).toBe(`/owner/agent-bills/b1?returnTo=${encodeURIComponent('/owner/agent-bills?period=2026-08&page=2')}`);
  expect(billScopedHref('/owner/agent-bills/b1', 'https://evil.example/owner/agent-bills?period=2026-08')).toBe('/owner/agent-bills/b1');
  expect(billScopedHref('/owner/agent-bills/b1', ['/owner/agent-bills?period=2026-08'])).toBe('/owner/agent-bills/b1');
  expect(billScopedHref('/owner/agent-bills/b1', '/owner/agent-bills')).toBe('/owner/agent-bills/b1');
  expect(billScopedHref('/sales/bills/b1', '/owner/agent-bills?period=2026-08', true)).toBe('/sales/bills/b1');
  expect(billScopedHref('/sales/bills/b1', '/sales/bills?period=2026-08&agentUserId=x', true)).toBe(`/sales/bills/b1?returnTo=${encodeURIComponent('/sales/bills?period=2026-08')}`);
});
