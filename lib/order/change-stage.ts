import { OrderChangeRequestError } from './change-request-error';
import { OrderStatus, OrderWorkflowAction, type Prisma } from '@/generated/prisma/client';

/** Pausing changes execution, not the proposed business facts or their version. */
export async function resolveOrderChangeStageInTx(
  tx: Prisma.TransactionClient,
  order: { id: string; status: OrderStatus },
): Promise<OrderStatus> {
  if (order.status !== OrderStatus.ON_HOLD) return order.status;
  const hold = await tx.orderWorkflowDecision.findFirst({
    where: { orderId: order.id, action: OrderWorkflowAction.HOLD },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { fromStatus: true },
  });
  const allowedStages: readonly OrderStatus[] = [
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
  ];
  if (!hold || !allowedStages.includes(hold.fromStatus)) {
    throw new OrderChangeRequestError('暂停工单缺少可验证的原生产状态，请先核对暂停记录');
  }
  return hold.fromStatus;
}
