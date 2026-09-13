import { OrderPackagingMode } from '@/generated/prisma/enums';
import {
  isMixedPackaging,
  packagingUnit,
  packagingCapacity,
  packagingCapacityError,
} from './packaging-mode';

export type PackagingBagCountInput = {
  mode: OrderPackagingMode;
  itemQuantities: readonly number[];
  itemUnitsPerBag: readonly number[];
  /** Box counts are rounded separately per delivery address. */
  shipmentQuantities?: readonly (readonly number[])[];
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
export function calculatePackagingBagCount(input: PackagingBagCountInput): PackagingBagCountResult {
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

  // Composition is retained as membership when unpacked; it is never billed.
  if (input.mode === OrderPackagingMode.UNPACKED) {
    return { complete: true, bagCount: 0, errors: [] };
  }
  if (
    packagingUnit(input.mode) === '盒' &&
    input.itemUnitsPerBag.reduce((sum, units) => sum + units, 0) > packagingCapacity(input.mode)!
  ) {
    return { complete: false, bagCount: null, errors: [packagingCapacityError(input.mode)] };
  }

  if (!isMixedPackaging(input.mode) && selected.length !== 1) {
    return {
      complete: false,
      bagCount: null,
      errors: ['单款装只能包含一个款式'],
    };
  }

  if (isMixedPackaging(input.mode) && selected.length < 2) {
    return {
      complete: false,
      bagCount: null,
      errors: ['混装至少需要两个款式'],
    };
  }

  if (packagingUnit(input.mode) === '盒' && input.shipmentQuantities) {
    const shipments = input.shipmentQuantities;
    if (
      shipments.some(
        (quantities) =>
          quantities.length !== input.itemQuantities.length ||
          quantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0),
      ) ||
      input.itemQuantities.some(
        (quantity, index) =>
          shipments.reduce((sum, quantities) => sum + quantities[index], 0) !== quantity,
      )
    ) {
      return { complete: false, bagCount: null, errors: ['各地址分配数量必须与工单数量一致'] };
    }
    let boxCount = 0;
    for (const quantities of shipments) {
      const counts = selected.map(({ itemIndex }) =>
        Math.ceil(quantities[itemIndex] / input.itemUnitsPerBag[itemIndex]),
      );
      if (new Set(counts).size > 1) {
        return {
          complete: false,
          bagCount: null,
          errors: ['各地址的混装组成必须能得到相同盒数，请调整款式分配'],
        };
      }
      boxCount += counts[0] ?? 0;
    }
    return { complete: true, bagCount: boxCount, errors: [] };
  }

  const bagCounts = [...new Set(selected.map((item) => item.bagCount))];
  if (bagCounts.length !== 1) {
    return {
      complete: false,
      bagCount: null,
      errors: ['各款数量与每袋组成无法得到同一袋数，请调整每袋数量'],
    };
  }

  return {
    complete: true,
    bagCount: bagCounts[0] as number,
    errors: [],
  };
}
