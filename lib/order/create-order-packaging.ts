import {
  calculatePackagingBagCount,
  type PackagingBagCountInput,
  type PackagingBagCountResult,
} from "./packaging-bag-count";
import { packagingCapacity, packagingCapacityError } from './packaging-mode';

export const MAX_CREATE_ORDER_UNITS_PER_BAG = 12;
export const CREATE_ORDER_PACKAGING_LIMIT_MESSAGE =
  "每包数量不能超过 12 个，请调整包装数量";

/** Applies to new orders; historical packaging and its price snapshots stay intact. */
export function calculateCreateOrderBagCount(
  input: PackagingBagCountInput,
): PackagingBagCountResult {
  const count = calculatePackagingBagCount(input);
  if (!count.complete) return count;
  if (
    input.itemUnitsPerBag.reduce((total, units) => total + units, 0) >
    (packagingCapacity(input.mode) ?? Number.POSITIVE_INFINITY)
  ) {
    return {
      complete: false,
      bagCount: null,
      errors: [packagingCapacityError(input.mode)],
    };
  }
  return count;
}
