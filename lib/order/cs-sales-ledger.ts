import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
} from '../../generated/prisma/enums';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  csSalesBasisAmountInTx,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';

/** 写流水前的工单事实；status 为本次操作前的状态，totalAmount 为操作前金额。 */
export type CsSalesCancellationOrder = {
  id: string;
  submitterId: string;
  settlementType: OrderSettlementType;
  billingMode: OrderBillingMode;
  status: OrderStatus;
  totalAmount: Decimal.Value;
};

/**
 * 工单是否已计入客服业绩：只有已提交过的内部收费单（INTERNAL_SALES + CHARGE，
 * 且不是草稿）记过 ORDER_SUBMITTED 正数流水；草稿提交时才按当时金额记账。
 */
export function orderAccruesCsSales(
  order: Pick<CsSalesCancellationOrder, 'settlementType' | 'billingMode' | 'status'>,
): boolean {
  return (
    order.settlementType === OrderSettlementType.INTERNAL_SALES &&
    order.billingMode === OrderBillingMode.CHARGE &&
    order.status !== OrderStatus.DRAFT
  );
}

/**
 * 工单取消时冲销客服业绩（SPEC §3.7「工单取消 → 追加负数冲销流水」，
 * DECISIONS 2026-08-02「取消时追加全额负数」）。直接取消与取消申请审批
 * 共用本函数，两条取消路径的口径、对平校验与事件键格式因此一致。
 *
 * 未计入业绩的工单（见 orderAccruesCsSales）直接返回。冲销前先核对流水与当前
 * 业绩基数对平，未对平或没有覆盖发生日的进行中周期时抛 CsSalesLedgerError，
 * 由调用方映射为各自领域的错误并整体回滚。调用方必须已持有工单级锁，
 * 本函数随后取客服锁（recordCsSalesEntryInTx 内），锁顺序保持
 * 结算截止共享锁 → 工单级锁 → 客服锁。
 */
export async function reverseCsSalesOnOrderCancelInTx(
  tx: Prisma.TransactionClient,
  order: CsSalesCancellationOrder,
  event: { orderRevision: number; occurredAt: Date; remark: string },
): Promise<void> {
  if (!orderAccruesCsSales(order)) return;
  const salesBasis = await csSalesBasisAmountInTx(tx, order.id, order.totalAmount);
  await assertCsOrderSalesLedgerReconciledInTx(tx, order.id, salesBasis);
  await recordCsSalesEntryInTx(tx, {
    eventKey: `order:${order.id}:revision:${event.orderRevision}:cancel`,
    csUserId: order.submitterId,
    orderId: order.id,
    orderRevision: event.orderRevision,
    type: CsSalesEntryType.ORDER_CANCELLED,
    amount: new Decimal(salesBasis).negated(),
    occurredAt: event.occurredAt,
    remark: event.remark,
  });
}

/**
 * 已计入业绩的工单金额变化后，按业绩口径差额追加 ORDER_CHANGED 流水
 * （SPEC §3.7「按新旧金额差额追加调整流水」）。previousBasis 必须由调用方在
 * 改写收费行之前用 csSalesBasisAmountInTx 取得；本函数在改写之后按新总额重新
 * 取口径，差额为 0 时不读不写。有差额时先核对原口径对平再追加，错误语义与
 * reverseCsSalesOnOrderCancelInTx 相同。
 */
export async function recordCsSalesBasisChangeInTx(
  tx: Prisma.TransactionClient,
  order: Omit<CsSalesCancellationOrder, 'totalAmount'>,
  change: {
    previousBasis: string;
    nextTotalAmount: Decimal.Value;
    eventName: string;
    orderRevision: number;
    occurredAt: Date;
    remark: string;
  },
): Promise<void> {
  if (!orderAccruesCsSales(order)) return;
  const nextBasis = await csSalesBasisAmountInTx(tx, order.id, change.nextTotalAmount);
  const delta = new Decimal(nextBasis).minus(change.previousBasis);
  if (delta.isZero()) return;
  await assertCsOrderSalesLedgerReconciledInTx(tx, order.id, change.previousBasis);
  await recordCsSalesEntryInTx(tx, {
    eventKey: `order:${order.id}:revision:${change.orderRevision}:${change.eventName}`,
    csUserId: order.submitterId,
    orderId: order.id,
    orderRevision: change.orderRevision,
    type: CsSalesEntryType.ORDER_CHANGED,
    amount: delta.toFixed(2),
    occurredAt: change.occurredAt,
    remark: change.remark,
  });
}
