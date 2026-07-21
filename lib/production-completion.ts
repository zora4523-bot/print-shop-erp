import {
  OrderStatus,
  OutsourceStatus,
  TaskStatus,
} from '../generated/prisma/enums';
import { transitionOrder } from './order/status-machine';

// Shared completion gate for internal production and outsource receiving.
// Callers must already hold orderCascadeLockKey(orderId) in the same
// transaction. Keeping the decision here prevents the two flows from
// independently declaring the order complete.
export type ProductionCompletionTx = {
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      status: OrderStatus;
      requiresOutsource?: boolean;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<unknown>;
  };
  productionTask: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: OutsourceStatus }>>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export async function maybeCompleteProductionOrder(
  tx: ProductionCompletionTx,
  orderId: string,
  actorId: string,
  now: Date,
): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, requiresOutsource: true },
  });
  if (!order) return false;
  if (order.status === OrderStatus.COMPLETED) return false;
  if (
    order.status !== OrderStatus.SCHEDULING &&
    order.status !== OrderStatus.IN_PRODUCTION
  ) {
    return false;
  }

  const tasks = await tx.productionTask.findMany({
    where: { orderItem: { orderId } },
    select: { id: true, status: true },
  });
  const activeTasks = tasks.filter((task) => task.status !== TaskStatus.CANCELLED);
  const internalReady = activeTasks.every(
    (task) => task.status === TaskStatus.COMPLETED,
  );
  if (!internalReady) return false;

  let outsourceReady = true;
  if (order.requiresOutsource) {
    const outsourceOrders = await tx.outsourceOrder.findMany({
      where: { orderId, status: { not: OutsourceStatus.CANCELLED } },
      select: { id: true, status: true },
    });
    outsourceReady =
      outsourceOrders.length > 0 &&
      outsourceOrders.every((row) => row.status === OutsourceStatus.RECEIVED);
  }
  if (!outsourceReady) return false;

  transitionOrder(order.status, OrderStatus.COMPLETED);
  await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.COMPLETED, completedAt: now },
    select: { id: true, status: true },
  });
  await tx.orderLog.create({
    data: {
      orderId,
      operatorId: actorId,
      action: 'STATUS_CHANGE',
      changedFields: {
        status: { before: order.status, after: OrderStatus.COMPLETED },
      },
      remark:
        activeTasks.length === 0
          ? '外协全部收货，工单完工'
          : order.requiresOutsource
            ? '内部任务与外协全部完成'
            : '全部任务完工',
    },
  });
  return true;
}
