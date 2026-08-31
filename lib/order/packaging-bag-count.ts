import { OrderPackagingMode } from '@/generated/prisma/enums';

export type PackagingBagCountInput = {
  mode: OrderPackagingMode;
  itemQuantities: readonly number[];
  itemUnitsPerBag: readonly number[];
};

export type PackagingBagCountResult =
  | { complete: true; bagCount: number; errors: [] }
  | { complete: false; bagCount: null; errors: string[] };

/**
 * Derive the number of bags from production quantities and the composition of
 * one bag. The caller never supplies a trusted bag count.
 *
 * A mixed group must produce the same bag count for every included style. The
 * final bag may be partially filled, therefore each style uses ceil(quantity /
 * unitsPerBag). Styles not included in this group use zero units per bag.
 */
export function calculatePackagingBagCount(
  input: PackagingBagCountInput,
): PackagingBagCountResult {
  const errors: string[] = [];

  if (input.itemQuantities.length !== input.itemUnitsPerBag.length) {
    return {
      complete: false,
      bagCount: null,
      errors: ['每袋组成必须与工单款式一一对应'],
    };
  }

  const selected: Array<{ itemIndex: number; bagCount: number }> = [];
  input.itemUnitsPerBag.forEach((unitsPerBag, itemIndex) => {
    const quantity = input.itemQuantities[itemIndex] ?? 0;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      errors.push(`款式 #${itemIndex + 1} 数量必须是正整数`);
      return;
    }
    if (!Number.isSafeInteger(unitsPerBag) || unitsPerBag < 0) {
      errors.push(`款式 #${itemIndex + 1} 每袋数量必须是非负整数`);
      return;
    }
    if (unitsPerBag === 0) return;
    selected.push({
      itemIndex,
      bagCount: Math.ceil(quantity / unitsPerBag),
    });
  });

  if (errors.length > 0) {
    return { complete: false, bagCount: null, errors };
  }

  if (selected.length === 0) {
    return {
      complete: false,
      bagCount: null,
      errors: ['请填写至少一款的每袋数量'],
    };
  }

  if (
    input.mode === OrderPackagingMode.SINGLE_STYLE &&
    selected.length !== 1
  ) {
    return {
      complete: false,
      bagCount: null,
      errors: ['单款装只能包含一个款式'],
    };
  }

  if (
    input.mode === OrderPackagingMode.MIXED_STYLE &&
    selected.length < 2
  ) {
    return {
      complete: false,
      bagCount: null,
      errors: ['混装至少需要两个款式'],
    };
  }

  const bagCounts = [...new Set(selected.map((item) => item.bagCount))];
  if (bagCounts.length !== 1) {
    return {
      complete: false,
      bagCount: null,
      errors: [
        '各款数量与每袋组成无法得到同一袋数，请调整每袋数量',
      ],
    };
  }

  return {
    complete: true,
    bagCount: bagCounts[0] as number,
    errors: [],
  };
}
