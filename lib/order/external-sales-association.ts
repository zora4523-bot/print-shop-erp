import { db } from '@/lib/db';
import { OrderSettlementType, Role } from '@/generated/prisma/enums';
import { editableFieldsetForStatus } from './editable-fields';
import { ORDER_SETTLEMENT_LABELS } from './settlement';
import type { Prisma } from '@/generated/prisma/client';

export const externalSalesAssociationSelect = {
  submitterId: true,
  submitter: { select: { id: true, displayName: true, username: true } },
  settlementType: true,
  status: true,
  settledAt: true,
  settledFee: true,
  shippedAt: true,
  finishedAt: true,
  sourceOrderId: true,
  _count: {
    select: {
      billItems: true,
      reworkOrders: true,
      changeRequests: { where: { status: 'PENDING' } },
    },
  },
  agentMonthlyBillItem: { select: { id: true } },
} satisfies Prisma.OrderSelect;

type AssociationOrder = Prisma.OrderGetPayload<{
  select: typeof externalSalesAssociationSelect;
}>;

export function externalSalesAssociationBlockReason(order: AssociationOrder): string | null {
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    return `此工单按“${ORDER_SETTLEMENT_LABELS[order.settlementType]}”结算，不能改为外部销售。`;
  }
  if (editableFieldsetForStatus(order.status) !== 'FULL') {
    return '工单已确认，不能更换关联外部销售。';
  }
  if (order._count.changeRequests > 0) return '处理当前修改申请后才能更换关联外部销售。';
  if (order.settledAt !== null || order.settledFee !== null || order.shippedAt !== null ||
    order.finishedAt !== null || order._count.billItems > 0 ||
    order.agentMonthlyBillItem !== null) {
    return '工单已有结算、账单或发货记录，不能更换关联外部销售。';
  }
  if (order.sourceOrderId !== null || order._count.reworkOrders > 0) {
    return '工单已关联重做记录，不能单独更换关联外部销售。';
  }
  return null;
}

export type ExternalSalesAccountOption = {
  id: string;
  displayName: string;
  username: string;
};

export async function listExternalSalesAccountOptions(
  actor: { role: Role },
): Promise<ExternalSalesAccountOption[]> {
  if (actor.role !== Role.ADMIN) return [];
  return db.user.findMany({
    where: { role: Role.SALES, isActive: true },
    select: { id: true, displayName: true, username: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
}

export type OrderExternalSalesAssociation = {
  current: ExternalSalesAccountOption | null;
  options: ExternalSalesAccountOption[];
  blockedReason: string | null;
};

/** Admin-only minimal projection: never send account credentials or staff data. */
export async function getOrderExternalSalesAssociation(
  orderId: string,
  actor: { role: Role },
): Promise<OrderExternalSalesAssociation | undefined> {
  if (actor.role !== Role.ADMIN) return undefined;
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: externalSalesAssociationSelect,
  });
  if (!order) return undefined;
  const blockedReason = externalSalesAssociationBlockReason(order);
  return {
    current: order.settlementType === OrderSettlementType.EXTERNAL_SALES ? order.submitter : null,
    blockedReason,
    options: blockedReason ? [] : await listExternalSalesAccountOptions(actor),
  };
}
