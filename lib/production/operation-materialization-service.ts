import type { Prisma } from '../../generated/prisma/client';
import Decimal from 'decimal.js';
import { operationCarryoverKey, planOperationCarryovers, sumCarriedQuantity } from './version-carryover';
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
  workOrderVersion: true,
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
      workOrderVersion: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      carriedWorkOrderProgressQty: true,
      reports: { select: { reportedCompletedQty: true } },
      workOrderProgress: { select: { workOrderProgressQuantity: true } },
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
      workOrderVersion: true,
      orderItemId: true,
      craftId: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      reports: { select: { completedQty: true } },
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
  options: {
    targetStatus?:
      | typeof OrderStatus.SCHEDULING
      | typeof OrderStatus.RELEASED
      | typeof OrderStatus.FOILING
      | typeof OrderStatus.PACKING
      | typeof OrderStatus.ON_HOLD;
    /** Explicitly allows a version upgrade to append a new generation. */
    allowVersionRematerialization?: boolean;
  } = {},
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
  const currentProductionOperations = order.productionOperations.filter(
    (operation) => operation.workOrderVersion === order.workOrderVersion,
  );
  const currentProductionProgressSteps = order.productionProgressSteps.filter(
    (step) => step.workOrderVersion === order.workOrderVersion,
  );
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

  // External-sales orders now keep PENDING_FACTORY until an explicit factory
  // decision. Legacy callers still invoke this helper after automatic/manual
  // pricing confirmation; treating that invocation as a no-op preserves the
  // call contract without silently skipping the new confirmation gate.
  if (
    options.targetStatus === undefined &&
    order.status === OrderStatus.PENDING_FACTORY
  ) {
    return {
      orderId,
      orderStatus: order.status,
      operationIds: currentProductionOperations.map(
        (operation) => operation.id,
      ),
      operationsCreated: 0,
      progressStepIds: currentProductionProgressSteps.map((step) => step.id),
      progressStepsCreated: 0,
      idempotentReplay: true,
    };
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

  const { craftFacts,progressPlan }=await loadProductionProgressPlan(order,tx);
  const requiresOutsource = craftFacts.some((craft) => craft.isOutsource);
  const targetStatus = options.targetStatus ?? OrderStatus.SCHEDULING;

  if (
    currentProductionOperations.length > 0 ||
    currentProductionProgressSteps.length > 0
  ) {
    assertExistingOperationsMatch(plan.specs, currentProductionOperations);
    assertExistingProgressMatches(
      progressPlan.specs,
      currentProductionProgressSteps,
    );
    if (order.status !== targetStatus) {
      transitionOrder(order.status, targetStatus);
      const activatedAt = at ?? (await databaseNow(tx));
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: targetStatus,
          scheduledAt: order.scheduledAt ?? activatedAt,
          requiresOutsource,
        },
      });
      await tx.orderLog.create({
        data: {
          orderId,
          operatorId: actor.id,
          action: 'OPERATIONS_RELEASED',
          changedFields: {
            status: { before: order.status, after: targetStatus },
            requiresOutsource: {
              before: order.requiresOutsource,
              after: requiresOutsource,
            },
          },
          remark: '复用已物化工序并下发生产',
        },
      });
    }
    return {
      orderId,
      orderStatus: targetStatus,
      operationIds: currentProductionOperations.map(
        (operation) => operation.id,
      ),
      operationsCreated: 0,
      progressStepIds: currentProductionProgressSteps.map((step) => step.id),
      progressStepsCreated: 0,
      idempotentReplay: true,
    };
  }

  const statusCanMaterialize =
    options.allowVersionRematerialization === true
      ? currentProductionOperations.length === 0 &&
        currentProductionProgressSteps.length === 0 &&
        (order.status === OrderStatus.CONFIRMED ||
          order.status === OrderStatus.RELEASED ||
          order.status === OrderStatus.FOILING ||
          order.status === OrderStatus.PACKING ||
          (order.status === OrderStatus.ON_HOLD && targetStatus === OrderStatus.ON_HOLD))
      : targetStatus === OrderStatus.RELEASED
      ? order.status === OrderStatus.CONFIRMED
      : order.status === OrderStatus.PENDING_FACTORY ||
        order.status === OrderStatus.SUBMITTED;
  if (!statusCanMaterialize) {
    throw new ProductionOperationMaterializationError(
      'ORDER_STATUS_NOT_ACTIVATABLE',
      `工单状态 ${order.status} 不允许首次物化工序`,
    );
  }
  if (order.status !== targetStatus) transitionOrder(order.status, targetStatus);

  const { carryovers, stepCarryovers } = buildProductionCarryovers(
    order, plan, progressPlan, options.allowVersionRematerialization,
  );
  const carryoverEvidence: Prisma.InputJsonObject[] = [];
  const operationIds: string[] = [];
  for (const spec of plan.specs) {
    const carried = carryovers.get(operationCarryoverKey(spec));
    const plannedPieces = spec.sources.reduce((sum, source) => sum.plus(source.completedPieceQty), new Decimal(0));
    const created = await tx.productionOperation.create({
      data: {
        orderId,
        workOrderVersion: order.workOrderVersion,
        operationType: spec.operationType,
        unit: spec.unit,
        status: carried?.completed.eq(plannedPieces) ? ProductionOperationStatus.COMPLETED
          : carried?.completed.isPositive() ? ProductionOperationStatus.IN_PROGRESS : ProductionOperationStatus.PENDING,
        plannedQty: spec.plannedQty,
        ...(carried ? { carriedCompletedQty: carried.completed.toString(), carriedWorkOrderProgressQty: carried.progress.toString() } : {}),
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
    if (carried) carryoverEvidence.push({ operationId: created.id, fromOperationId: carried.fromOperationId, completedQty: carried.completed.toString(), workOrderProgressQty: carried.progress.toString() });
  }

  const progressStepIds: string[] = [];
  for (const spec of progressPlan.specs) {
    const carried = stepCarryovers.get(`${spec.orderItemId}:${spec.craftId}`);
    const created = await tx.productionProgressStep.create({
      data: {
        orderId,
        workOrderVersion: order.workOrderVersion,
        orderItemId: spec.orderItemId,
        craftId: spec.craftId,
        craftCode: spec.craftCode,
        craftName: spec.craftName,
        status: carried?.completed.eq(spec.plannedQty) ? ProductionOperationStatus.COMPLETED
          : carried?.completed.isPositive() ? ProductionOperationStatus.IN_PROGRESS : ProductionOperationStatus.PENDING,
        plannedQty: spec.plannedQty,
        ...(carried ? { carriedCompletedQty: carried.completed.toString() } : {}),
      },
      select: { id: true },
    });
    progressStepIds.push(created.id);
    if (carried) carryoverEvidence.push({ progressStepId: created.id, fromStepId: carried.fromStepId, completedQty: carried.completed.toString() });
  }

  const activatedAt = at ?? (await databaseNow(tx));
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: targetStatus,
      // `scheduledAt` is the release boundary for the current work-order
      // generation. A rematerialized version must start its own stagnation
      // clock instead of inheriting the superseded paper's release time.
      scheduledAt:
        options.allowVersionRematerialization === true
          ? activatedAt
          : order.scheduledAt ?? activatedAt,
      requiresOutsource,
    },
  });
  await tx.orderLog.create({
    data: {
      orderId,
      operatorId: actor.id,
        action: options.allowVersionRematerialization
          ? 'OPERATIONS_REMATERIALIZED'
          : 'OPERATIONS_MATERIALIZED',
      changedFields: {
        ...(carryoverEvidence.length > 0 ? { productionCarryover: { fromVersion: order.workOrderVersion - 1, toVersion: order.workOrderVersion, entries: carryoverEvidence, payrollEntriesCreated: 0 } } : {}),
        status: { before: order.status, after: targetStatus },
        requiresOutsource: {
          before: order.requiresOutsource,
          after: requiresOutsource,
        },
        productionOperations: {
          before: 0,
          after: plan.specs.map((spec) => ({
            workOrderVersion: order.workOrderVersion,
            operationType: spec.operationType,
            unit: spec.unit,
            plannedQty: spec.plannedQty,
            sourceCount: spec.sources.length,
          })),
        },
        productionProgressSteps: {
          before: 0,
          after: progressPlan.specs.map((spec) => ({
            workOrderVersion: order.workOrderVersion,
            orderItemId: spec.orderItemId,
            craftId: spec.craftId,
            craftCode: spec.craftCode,
            plannedQty: spec.plannedQty,
          })),
        },
      },
      remark:
        options.allowVersionRematerialization
          ? `工单升至 v${order.workOrderVersion}，追加新生产代次；旧工序与报工事实保持只读`
          : targetStatus === OrderStatus.RELEASED
          ? '工厂确认后下发生产并物化工序，未进行人员或机器匹配'
          : '价格确认后自动物化计件工序与无计件进度步骤，未进行人员或机器匹配',
    },
  });

  return {
    orderId,
    orderStatus: targetStatus,
    operationIds,
    operationsCreated: operationIds.length,
    progressStepIds,
    progressStepsCreated: progressStepIds.length,
    idempotentReplay: false,
  };
}

