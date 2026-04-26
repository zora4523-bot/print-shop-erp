import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { formatMoney } from '../format';

describe('formatMoney', () => {
  it('零值', () => {
    expect(formatMoney(0)).toBe('¥ 0.00');
    expect(formatMoney('0')).toBe('¥ 0.00');
    expect(formatMoney(new Decimal(0))).toBe('¥ 0.00');
  });

  it('小额（千分位以内）', () => {
    expect(formatMoney('123.4')).toBe('¥ 123.40');
    expect(formatMoney(999.99)).toBe('¥ 999.99');
  });

  it('千分位（4 位起）', () => {
    expect(formatMoney('1234.56')).toBe('¥ 1,234.56');
    expect(formatMoney('12345.67')).toBe('¥ 12,345.67');
  });

  it('百万级', () => {
    expect(formatMoney('1234567.89')).toBe('¥ 1,234,567.89');
  });

  it('两位小数四舍五入（half-away-from-zero）', () => {
    // 0.005 → 0.01 是 half-up；JS Number(0.005).toFixed(2) 受浮点影响
    // 走 Decimal 应该稳定为 "0.01"。
    expect(formatMoney('12.345')).toBe('¥ 12.35');
    expect(formatMoney('12.344')).toBe('¥ 12.34');
  });

  it('Prisma Decimal-style 字符串（高精度小数）', () => {
    expect(formatMoney('99.999')).toBe('¥ 100.00');
  });

  it('负数（账单退款 / 调整场景）', () => {
    expect(formatMoney('-100')).toBe('¥ -100.00');
    expect(formatMoney('-1234.5')).toBe('¥ -1,234.50');
  });

  it('Decimal.js 实例直接传入', () => {
    expect(formatMoney(new Decimal('5000.5'))).toBe('¥ 5,000.50');
  });
});
