import { describe, expect, it } from 'vitest';
import { selectOrderCustomerFee } from '../customer-fee';

describe('selectOrderCustomerFee', () => {
  it.each([
    ['settled fee', { settledFee: '90', confirmedFee: '80', quotedFee: '70', totalAmount: '60' }, '90.00', 'SETTLED', false],
    ['confirmed fee', { settledFee: null, confirmedFee: '80', quotedFee: '70', totalAmount: '60' }, '80.00', 'CONFIRMED', false],
    ['quoted fee', { settledFee: null, confirmedFee: null, quotedFee: '70', totalAmount: '60' }, '70.00', 'QUOTED', true],
    ['legacy aggregate', { settledFee: null, confirmedFee: null, quotedFee: null, totalAmount: '60' }, '60.00', 'LEGACY', false],
  ] as const)('prefers %s without recalculation', (_label, input, amount, source, estimated) => {
    expect(selectOrderCustomerFee(input)).toEqual({ amount, source, estimated });
  });

  it('keeps an explicit zero instead of falling through', () => {
    expect(
      selectOrderCustomerFee({
        settledFee: null,
        confirmedFee: '0',
        quotedFee: '12.00',
        totalAmount: '12.00',
      }),
    ).toEqual({ amount: '0.00', source: 'CONFIRMED', estimated: false });
  });
});
