import Decimal from 'decimal.js';
import type { ProductionOperationSpec } from './operation-materializer';

type Quantity = { toString(): string } | string;
export type PreviousOperation = {
  id: string;
  operationType: string;
  unit: string;
  carriedCompletedQty?: Quantity;
  carriedWorkOrderProgressQty?: Quantity;
  sources: Array<{
    orderItemId: string | null;
    packagingGroupId: string | null;
    sourceQty?: Quantity;
  }>;
  reports?: Array<{ reportedCompletedQty: Quantity }>;
  workOrderProgress?: Array<{ workOrderProgressQuantity: Quantity }>;
};

export function operationCarryoverKey(
  operation: Pick<PreviousOperation, 'operationType' | 'unit' | 'sources'>,
): string {
  return JSON.stringify([
    operation.operationType,
    operation.unit,
    operation.sources.map((source) => [source.orderItemId, source.packagingGroupId]).sort(),
  ]);
}

export function sumCarriedQuantity(
  baseline: Quantity | undefined,
  values: readonly Quantity[],
): Decimal {
  return values.reduce<Decimal>(
    (sum, value) => sum.plus(value.toString()),
    new Decimal(baseline?.toString() ?? 0),
  );
}

/** Reuse physical output only within the same production lane and source set.
 * The approval guard separately rejects changed product/foil identities.
 * Carryover never creates a ProductionReport or changes an earned wage.
 */
export function planOperationCarryovers(
  previous: readonly PreviousOperation[],
  next: readonly ProductionOperationSpec[],
) {
  const nextByKey = new Map(next.map((spec) => [operationCarryoverKey(spec), spec]));
  const result = new Map<string, { fromOperationId: string; completed: Decimal; progress: Decimal }>();
  for (const operation of previous) {
    const completed = sumCarriedQuantity(
      operation.carriedCompletedQty,
      (operation.reports ?? []).map((report) => report.reportedCompletedQty),
    );
    const progress = sumCarriedQuantity(
      operation.carriedWorkOrderProgressQty,
      (operation.workOrderProgress ?? []).map((report) => report.workOrderProgressQuantity),
    );
    if (completed.isNegative() || progress.isNegative()) {
      throw new Error('历史生产进度异常，请先核对报工');
    }
    if (completed.isZero() && progress.isZero()) continue;
    const key = operationCarryoverKey(operation);
    const spec = nextByKey.get(key);
    if (!spec || result.has(key)) {
      throw new Error('已产数量无法唯一对应修改后的款式或包装组，请先核对生产事实');
    }
    const sourceReduced = operation.sources.some((source) => {
      const nextSource = spec.sources.find((next) =>
        next.orderItemId === source.orderItemId &&
        next.packagingGroupId === source.packagingGroupId);
      return source.sourceQty !== undefined && nextSource &&
        new Decimal(nextSource.sourceQty).lt(source.sourceQty.toString());
    });
    if (operation.sources.length > 1 && completed.isPositive() && sourceReduced) {
      throw new Error('多款汇总报工不能确定各款已产数量，不能直接减少其中一款数量');
    }
    const plannedPieces = spec.sources.reduce(
      (sum, source) => sum.plus(source.completedPieceQty), new Decimal(0),
    );
    if (completed.gt(plannedPieces)) {
      throw new Error('修改后的数量不能少于该工序已完成数量');
    }
    result.set(key, { fromOperationId: operation.id, completed, progress });
  }
  return result;
}
