import {
  OrderStatus,
  OutsourceStatus,
  Role,
  TaskStatus,
  type MachineType,
  type WorkerType,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import {
  getWorkerAssignmentEligibility,
  isWorkerCompatible,
  SchedulingError,
} from '@/lib/production';
import { transitionOrder } from '@/lib/order/status-machine';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { dispatchNotification } from '@/lib/notification/dispatch';
import {
  InvalidOrderTransitionError,
  OrderInvariantError,
} from '@/lib/order';

export type BatchScheduleOrdersInput = {
  orderIds: string[];
  workerId: string;
  overrideReason?: string;
};

export type BatchScheduleOrdersResult = {
  assigned: Array<{
    orderId: string;
    orderNo: string;
    tasksCreated: number;
    remainingTaskCount: number;
    fullyScheduled: boolean;
  }>;
  failed: Array<{
    orderId: string;
    orderNo: string | null;
    message: string;
  }>;
};

type SelectedWorker = {
  id: string;
  role: Role;
  isActive: boolean;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  machineCapabilities: MachineType[];
  craftCapabilities: Array<{ craftId: string }>;
};

async function requireActiveWorker(workerId: string): Promise<SelectedWorker> {
  const worker = await db.user.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      role: true,
      isActive: true,
      workerType: true,
      machineType: true,
      machineCapabilities: true,
      craftCapabilities: { select: { craftId: true } },
    },
  });
  if (!worker || worker.role !== Role.WORKER || !worker.isActive) {
    throw new SchedulingError('师傅不存在、已停用或账号角色不正确');
  }
  return worker;
}

