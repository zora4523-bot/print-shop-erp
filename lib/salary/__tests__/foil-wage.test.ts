import { describe, expect, it } from 'vitest';
import { calculateFoilJobWage, DEFAULT_FOIL_WAGES, fullFoilColorCount } from '../foil-wage';

describe('已确认的烫金师傅整单工资', () => {
  it.each([
    ['PARTIAL', 800, 1, '12.00'], ['PARTIAL', 1000, 2, '24.00'],
    ['PARTIAL', 1001, 2, '24.01'], ['PARTIAL', 2000, 2, '38.00'],
    ['FULL', 800, 2, '40.00'], ['FULL', 800, 3, '60.00'],
    ['FULL', 1000, 3, '60.00'], ['FULL', 1001, 2, '40.02'],
    ['FULL', 2000, 2, '60.00'], ['FULL', 2000, 3, '90.00'],
  ] as const)('%s %i 个、%i 次/色 = %s', (lane, quantity, count, total) => {
    expect(calculateFoilJobWage(quantity, count, DEFAULT_FOIL_WAGES[lane]).totalAmount).toBe(total);
  });
  it('小单已含装版，不重复叠加装版费', () => {
    expect(calculateFoilJobWage(800, 2, DEFAULT_FOIL_WAGES.FULL)).toMatchObject({ pieceAmount: '0.00', fixedAmount: '40.00' });
  });
  it('大单分别保留计件和装版金额', () => {
    expect(calculateFoilJobWage(2000, 2, DEFAULT_FOIL_WAGES.FULL)).toMatchObject({ pieceAmount: '40.00', fixedAmount: '20.00' });
  });
  it('个人工价可分别调整三项，明确零价仍为零', () => {
    expect(calculateFoilJobWage(2000, 2, { pieceRate: '0', smallOrderAmount: '0', setupAmount: '0' }).totalAmount).toBe('0.00');
    expect(calculateFoilJobWage(2000, 2, { pieceRate: '0.0125', smallOrderAmount: '30', setupAmount: '15' }).totalAmount).toBe('80.00');
  });
  it.each([-1, 0, 1.5, NaN, Infinity])('非法数量 %s 拒绝计算', (quantity) => {
    expect(() => calculateFoilJobWage(quantity, 1, DEFAULT_FOIL_WAGES.FULL)).toThrow();
  });
  it.each(['-1', '0.00001', '1e3', 'NaN'])('非法工价 %s 拒绝计算', (pieceRate) => {
    expect(() => calculateFoilJobWage(2000, 1, { ...DEFAULT_FOIL_WAGES.FULL, pieceRate })).toThrow();
  });
  it('专版按不同颜色计数，相同颜色出现在两面不翻倍', () => {
    expect(fullFoilColorCount(['亚金', '红色'], ['亚金'])).toBe(2);
    expect(fullFoilColorCount(['亚金', '红色', '蓝色'], [])).toBe(3);
  });
  it('缺颜色或超过三个颜色不能默认为单色', () => {
    expect(() => fullFoilColorCount([], [])).toThrow();
    expect(() => fullFoilColorCount(['1', '2', '3', '4'], [])).toThrow();
  });
});
