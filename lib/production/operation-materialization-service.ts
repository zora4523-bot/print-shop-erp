import type { Prisma } from '../../generated/prisma/client';
import {
  OrderKind,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  ProductionOperationStatus,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { orderCascadeLockKey } from '../order/locks';
import { transitionOrder } from '../order/status-machine';
import {
  deriveProductionOperationPlan,
  type ProductionOperationSpec,
} from './operation-materializer';
import {
  deriveProductionProgressPlan,
  type ProductionProgressStepSpec,
} from './progress-materializer';

export class ProductionOperationMaterializationError extends Error {
  constructor(
    public readonly code:
      | 'ORDER_NOT_FOUND'
      | 'ORDER_NOT_CHARGEABLE'
      | 'PRICING_NOT_CONFIRMED'
      | 'ORDER_STATUS_NOT_ACTIVATABLE'
      | 'CANONICAL_FACTS_INCOMPLETE'
      | 'CRAFT_FACTS_INCOMPLETE'
      | 'EXISTING_OPERATION_MISMATCH',
    message: string,
    public readonly detail: unknown = null,
  ) {
    super(message);
    this.name = 'ProductionOperationMaterializationError';
  }
}

const ORDER_FACTS_SELECT = {
  id: true,
  orderNo: true,
  kind: true,
  status: true,
  settlementType: true,
  pricingStatus: true,
  scheduledAt: true,
  requiresOutsource: true,
  items: {
    select: {
      id: true,
      sequence: true,
      craft: true,
      quantity: true,
      frontFoilColors: true,
      backFoilColors: true,
      hasLocalFoil: true,
      crafts: true,
    },
    orderBy: { sequence: 'asc' as const },
  },
  packagingGroups: {
    select: {
      id: true,
      sequence: true,
      actualBagCount: true,
      lines: {
        select: { orderItemId: true, unitsPerBag: true },
        orderBy: { orderItemId: 'asc' as const },
      },
    },
    orderBy: { sequence: 'asc' as const },
  },
  productionOperations: {
    select: {
      id: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      sources: {
        select: {
          sourceType: true,
          orderItemId: true,
          packagingGroupId: true,
          sourceQty: true,
        },
      },
    },
  },
  productionProgressSteps: {
    select: {
      id: true,
      orderItemId: true,
      craftId: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
    },
  },
} satisfies Prisma.OrderSelect;

type MaterializationOrder = Prisma.OrderGetPayload<{
  select: typeof ORDER_FACTS_SELECT;
}>;

function sourceSignature(source: {
  sourceType: string;
  orderItemId: string | null;
  packagingGroupId: string | null;
  sourceQty: { toString(): string } | string;
}): string {
  return [
    source.sourceType,
    source.orderItemId ?? '',
    source.packagingGroupId ?? '',
    source.sourceQty.toString(),
  ].join(':');
}

function specSignature(spec: ProductionOperationSpec): string {
  return [
    spec.operationType,
    spec.unit,
    spec.plannedQty,
    ...spec.sources.map(sourceSignature).sort(),
  ].join('|');
}

function storedOperationSignature(
  operation: MaterializationOrder['productionOperations'][number],
): string {
  return [
    operation.operationType,
    operation.unit,
    operation.plannedQty.toString(),
    ...operation.sources.map(sourceSignature).sort(),
  ].join('|');
}

function progressSpecSignature(spec: ProductionProgressStepSpec): string {
  return [
    spec.orderItemId,
    spec.craftId,
    spec.craftCode,
    spec.craftName,
    spec.plannedQty,
  ].join('|');
}

function storedProgressSignature(
  step: MaterializationOrder['productionProgressSteps'][number],
): string {
  return [
    step.orderItemId,
    step.craftId,
    step.craftCode,
    step.craftName,
    step.plannedQty.toString(),
  ].join('|');
}

function assertExistingOperationsMatch(
  expected: readonly ProductionOperationSpec[],
  actual: MaterializationOrder['productionOperations'],
): void {
  const expectedSignatures = expected.map(specSignature).sort();
  const actualSignatures = actual.map(storedOperationSignature).sort();
  if (
    expectedSignatures.length !== actualSignatures.length ||
    expectedSignatures.some(
      (signature, index) => signature !== actualSignatures[index],
    )
  ) {
    throw new ProductionOperationMaterializationError(
      'EXISTING_OPERATION_MISMATCH',
      '已有工序与当前 canonical 工单事实不一致，拒绝补写或覆盖',
      { expectedSignatures, actualSignatures },
    );
  }
}

function assertExistingProgressMatches(
  expected: readonly ProductionProgressStepSpec[],
  actual: MaterializationOrder['productionProgressSteps'],
): void {
  const expectedSignatures = expected.map(progressSpecSignature).sort();
  const actualSignatures = actual.map(storedProgressSignature).sort();
  if (
    expectedSignatures.length !== actualSignatures.length ||
    expectedSignatures.some(
      (signature, index) => signature !== actualSignatures[index],
    )
  ) {
    throw new ProductionOperationMaterializationError(
      'EXISTING_OPERATION_MISMATCH',
      '已有无计件进度步骤与当前 canonical 工单事实不一致，拒绝补写或覆盖',
      { expectedSignatures, actualSignatures },
    );
  }
}

function isConfirmedPricing(status: OrderPricingStatus): boolean {
  // LEGACY_CONFIRMED orders belong to the explicit legacy preflight path. This
  // activation API is deliberately incapable of silently converting them.
  return (
    status === OrderPricingStatus.AUTO_CONFIRMED ||
    status === OrderPricingStatus.ADMIN_CONFIRMED
  );
}

export type ActivateProductionOperationsResult = {
  orderId: string;
  orderStatus: OrderStatus;
  operationIds: string[];
  operationsCreated: number;
  progressStepIds: string[];
  progressStepsCreated: number;
  idempotentReplay: boolean;
};

/**
 * Transactional cutover entry for newly submitted chargeable orders and
 * explicitly free rework orders. Customer pricing remains orthogonal to the
 * production/piecework ledger: a free rework still consumes real operations.
 * The per-order advisory lock makes the absence check and inserts atomic;
 * exact replays are no-ops and partial/mismatched ledgers fail closed.
 */
export async function activateProductionOperationsInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: { id: string },
  at?: Date,
): Promise<ActivateProductionOperationsResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    orderId,
  )}))`;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: ORDER_FACTS_SELECT,
  });
  if (!order) {
    throw new ProductionOperationMaterializationError(
      'ORDER_NOT_FOUND',
      '工单不存在',
    );
  }
  if (
    order.settlementType === OrderSettlementType.NO_CHARGE &&
    order.kind !== OrderKind.REWORK
  ) {
    throw new ProductionOperationMaterializationError(
      'ORDER_NOT_CHARGEABLE',
      '本入口只物化已确认价格的收费工单或免费重做单',
    );
  }
  if (!isConfirmedPricing(order.pricingStatus)) {
    throw new ProductionOperationMaterializationError(
      'PRICING_NOT_CONFIRMED',
      '工单价格尚未确认，不能投产',
    );
  }

  const plan = deriveProductionOperationPlan({
    orderId: order.id,
    items: order.items,
    packagingGroups: order.packagingGroups,
  });
  if (!plan.ok) {
    throw new ProductionOperationMaterializationError(
      'CANONICAL_FACTS_INCOMPLETE',
      '工单生产事实不完整，不能自动生成工序',
      plan.issues,
    );
  }

  const craftIds = [...new Set(order.items.flatMap((item) => item.crafts))];
  const craftFacts =
    craftIds.length === 0
      ? []
      : await tx.craft.findMany({
          where: { id: { in: craftIds } },
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            isOutsource: true,
          },
        });
  const progressPlan = deriveProductionProgressPlan({
    items: order.items,
    crafts: craftFacts,
  });
  if (!progressPlan.ok) {
    throw new ProductionOperationMaterializationError(
      'CRAFT_FACTS_INCOMPLETE',
      '工单工艺字典事实不完整，不能自动生成生产进度',
      progressPlan.issues,
    );
  }
  const requiresOutsource = craftFacts.some((craft) => craft.isOutsource);

  if (
    order.productionOperations.length > 0 ||
    order.productionProgressSteps.length > 0
  ) {
    assertExistingOperationsMatch(plan.specs, order.productionOperations);
    assertExistingProgressMatches(
      progressPlan.specs,
      order.productionProgressSteps,
    );
    return {
      orderId,
      orderStatus: order.status,
      operationIds: order.productionOperations.map((operation) => operation.id),
      operationsCreated: 0,
      progressStepIds: order.productionProgressSteps.map((step) => step.id),
      progressStepsCreated: 0,
      idempotentReplay: true,
    };
  }

  if (
    order.status !== OrderStatus.PENDING_FACTORY &&
    order.status !== OrderStatus.SUBMITTED
  ) {
    throw new ProductionOperationMaterializationError(
      'ORDER_STATUS_NOT_ACTIVATABLE',
      `工单状态 ${order.status} 不允许首次物化工序`,
    );
  }
  transitionOrder(order.status, OrderStatus.SCHEDULING);

  const operationIds: string[] = [];
  for (const spec of plan.specs) {
    const created = await tx.productionOperation.create({
      data: {
        orderId,
        operationType: spec.operationType,
        unit: spec.unit,
        status: ProductionOperationStatus.PENDING,
        plannedQty: spec.plannedQty,
        sources: {
          create: spec.sources.map((source) => ({
            sourceType: source.sourceType,
            orderItemId: source.orderItemId,
            packagingGroupId: source.packagingGroupId,
            sourceQty: source.sourceQty,
          })),
        },
      },
      select: { id: true },
    });
    operationIds.push(created.id);
  }

  const progressStepIds: string[] = [];
  for (const spec of progressPlan.specs) {
    const created = await tx.productionProgressStep.create({
      data: {
        orderId,
        orderItemId: spec.orderItemId,
        craftId: spec.craftId,
        craftCode: spec.craftCode,
        craftName: spec.craftName,
        status: ProductionOperationStatus.PENDING,
        plannedQty: spec.plannedQty,
      },
      select: { id: true },
    });
    progressStepIds.push(created.id);
  }

  const activatedAt = at ?? (await databaseNow(tx));
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.SCHEDULING,
      scheduledAt: order.scheduledAt ?? activatedAt,
      requiresOutsource,
    },
  });
  await tx.orderLog.create({
    data: {
      orderId,
      operatorId: actor.id,
      action: 'OPERATIONS_MATERIALIZED',
      changedFields: {
        status: { before: order.status, after: OrderStatus.SCHEDULING },
        requiresOutsource: {
          before: order.requiresOutsource,
          after: requiresOutsource,
        },
        productionOperations: {
          before: 0,
          after: plan.specs.map((spec) => ({
            operationType: spec.operationType,
            unit: spec.unit,
            plannedQty: spec.plannedQty,
            sourceCount: spec.sources.length,
          })),
        },
        productionProgressSteps: {
          before: 0,
          after: progressPlan.specs.map((spec) => ({
            orderItemId: spec.orderItemId,
            craftId: spec.craftId,
            craftCode: spec.craftCode,
            plannedQty: spec.plannedQty,
          })),
        },
      },
      remark:
        '价格确认后自动物化计件工序与无计件进度步骤，未进行人员或机器匹配',
    },
  });

  return {
    orderId,
    orderStatus: OrderStatus.SCHEDULING,
    operationIds,
    operationsCreated: operationIds.length,
    progressStepIds,
    progressStepsCreated: progressStepIds.length,
    idempotentReplay: false,
  };
}
