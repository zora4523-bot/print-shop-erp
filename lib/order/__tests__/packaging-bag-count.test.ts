import { describe, expect, it } from 'vitest';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import { calculatePackagingBagCount } from '../packaging-bag-count';

describe('calculatePackagingBagCount', () => {
  it('uses ceil(quantity / unitsPerBag) for a single style', () => {
    expect(
      calculatePackagingBagCount({
        mode: OrderPackagingMode.SINGLE_STYLE,
        itemQuantities: [999],
        itemUnitsPerBag: [10],
      }),
    ).toEqual({ complete: true, bagCount: 100, errors: [] });
  });

  it('does not turn a missing per-bag quantity into zero bags', () => {
    expect(
      calculatePackagingBagCount({
        mode: OrderPackagingMode.SINGLE_STYLE,
        itemQuantities: [1_000],
        itemUnitsPerBag: [0],
      }),
    ).toEqual({
      complete: false,
      bagCount: null,
      errors: ['请填写至少一款的每袋数量'],
    });
  });

  it('derives one shared bag count for a mixed group', () => {
    expect(
      calculatePackagingBagCount({
        mode: OrderPackagingMode.MIXED_STYLE,
        itemQuantities: [1_000, 2_000],
        itemUnitsPerBag: [10, 20],
      }),
    ).toEqual({ complete: true, bagCount: 100, errors: [] });
  });

  it('rejects a mixed composition that implies different bag counts', () => {
    const result = calculatePackagingBagCount({
      mode: OrderPackagingMode.MIXED_STYLE,
      itemQuantities: [1_000, 2_000],
      itemUnitsPerBag: [10, 10],
    });

    expect(result.complete).toBe(false);
    expect(result.bagCount).toBeNull();
    expect(result.errors[0]).toContain('无法得到同一袋数');
  });
});
