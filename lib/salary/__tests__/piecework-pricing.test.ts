import { describe, expect, it } from 'vitest';
import {
  calculatePieceworkAmount,
  PieceworkPricingError,
} from '../piecework-pricing';

describe('calculatePieceworkAmount', () => {
  it('prices PARTIAL by completed pieces multiplied by pass count', () => {
    expect(
      calculatePieceworkAmount(
        {
          operationType: 'PARTIAL',
          completedQty: 1_000,
          defectQty: 50,
          reworkQty: 25,
          passCount: 3,
        },
        { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.0075' },
      ),
    ).toEqual({
      operationType: 'PARTIAL',
      unit: 'PER_PASS',
      completedQty: '1000',
      excludedDefectQty: '50',
      excludedReworkQty: '25',
      passCount: '3',
      chargeableQty: '3000',
      rate: '0.0075',
      amount: '22.50',
    });
  });

  it.each([
    ['FULL', 'PER_PIECE', 2_000, '0.0125', '25.00'],
    ['PACKING', 'PER_BAG', 16, '0.3000', '4.80'],
  ] as const)('prices %s from completed quantity only', (
    operationType,
    unit,
    completedQty,
    amount,
    expected,
  ) => {
    const result = calculatePieceworkAmount(
      {
        operationType,
        completedQty,
        defectQty: 999,
        reworkQty: 888,
      },
      { operationType, unit, amount },
    );
    expect(result.chargeableQty).toBe(String(completedQty));
    expect(result.amount).toBe(expected);
  });

  it('distinguishes a published zero rate from an unavailable null rate', () => {
    expect(
      calculatePieceworkAmount(
        { operationType: 'FULL', completedQty: 10 },
        { operationType: 'FULL', unit: 'PER_PIECE', amount: 0 },
      ).amount,
    ).toBe('0.00');
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'FULL', completedQty: 10 },
        { operationType: 'FULL', unit: 'PER_PIECE', amount: null },
      ),
    ).toThrowError(new PieceworkPricingError(
      'PIECEWORK_RATE_UNAVAILABLE',
      '工价尚未发布，禁止按 0 元结算',
    ));
  });

  it('rounds the final payroll amount half-up to cents', () => {
    expect(
      calculatePieceworkAmount(
        { operationType: 'PACKING', completedQty: 1 },
        { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.1250' },
      ).amount,
    ).toBe('0.13');
  });

  it.each([
    [
      { operationType: 'PARTIAL', completedQty: 1 } as const,
      { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.1' } as const,
    ],
    [
      { operationType: 'FULL', completedQty: 1, passCount: 2 } as const,
      { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.1' } as const,
    ],
    [
      { operationType: 'PACKING', completedQty: -1 } as const,
      { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.1' } as const,
    ],
    [
      { operationType: 'FULL', completedQty: 1 } as const,
      { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.1' } as const,
    ],
  ])('rejects invalid operation facts or mismatched rules', (input, rate) => {
    expect(() => calculatePieceworkAmount(input, rate)).toThrow(
      PieceworkPricingError,
    );
  });

  it.each(['not-a-number', 'Infinity', '-1', '1.5', '100000000000'])(
    'rejects an invalid completed quantity %s',
    (completedQty) => {
      expect(() =>
        calculatePieceworkAmount(
          { operationType: 'FULL', completedQty },
          { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.1' },
        ),
      ).toThrow(PieceworkPricingError);
    },
  );

  it.each(['not-a-number', 'Infinity', '-1', '0.00001', '10000000000'])(
    'rejects an invalid rate %s',
    (amount) => {
      expect(() =>
        calculatePieceworkAmount(
          { operationType: 'FULL', completedQty: 1 },
          { operationType: 'FULL', unit: 'PER_PIECE', amount },
        ),
      ).toThrow(PieceworkPricingError);
    },
  );

  it('rejects a canonical operation paired with the wrong unit', () => {
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'FULL', completedQty: 1 },
        { operationType: 'FULL', unit: 'PER_BAG', amount: '0.1' },
      ),
    ).toThrow('工序与工价单位不一致');
  });

  it('requires a positive PARTIAL pass count but accepts an explicit one elsewhere', () => {
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'PARTIAL', completedQty: 1, passCount: 0 },
        { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.1' },
      ),
    ).toThrow('过版次数必须大于 0');
    expect(
      calculatePieceworkAmount(
        { operationType: 'FULL', completedQty: 1, passCount: 1 },
        { operationType: 'FULL', unit: 'PER_PIECE', amount: '0.1' },
      ).passCount,
    ).toBe('1');
  });

  it('rejects quantity and payroll amount storage overflow independently', () => {
    expect(() =>
      calculatePieceworkAmount(
        {
          operationType: 'PARTIAL',
          completedQty: '99999999999',
          passCount: 2,
        },
        { operationType: 'PARTIAL', unit: 'PER_PASS', amount: '0.0001' },
      ),
    ).toThrow('计薪数量超出可存储范围');
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'FULL', completedQty: '99999999999' },
        {
          operationType: 'FULL',
          unit: 'PER_PIECE',
          amount: '9999999999.9999',
        },
      ),
    ).toThrow('计件金额超出可存储范围');
  });
});
