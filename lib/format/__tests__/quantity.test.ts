import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { formatDecimalQuantity } from '../quantity';

describe('formatDecimalQuantity', () => {
  it('drops the storage scale and groups thousands', () => {
    expect(formatDecimalQuantity('1000.0000')).toBe('1,000');
    expect(formatDecimalQuantity('1234567.0000')).toBe('1,234,567');
  });

  it('keeps meaningful decimals without trailing zeros', () => {
    expect(formatDecimalQuantity('12.5000')).toBe('12.5');
    expect(formatDecimalQuantity('0.0070')).toBe('0.007');
    expect(formatDecimalQuantity('2500.1250')).toBe('2,500.125');
  });

  it('handles zero, negatives and Decimal inputs exactly', () => {
    expect(formatDecimalQuantity('0.0000')).toBe('0');
    expect(formatDecimalQuantity('-1500.5')).toBe('-1,500.5');
    expect(formatDecimalQuantity(new Decimal('0.1').plus('0.2'))).toBe('0.3');
  });
});
