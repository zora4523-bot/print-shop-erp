import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { formatRate, formatUnitPrice } from '../unit-price';

describe('formatUnitPrice', () => {
  it('keeps the four-decimal unit-price scale for zero and short decimals', () => {
    expect(formatUnitPrice('0')).toBe('¥ 0.0000');
    expect(formatUnitPrice('12.5')).toBe('¥ 12.5000');
  });

  it('preserves a four-decimal price exactly', () => {
    expect(formatUnitPrice('0.1234')).toBe('¥ 0.1234');
  });

  it('adds thousands separators without losing decimal precision', () => {
    expect(formatUnitPrice('999999.9999')).toBe('¥ 999,999.9999');
  });
});

describe('formatRate', () => {
  it('keeps at least two and at most four decimals, trimming trailing zeros', () => {
    expect(formatRate('295')).toBe('¥ 295.00');
    expect(formatRate('295.0000')).toBe('¥ 295.00');
    expect(formatRate('0.295')).toBe('¥ 0.295');
    expect(formatRate('0.0070')).toBe('¥ 0.007');
    expect(formatRate('0.1767')).toBe('¥ 0.1767');
    expect(formatRate('2300')).toBe('¥ 2,300.00');
    expect(formatRate(new Decimal('-1.5'))).toBe('-¥ 1.50');
  });
});
