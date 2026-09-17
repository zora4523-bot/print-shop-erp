import { describe, expect, it } from 'vitest';
import { formatFoilColors, foilColorLabel, foilColorSearchValues, foilColorInputLabel, restoreFoilColorInput } from '../foil-colors';

describe('formatFoilColors', () => {
  it('joins multiple colors with a CJK list separator', () => {
    expect(formatFoilColors(['哑金', '红金', '古铜金'])).toBe(
      '哑金、红金、古铜金',
    );
  });

  it('uses the requested empty fallback', () => {
    expect(formatFoilColors([], '-')).toBe('-');
    expect(formatFoilColors(undefined)).toBe('—');
  });
});


it('uses foil labels while preserving saved identifiers, custom colors and order', () => {
  const saved = ['浅色', '红色', '黑色', '银色', '蓝色', '透明色', '绿色', '哑金', '亚金', '品牌色'];
  expect(formatFoilColors(saved)).toBe('浅金、红金、黑金、银金、蓝金、透明金、绿金、哑金、亚金、品牌色');
  expect(saved[1]).toBe('红色');
  expect(foilColorLabel('红金')).toBe('红金');
  expect(foilColorSearchValues(['红金'])).toEqual(['红金', '红色']);
  expect(foilColorSearchValues(['品牌色'])).toEqual(['品牌色']);
  expect(foilColorInputLabel('红色、蓝色')).toBe('红金、蓝金');
  expect(restoreFoilColorInput('红金、品牌金', ['红色'])).toBe('红色、品牌金');
});
