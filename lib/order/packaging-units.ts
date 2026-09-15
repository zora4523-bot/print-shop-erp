export const MAX_PACKAGING_UNITS_PER_BAG = 9_999_999;

export function isValidPackagingUnitsPerBag(
  value: number | null | undefined,
): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_PACKAGING_UNITS_PER_BAG
  );
}