async function loadProductionProgressPlan(
  order: MaterializationOrder,
  tx: Prisma.TransactionClient,
) {
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
  return { craftFacts, progressPlan };
}

function buildProductionCarryovers(
  order: MaterializationOrder,
  plan: ReturnType<typeof deriveProductionOperationPlan>,
  progressPlan: ReturnType<typeof deriveProductionProgressPlan>,
  allowVersionRematerialization: boolean | undefined,
) {
  const previousOperations = allowVersionRematerialization
    ? order.productionOperations.filter(
        (row) => row.workOrderVersion === order.workOrderVersion - 1,
      )
    : [];
  const previousSteps = allowVersionRematerialization
    ? order.productionProgressSteps.filter(
        (row) => row.workOrderVersion === order.workOrderVersion - 1,
      )
    : [];
  let carryovers: ReturnType<typeof planOperationCarryovers>;
  const stepCarryovers = new Map<string, { fromStepId: string; completed: Decimal }>();
  try {
    carryovers = planOperationCarryovers(previousOperations, plan.specs);
    const orderTotal = order.items.reduce((sum, item) => sum.plus(item.quantity), new Decimal(0));
    for (const packing of [false, true]) {
      const progress = plan.specs
        .filter((spec) => (spec.operationType === 'PACKING') === packing)
        .reduce(
          (sum, spec) => sum.plus(carryovers.get(operationCarryoverKey(spec))?.progress ?? 0),
          new Decimal(0),
        );
      if (progress.gt(orderTotal)) throw new Error('修改后的工单总量不能少于已完成的工单件数');
    }
    for (const step of previousSteps) {
      const completed = sumCarriedQuantity(
        step.carriedCompletedQty,
        (step.reports ?? []).map((report) => report.completedQty),
      );
      if (completed.isZero()) continue;
      const next = progressPlan.specs.find(
        (spec) => spec.orderItemId === step.orderItemId && spec.craftId === step.craftId,
      );
      if (!next || completed.isNegative() || completed.gt(next.plannedQty))
        throw new Error('已有工艺进度无法承接，修改数量不能少于已完成数量');
      stepCarryovers.set(`${step.orderItemId}:${step.craftId}`, { fromStepId: step.id, completed });
    }
  } catch (error) {
    throw new ProductionOperationMaterializationError(
      'CANONICAL_FACTS_INCOMPLETE',
      error instanceof Error ? error.message : '无法承接历史生产进度',
    );
  }
  return { carryovers, stepCarryovers };
}
