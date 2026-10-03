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
import { activateUnassignedOrderInTx } from '../production/automatic-entry';
import type { ProductionCompletionNotification } from '../production-completion';
import type { PreparedProductionNotification } from '../production/preparation-notification';
import { productionPlanIssueMessages } from '../production/dispatch-plan-error';

export type ProductionReadinessResult = {
  status: OrderStatus;
  ready: boolean;
  issues: string[];
  notification?: ProductionCompletionNotification;
  scheduledNotification?: PreparedProductionNotification;
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
  if (!isAwaitingFactoryConfirmation(order.status) && order.status !== OrderStatus.CONFIRMED) {
    return { order, status: order.status, ready: false, issues: [] as string[] };
  }
  const preflight = evaluateFactoryConfirmationPreflight({
    status: order.status,
    itemQuantities: order.items.map((item) => item.quantity),
    pricingStatus: order.pricingStatus,
    confirmedFee: order.confirmedFee,
    totalAmount: order.totalAmount,
    pendingChangeRequestCount: order._count.changeRequests,
    manualPricingPending: hasUnresolvedManualPricing(order),
  }, { allowConfirmed: true });
  const issues = [...preflight.issues];
  if (![OrderPricingStatus.AUTO_CONFIRMED, OrderPricingStatus.ADMIN_CONFIRMED].some((status) => status === order.pricingStatus)) {
    issues.push('历史报价缺少完整核价依据，请先核对费用');
  }
  if (!order.receiverAddress?.trim()) issues.push('请补全收货地址');
  if (order.settlementType === OrderSettlementType.EXTERNAL_SALES && !order.receiverPhone?.trim()) issues.push('请补全收货人手机号');
  if (order.settledAt !== null || order.settledFee !== null) issues.push('已结算工单不能重新安排生产');
  const packaging = order.packagingGroups.reduce((sum, group) => sum.plus(group.subtotal ?? 0), new Decimal(0));
  const processing = order.items.reduce((sum, item) => sum.plus(item.subtotal ?? 0), packaging);
  const total = order.customerCharges.reduce((sum, charge) => sum.plus(charge.amount ?? 0), processing);
  if (order.items.some((item) => item.subtotal === null) || order.packagingGroups.some((group) => group.subtotal === null) ||
    !packaging.equals(order.packagingAmount) || !processing.equals(order.processingAmount) || !total.equals(order.totalAmount) || total.isNegative() || !total.isFinite()) {
    issues.push('费用明细与工单合计不一致，请先核对费用');
  }
  if (order.purpose === 'SAMPLE_SHIPMENT') return { order, status: order.status, ready: issues.length === 0, issues };
  const production = deriveProductionOperationPlan({ orderId, items: order.items, packagingGroups: order.packagingGroups, shipments: order.shipments });
  if (!production.ok) issues.push(...productionPlanIssueMessages(production.issues));
  const craftIds = [...new Set(order.items.flatMap((item) => item.crafts))];
  const crafts = craftIds.length === 0 ? [] : await tx.craft.findMany({
    where: { id: { in: craftIds } },
    select: { id: true, code: true, name: true, isActive: true, isOutsource: true },
  });
  const progress = deriveProductionProgressPlan({ items: order.items, crafts });
  if (!progress.ok) issues.push(...productionPlanIssueMessages(progress.issues));
  return { order, status: order.status, ready: issues.length === 0, issues };
}

/**
 * Runs inside an authorized mutation and shares its transaction and order lock.
 * Accept saved prices: later catalog changes must not silently reprice a quote.
 * 无需安排师傅的工单在校验后自动进入对应履约流程。
 */
export async function prepareOrderForProductionInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: { id: string },
  now: Date,
): Promise<ProductionReadinessResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
  const { order, ready, issues } = await inspectOrderProductionReadinessInTx(tx, orderId);
  if (!ready) return { status: order.status, ready, issues };
  if (order.status === OrderStatus.CONFIRMED) {
    const activated = await activateUnassignedOrderInTx(tx, orderId, actor.id, now);
    return { status: activated?.status ?? order.status, ready, issues, ...(activated?.notification ? { notification: activated.notification } : {}), ...(activated?.scheduledNotification ? { scheduledNotification: activated.scheduledNotification } : {}) };
  }
  if (!isAwaitingFactoryConfirmation(order.status)) return { status: order.status, ready, issues };
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
    remark: '资料与已保存费用校验通过，按工单用途进入履约流程',
  });
  await tx.orderLog.create({ data: {
    orderId: order.id, operatorId: actor.id, action: 'ORDER_READY_FOR_PRODUCTION',
    changedFields: { status: { before: order.status, after: OrderStatus.CONFIRMED }, confirmedFee: { before: order.confirmedFee?.toFixed(2) ?? null, after: total.toFixed(2) } },
    remark: '自动完成接单校验；保留原报价，后续费用调整单独留痕',
  } });
  const activated = await activateUnassignedOrderInTx(tx, orderId, actor.id, now);
  return { status: activated?.status ?? OrderStatus.CONFIRMED, ready: true, issues: [], ...(activated?.notification ? { notification: activated.notification } : {}), ...(activated?.scheduledNotification ? { scheduledNotification: activated.scheduledNotification } : {}) };
}
