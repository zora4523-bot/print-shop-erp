import { describe, expect, it } from 'vitest';
import { foilColorIdentity, hasDuplicateFoilColors, orderFoilColorOptions, uniqueFoilColors } from '../foil-color-identity';
import { orderItemFoilSideColorsField } from '@/lib/auth/schemas/shared';

describe('order color identity independent of inventory SKUs', () => {
  it.each([['哑金', '亚金'], [' 浅金 ', '浅色'], ['红金', '红色'], ['透明金', '透明色']])(
    'recognizes %s as %s', (name, identity) => expect(foilColorIdentity(name)).toBe(identity),
  );

  it('keeps custom colors distinct and does not rewrite saved spellings', () => {
    const saved = Object.freeze(['哑金', '亚金', '品牌金', '浅金', '浅色']);
    expect(uniqueFoilColors(saved)).toEqual(['哑金', '品牌金', '浅金']);
    expect(saved).toEqual(['哑金', '亚金', '品牌金', '浅金', '浅色']);
    expect(hasDuplicateFoilColors(['品牌金', '品牌银'])).toBe(false);
    expect(foilColorIdentity('__proto__')).toBe('__proto__');
  });

  it('keeps stocked material facts while selecting the configured canonical swatch', () => {
    const legacy = Object.freeze({ id: 'stocked', name: '哑金', displayImage: null, displayColor: null, currentStock: '400.00' });
    const standard = Object.freeze({ id: 'swatch', name: '亚金', displayImage: '/images/order/foil/matte-gold.png', displayColor: 'gold', currentStock: '0.00' });
    const custom = Object.freeze({ id: 'custom', name: '品牌色', displayImage: null, displayColor: null, currentStock: '5.00' });
    expect(orderFoilColorOptions(Object.freeze([legacy, custom, standard]))).toEqual([custom, standard]);
    expect(legacy.currentStock).toBe('400.00');
    expect(orderFoilColorOptions([legacy])).toEqual([legacy]);
    expect(orderFoilColorOptions([{ ...standard, displayImage: null }, standard])).toEqual([standard]);
  });

  it('rejects aliases within a side while permitting the same color on two different sides', () => {
    expect(orderItemFoilSideColorsField.safeParse(['哑金', '亚金']).success).toBe(false);
    expect(orderItemFoilSideColorsField.safeParse(['红色', '红金']).success).toBe(false);
    expect(orderItemFoilSideColorsField.parse(['哑金'])).toEqual(['哑金']);
    expect(orderItemFoilSideColorsField.parse(['亚金'])).toEqual(['亚金']);
  });
});
