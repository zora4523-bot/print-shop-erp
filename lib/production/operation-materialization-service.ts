import type { Prisma } from '../../generated/prisma/client';
import {
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  ProductionOperationStatus,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { db } from '../db';
import { orderCascadeLockKey } from '../order/locks';
import { transitionOrder } from '../order/status-machine';
import {
  deriveProductionOperationPlan,
  type ProductionOperationSpec,
} from './operation-materializer';

export class ProductionOperationMaterializationError extends Error {
  constructor(
    public readonly code:
      | 'ORDER_NOT_FOUND'
      | 'ORDER_NOT_CHARGEABLE'
      | 'PRICING_NOT_CONFIRMED'
      | 'ORDER_STATUS_NOT_ACTIVATABLE'
      | 'CANONICAL_FACTS_INCOMPLETE'
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
  status: true,
  settlementType: true,
  pricingStatus: true,
  scheduledAt: true,
  items: {
    select: {
      id: true,
      sequence: true,
      craft: true,
      quantity: true,
      frontFoilColors: true,
      backFoilColors: true,
      hasLocalFoil: true,
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
  idempotentReplay: boolean;
};

/**
 * Transactional cutover entry for newly submitted, chargeable orders.
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
  if (order.settlementType === OrderSettlementType.NO_CHARGE) {
    throw new ProductionOperationMaterializationError(
      'ORDER_NOT_CHARGEABLE',
      '本入口只物化已确认价格的收费工单',
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

  if (order.productionOperations.length > 0) {
    assertExistingOperationsMatch(plan.specs, order.productionOperations);
    return {
      orderId,
      orderStatus: order.status,
      operationIds: order.productionOperations.map((operation) => operation.id),
      operationsCreated: 0,
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

  const activatedAt = at ?? (await databaseNow(tx));
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.SCHEDULING,
      scheduledAt: order.scheduledAt ?? activatedAt,
    },
  });
  await tx.orderLog.create({
    data: {
      orderId,
      operatorId: actor.id,
      action: 'OPERATIONS_MATERIALIZED',
      changedFields: {
        status: { before: order.status, after: OrderStatus.SCHEDULING },
        productionOperations: {
          before: 0,
          after: plan.specs.map((spec) => ({
            operationType: spec.operationType,
            unit: spec.unit,
            plannedQty: spec.plannedQty,
            sourceCount: spec.sources.length,
          })),
        },
      },
      remark: '价格确认后自动物化生产工序，未进行人员或机器匹配',
    },
  });

  return {
    orderId,
    orderStatus: OrderStatus.SCHEDULING,
    operationIds,
    operationsCreated: operationIds.length,
    idempotentReplay: false,
  };
}

export async function activateProductionOperations(
  orderId: string,
  actor: { id: string },
): Promise<ActivateProductionOperationsResult> {
  return db.$transaction((tx) =>
    activateProductionOperationsInTx(tx, orderId, actor),
  );
}
