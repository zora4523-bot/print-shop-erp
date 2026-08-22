import { describe, expect, it } from 'vitest';
import { formatUnitPrice } from '../unit-price';

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
