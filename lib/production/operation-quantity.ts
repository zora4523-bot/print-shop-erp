import { PieceworkOperationType } from '../../generated/prisma/enums';

/** Display-only conversion from planned priced passes to completed pieces. */
export function productionOperationPassCount(
  operationType: PieceworkOperationType,
  sources: Array<{
    orderItem: null | {
      frontFoilColors: string[];
      backFoilColors: string[];
    };
  }>,
): number {
  if (operationType !== PieceworkOperationType.PARTIAL) return 1;
  const passCounts = new Set(
    sources
      .map((source) =>
        source.orderItem
          ? source.orderItem.frontFoilColors.length +
            source.orderItem.backFoilColors.length
          : 0,
      )
      .filter((count) => count > 0),
  );
  return passCounts.size === 1 ? [...passCounts][0]! : 1;
}
