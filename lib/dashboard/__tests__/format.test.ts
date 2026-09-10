import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { formatMoney, formatMoneyDelta, formatMoneyPlain } from '../format';

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
  // 这条是这个 formatter 存在的核心理由，之前没被钉住：
  // String(Decimal) 不保留尾随零，5000.00 会渲染成 "5000"、5000.50 成
  // "5000.5"，而金额列多是 text-right + tabular-nums——小数位数不一致
  // 时小数点排不齐，老板扫账容易看错数量级。
  it('保留尾随零，让同列小数点能对齐', () => {
    expect(formatMoney(new Decimal('5000.00'))).toBe('¥ 5,000.00');
    expect(formatMoney(new Decimal('5000.50'))).toBe('¥ 5,000.50');
    expect(formatMoney(new Decimal('4999.99'))).toBe('¥ 4,999.99');
    const rendered = [
      formatMoney('5000'),
      formatMoney('5000.5'),
      formatMoney('4999.99'),
    ];
    // 三个值的小数部分长度必须一致，否则右对齐时对不齐
    const fractionLengths = new Set(
      rendered.map((v) => v.split('.')[1]?.length),
    );
    expect(fractionLengths.size).toBe(1);
  });

  it('不经过 IEEE-754 丢精度', () => {
    expect(formatMoney(new Decimal('0.1').plus('0.2'))).toBe('¥ 0.30');
  });
});

describe('formatMoneyPlain', () => {
  it('同口径但不带币符号', () => {
    expect(formatMoneyPlain('1234.5')).toBe('1,234.50');
    expect(formatMoneyPlain(new Decimal('-3'))).toBe('-3.00');
  });
});

describe('formatMoneyDelta', () => {
  it('正负零三态，符号在币符号前', () => {
    expect(formatMoneyDelta('12')).toBe('+¥ 12.00');
    expect(formatMoneyDelta('-1234.5')).toBe('-¥ 1,234.50');
    expect(formatMoneyDelta(0)).toBe('¥ 0.00');
    expect(formatMoneyDelta(new Decimal('0.00'))).toBe('¥ 0.00');
  });
});
