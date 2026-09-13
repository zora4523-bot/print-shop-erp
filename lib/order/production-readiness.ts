import { deriveProductionOperationPlan } from '../production/operation-materializer';
import { deriveProductionProgressPlan } from '../production/progress-materializer';
import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import { OrderPricingStatus, OrderSettlementType, OrderStatus } from '../../generated/prisma/enums';
import { orderCascadeLockKey } from './locks';
import { transitionOrder } from './status-machine';
import { evaluateFactoryConfirmationPreflight, isAwaitingFactoryConfirmation } from './factory-confirmation-preflight';
import { workflowOrderSelect, hasUnresolvedManualPricing } from './factory-confirmation-facts';
import { appendOrderPricingRevisionInTx } from './pricing-revision';

export type ProductionReadinessResult = {
  status: OrderStatus;
  ready: boolean;
  issues: string[];
};

/** Read-only readiness inspection, also used by the drawer. Never reprices or persists. */
export async function inspectOrderProductionReadinessInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      ...workflowOrderSelect,
      items: { select: { ...workflowOrderSelect.items.select, sequence: true } },
      packagingGroups: { select: { ...workflowOrderSelect.packagingGroups.select, sequence: true } },
      settlementType: true,
      processingAmount: true,
      packagingAmount: true,
      priceRevision: true,
      receiverAddress: true,
      receiverPhone: true,
      settledAt: true,
      settledFee: true,
    },
  });
  if (!isAwaitingFactoryConfirmation(order.status)) {
    return { order, status: order.status, ready: order.status === OrderStatus.CONFIRMED, issues: [] as string[] };
  }
  const preflight = evaluateFactoryConfirmationPreflight({
    status: order.status,
    itemQuantities: order.items.map((item) => item.quantity),
    pricingStatus: order.pricingStatus,
    confirmedFee: order.confirmedFee,
    totalAmount: order.totalAmount,
    pendingChangeRequestCount: order._count.changeRequests,
    manualPricingPending: hasUnresolvedManualPricing(order),
  });
  const issues = [...preflight.issues];
  if (![OrderPricingStatus.AUTO_CONFIRMED, OrderPricingStatus.ADMIN_CONFIRMED].some((status) => status === order.pricingStatus)) {
    issues.push('历史报价缺少完整核价依据，请先核对费用');
  }
  if (!order.receiverAddress?.trim()) issues.push('请补全收货地址');
  if (order.settlementType === OrderSettlementType.EXTERNAL_SALES && !order.receiverPhone?.trim()) issues.push('请补全收货人手机号');
  if (order.settledAt !== null || order.settledFee !== null) issues.push('已结算工单不能重新进入待下发');
  const packaging = order.packagingGroups.reduce((sum, group) => sum.plus(group.subtotal ?? 0), new Decimal(0));
  const processing = order.items.reduce((sum, item) => sum.plus(item.subtotal ?? 0), packaging);
  const total = order.customerCharges.reduce((sum, charge) => sum.plus(charge.amount ?? 0), processing);
  if (order.items.some((item) => item.subtotal === null) || order.packagingGroups.some((group) => group.subtotal === null) ||
    !packaging.equals(order.packagingAmount) || !processing.equals(order.processingAmount) || !total.equals(order.totalAmount) || total.isNegative() || !total.isFinite()) {
    issues.push('费用明细与工单合计不一致，请先核对费用');
  }
  const production = deriveProductionOperationPlan({ orderId, items: order.items, packagingGroups: order.packagingGroups, shipments: order.shipments });
  if (!production.ok) issues.push(...production.issues.map((issue) => issue.message));
  const craftIds = [...new Set(order.items.flatMap((item) => item.crafts))];
  const crafts = craftIds.length === 0 ? [] : await tx.craft.findMany({
    where: { id: { in: craftIds } },
    select: { id: true, code: true, name: true, isActive: true, isOutsource: true },
  });
  const progress = deriveProductionProgressPlan({ items: order.items, crafts });
  if (!progress.ok) issues.push(...progress.issues.map((issue) => issue.message));
  return { order, status: order.status, ready: issues.length === 0, issues };
}

/**
 * Runs inside an authorized mutation and shares its transaction and order lock.
 * Accept saved prices: later catalog changes must not silently reprice a quote.
 * Preparing never creates production tasks; release is an explicit admin action.
 */
export async function prepareOrderForProductionInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: { id: string },
  now: Date,
): Promise<ProductionReadinessResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
  const { order, ready, issues } = await inspectOrderProductionReadinessInTx(tx, orderId);
  if (!ready || !isAwaitingFactoryConfirmation(order.status)) return { status: order.status, ready, issues };
  const total = new Decimal(order.totalAmount);

  transitionOrder(order.status, OrderStatus.CONFIRMED);
  await tx.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.CONFIRMED, confirmedFee: total.toFixed(2) },
  });
  await appendOrderPricingRevisionInTx(tx, {
    orderId: order.id, actorId: actor.id, now,
    status: order.pricingStatus,
    source: 'ORDER_READY_FOR_PRODUCTION',
    expectedPriceRevision: order.priceRevision,
    incrementOrderRevision: true,
    orderFeeSnapshot: { quotedFee: order.quotedFee, confirmedFee: total.toFixed(2), settledFee: null },
    remark: '资料与已保存费用校验通过，进入待下发生产',
  });
  await tx.orderLog.create({ data: {
    orderId: order.id, operatorId: actor.id, action: 'ORDER_READY_FOR_PRODUCTION',
    changedFields: { status: { before: order.status, after: OrderStatus.CONFIRMED }, confirmedFee: { before: order.confirmedFee?.toFixed(2) ?? null, after: total.toFixed(2) } },
    remark: '自动完成接单校验；保留原报价，后续费用调整单独留痕',
  } });
  return { status: OrderStatus.CONFIRMED, ready: true, issues: [] };
}
