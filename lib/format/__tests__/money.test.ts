import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { formatMoney, formatMoneyAmount } from '../money';

describe('formatMoney', () => {
  it('保留尾随零，让同列小数点能对齐', () => {
    // 这正是这个 helper 存在的理由：String(Decimal) 会把这三个渲染成
    // "5000" / "5000.5" / "4999.99"，右对齐时小数点参差不齐。
    expect(formatMoney(new Decimal('5000.00'))).toBe('¥5,000.00');
    expect(formatMoney(new Decimal('5000.50'))).toBe('¥5,000.50');
    expect(formatMoney(new Decimal('4999.99'))).toBe('¥4,999.99');
  });

  it('千分位分组', () => {
    expect(formatMoney('1234567.8')).toBe('¥1,234,567.80');
    expect(formatMoney('999.9')).toBe('¥999.90');
    expect(formatMoney('1000')).toBe('¥1,000.00');
  });

  it('负数：符号在货币符号之后、分组之前', () => {
    expect(formatMoney('-1234.5')).toBe('¥-1,234.50');
    expect(formatMoney('-0.01')).toBe('¥-0.01');
  });

  it('零与极小值', () => {
    expect(formatMoney(0)).toBe('¥0.00');
    expect(formatMoney('0.004')).toBe('¥0.00');
    expect(formatMoney('0.005')).toBe('¥0.01');
  });

  it('空值走 placeholder，不渲染 NaN', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('not-a-number')).toBe('—');
    expect(formatMoney(null, { placeholder: '未设置' })).toBe('未设置');
  });

  it('不经过 IEEE-754：0.1 + 0.2 类精度问题不出现', () => {
    expect(formatMoney(new Decimal('0.1').plus('0.2'))).toBe('¥0.30');
    // 超出 double 安全整数范围仍精确
    expect(formatMoney('9007199254740993.55')).toBe('¥9,007,199,254,740,993.55');
  });

  it('货币符号紧贴数字，不加空格', () => {
    expect(formatMoney('12')).toBe('¥12.00');
    expect(formatMoney('12')).not.toContain('¥ ');
  });

  it('formatMoneyAmount 去掉符号但保留其余口径', () => {
    expect(formatMoneyAmount(new Decimal('5000.00'))).toBe('5,000.00');
    expect(formatMoneyAmount(null)).toBe('—');
  });
});