async function assignCompatibleTasksForOrder(
  orderId: string,
  workerId: string,
  overrideReason: string | undefined,
  actor: { id: string; role: Role },
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;

    const worker = await tx.user.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        role: true,
        isActive: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
        craftCapabilities: { select: { craftId: true } },
      },
    });
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        status: true,
        items: {
          select: { id: true, quantity: true, crafts: true },
          orderBy: { sequence: 'asc' },
        },
        outsourceOrders: {
          where: { status: { not: OutsourceStatus.CANCELLED } },
          select: { id: true },
        },
      },
    });
    if (!worker || worker.role !== Role.WORKER || !worker.isActive) {
      throw new SchedulingError('师傅不存在、已停用或账号角色不正确');
    }
    if (!order) throw new OrderInvariantError('工单不存在');
    if (order.status !== OrderStatus.SUBMITTED) {
      throw new SchedulingError('工单已不在待排产状态，请刷新列表');
    }

    const craftIds = new Set<string>();
    for (const item of order.items) {
      for (const craftId of item.crafts) craftIds.add(craftId);
    }
    const crafts =
      craftIds.size === 0
        ? []
        : await tx.craft.findMany({
            where: { id: { in: [...craftIds] } },
            select: {
              id: true,
              isActive: true,
              isOutsource: true,
              defaultWorkerType: true,
              defaultMachineType: true,
              inHouseMachineTypes: true,
            },
          });
    const craftById = new Map(crafts.map((craft) => [craft.id, craft]));
    const expectedPairs: Array<{
      key: string;
      orderItemId: string;
      quantity: number;
      craft: (typeof crafts)[number];
    }> = [];
    let outsourceCraftCount = 0;
    for (const item of order.items) {
      for (const craftId of item.crafts) {
        const craft = craftById.get(craftId);
        if (!craft) throw new SchedulingError(`工艺不存在：${craftId}`);
        if (!craft.isActive) {
          throw new SchedulingError(`工艺已停用：${craftId}`);
        }
        if (craft.isOutsource) outsourceCraftCount += 1;
        if (!craft.isOutsource || craft.inHouseMachineTypes.length > 0) {
          expectedPairs.push({
            key: `${item.id}:${craftId}`,
            orderItemId: item.id,
            quantity: item.quantity,
            craft,
          });
        }
      }
    }
    if (expectedPairs.length === 0) {
      throw new SchedulingError('该工单没有需要分配给师傅的内部工艺');
    }
    if (
      outsourceCraftCount > 0 &&
      order.outsourceOrders.length === 0
    ) {
      throw new SchedulingError('工单包含外协工艺，请先创建外协单');
    }

    const existingTasks = await tx.productionTask.findMany({
      where: { orderItemId: { in: order.items.map((item) => item.id) } },
      select: {
        id: true,
        orderItemId: true,
        craftId: true,
        status: true,
      },
    });
    const expectedKeys = new Set(expectedPairs.map((pair) => pair.key));
    const existingKeys = new Set<string>();
    for (const task of existingTasks) {
      const key = `${task.orderItemId}:${task.craftId}`;
      if (!expectedKeys.has(key) || task.status !== TaskStatus.PENDING) {
        throw new SchedulingError(
          '工单包含异常或已经开始的生产任务，请单独检查',
        );
      }
      existingKeys.add(key);
    }

    const compatiblePairs = expectedPairs.filter(
      (pair) =>
        !existingKeys.has(pair.key) &&
        isWorkerCompatible(pair.craft, worker),
    );
    if (compatiblePairs.length === 0) {
      throw new SchedulingError(
        '所选师傅没有可以承接的剩余工艺，请选择其他师傅',
      );
    }
    const overridePairs = compatiblePairs.filter(
      (pair) =>
        !getWorkerAssignmentEligibility(pair.craft, worker).recommended,
    );
    if (
      overridePairs.length > 0 &&
      (overrideReason?.trim().length ?? 0) === 0
    ) {
      throw new SchedulingError(
        `所选师傅有 ${overridePairs.length} 个未登记的熟练工艺；如仍需分配，请填写非推荐派工原因`,
      );
    }

    const inserted = await tx.productionTask.createMany({
      data: compatiblePairs.map((pair) => ({
        orderItemId: pair.orderItemId,
        craftId: pair.craft.id,
        workerId: worker.id,
        workerType: pair.craft.defaultWorkerType,
        machineType: getWorkerAssignmentEligibility(pair.craft, worker)
          .machineType,
        status: TaskStatus.PENDING,
        plannedQty: pair.quantity,
      })),
    });
    const remainingTaskCount =
      expectedPairs.length - existingKeys.size - inserted.count;
    const fullyScheduled = remainingTaskCount === 0;
    if (fullyScheduled) {
      transitionOrder(order.status, OrderStatus.SCHEDULING);
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.SCHEDULING,
          scheduledAt: new Date(),
          requiresOutsource: outsourceCraftCount > 0,
        },
        select: { id: true },
      });
      await tx.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: {
              before: OrderStatus.SUBMITTED,
              after: OrderStatus.SCHEDULING,
            },
            ...(overridePairs.length > 0
              ? {
                  assignmentOverrides: overridePairs.map((pair) => ({
                    orderItemId: pair.orderItemId,
                    craftId: pair.craft.id,
                    workerId: worker.id,
                    reason: overrideReason?.trim() ?? '',
                  })),
                }
              : {}),
          },
          remark: `分步排产完成：本次分配 ${inserted.count} 个任务，全部 ${expectedPairs.length} 个内部任务已确认${
            overridePairs.length > 0
              ? `；非推荐派工 ${overridePairs.length} 项（原因已记录）`
              : ''
          }`,
        },
      });
    } else {
      await tx.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'UPDATE',
          changedFields: {
            assignedProductionTasks: {
              before: existingKeys.size,
              after: existingKeys.size + inserted.count,
            },
            ...(overridePairs.length > 0
              ? {
                  assignmentOverrides: overridePairs.map((pair) => ({
                    orderItemId: pair.orderItemId,
                    craftId: pair.craft.id,
                    workerId: worker.id,
                    reason: overrideReason?.trim() ?? '',
                  })),
                }
              : {}),
          },
          remark: `分步排产：本次分配 ${inserted.count} 个任务，尚余 ${remainingTaskCount} 个内部任务待派${
            overridePairs.length > 0
              ? `；非推荐派工 ${overridePairs.length} 项（原因已记录）`
              : ''
          }`,
        },
      });
    }

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      tasksCreated: inserted.count,
      totalTaskCount: expectedPairs.length,
      remainingTaskCount,
      fullyScheduled,
    };
  });
}

export async function scheduleOrdersToWorker(
  input: BatchScheduleOrdersInput,
  actor: { id: string; role: Role },
): Promise<BatchScheduleOrdersResult> {
  await requireActiveWorker(input.workerId);

  const result: BatchScheduleOrdersResult = { assigned: [], failed: [] };
  for (const orderId of input.orderIds) {
    try {
      const assigned = await assignCompatibleTasksForOrder(
        orderId,
        input.workerId,
        input.overrideReason,
        actor,
      );
      result.assigned.push(assigned);
      if (assigned.fullyScheduled) {
        await dispatchNotification(
          'ORDER_SCHEDULED',
          {
            orderId: assigned.orderId,
            orderNo: assigned.orderNo,
            taskCount: assigned.totalTaskCount,
          },
          {
            dedupeKey: `notification:ORDER_SCHEDULED:${assigned.orderId}`,
          },
        );
      }
    } catch (error) {
      if (
        error instanceof SchedulingError ||
        error instanceof OrderInvariantError ||
        error instanceof InvalidOrderTransitionError
      ) {
        result.failed.push({
          orderId,
          orderNo: null,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  return result;
}
