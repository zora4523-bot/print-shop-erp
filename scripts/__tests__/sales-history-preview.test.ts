import { expect, it } from 'vitest';
import { parseSalesHistoryPreview } from '../lib/sales-history-preview';

const row = { id: 'B001-S01-R1', channel: '大表哥', name: '测试订单', date: '2025-01-01', file: 'source.xlsx', sheet: 'Sheet1', row: 1,
  amount: '18.10', components: ['10', '5', '1', '1', '1.10', null], quantity: '各100', g: 300, h: 300, styles: 3,
  process: '局部烫金', paper: '珠光纸', size: '大', pack: '10个装' };

it('preserves dates, exact money and explicit totals without evaluating quantity text', () => {
  expect(parseSalesHistoryPreview([row])[0]).toMatchObject({ date: '2025-01-01', amount: '18.10', balanced: true, quantity: 300, quantityRaw: '各100', processing: '16.00' });
});
it('keeps missing totals unknown and reports component differences', () => {
  expect(parseSalesHistoryPreview([{ ...row, amount: null }])[0]).toMatchObject({ amount: null, balanced: false, difference: null });
  expect(parseSalesHistoryPreview([{ ...row, amount: '18.00' }])[0]).toMatchObject({ amount: '18.00', balanced: false, difference: '0.10' });
});
it('rejects duplicate identity, invalid dates, amounts and quantities', () => {
  expect(() => parseSalesHistoryPreview([row, row])).toThrow('Duplicate');
  for (const extra of [{ amount: '18.001' }, { amount: '10000000000' }, { components: ['1.001', null, null, null, null, null] }, { amount: 'NaN' }, { amount: '-1' }, { amount: -1 }, { date: '2025-02-30' }, { h: '1.5', g: '1.5' }, { h: 3_000_000_000, g: 3_000_000_000 }]) {
    expect(() => parseSalesHistoryPreview([{ ...row, ...extra }])).toThrow();
  }
});

it('does not guess a total when the two original totals disagree', () => {
  expect(parseSalesHistoryPreview([{ ...row, g: 200, h: 300 }])[0]).toMatchObject({ conflictingTotals: true, quantity: null });
});

it('compares every explicit total, including quantity when h is absent', () => {
  expect(parseSalesHistoryPreview([{ ...row, h: null, g: 300, quantity: '200' }])[0]).toMatchObject({ conflictingTotals: true, quantity: null });
  expect(parseSalesHistoryPreview([{ ...row, h: 300, g: 300, quantity: '200' }])[0]).toMatchObject({ conflictingTotals: true, quantity: null });
});
it.each([-5, '-5', '1.2', 'Infinity', 'NaN', '3e9'])('rejects invalid explicit quantity %s instead of falling back', (h) => {
  expect(() => parseSalesHistoryPreview([{ ...row, h, g: 300 }])).toThrow('Invalid source quantity');
});

it.each([' 300 ', '300\t', '　300　'])('normalizes padded quantity %s without losing original evidence', quantity => {
  expect(parseSalesHistoryPreview([{ ...row, quantity }])[0]).toMatchObject({ quantity: 300, quantityRaw: quantity, conflictingTotals: false });
  expect(parseSalesHistoryPreview([{ ...row, h: quantity, g: 200 }])[0]).toMatchObject({ quantity: null, conflictingTotals: true });
});
it.each([' -5 ', ' 1.2 ', ' Infinity ', ' 3e9 ', ' 3000000000 '])('still rejects padded invalid quantity %s', h => {
  expect(() => parseSalesHistoryPreview([{ ...row, h }])).toThrow('Invalid source quantity');
});
