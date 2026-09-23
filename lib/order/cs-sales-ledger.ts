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

/** 取消前的工单事实；status 必须是取消前状态，totalAmount 为取消前金额。 */
export type CsSalesCancellationOrder = {
  id: string;
  submitterId: string;
  settlementType: OrderSettlementType;
  billingMode: OrderBillingMode;
  status: OrderStatus;
  totalAmount: Decimal.Value;
};

/**
 * 工单取消时冲销客服业绩（SPEC §3.7「工单取消 → 追加负数冲销流水」，
 * DECISIONS 2026-08-02「取消时追加全额负数」）。直接取消与取消申请审批
 * 共用本函数，两条取消路径的口径、对平校验与事件键格式因此一致。
 *
 * 只有已提交过的内部收费单（INTERNAL_SALES + CHARGE，且不是草稿）记过
 * ORDER_SUBMITTED 正数流水，其余工单直接返回。冲销前先核对流水与当前业绩
 * 基数对平，未对平或没有覆盖发生日的进行中周期时抛 CsSalesLedgerError，
 * 由调用方映射为各自领域的错误并整体回滚。调用方必须已持有工单级锁，
 * 本函数随后取客服锁（recordCsSalesEntryInTx 内），锁顺序保持
 * 结算截止共享锁 → 工单级锁 → 客服锁。
 */
export async function reverseCsSalesOnOrderCancelInTx(
  tx: Prisma.TransactionClient,
  order: CsSalesCancellationOrder,
  event: { orderRevision: number; occurredAt: Date; remark: string },
): Promise<void> {
  if (
    order.settlementType !== OrderSettlementType.INTERNAL_SALES ||
    order.billingMode !== OrderBillingMode.CHARGE ||
    // 草稿从未写过 ORDER_SUBMITTED，没有可冲销的正数流水。
    order.status === OrderStatus.DRAFT
  ) {
    return;
  }
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
