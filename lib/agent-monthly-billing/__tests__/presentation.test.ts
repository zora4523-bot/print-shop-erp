import { expect, it } from 'vitest';
import { billListReturnHref, remainingCreditAmount } from '../presentation';

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
