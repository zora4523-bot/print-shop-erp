import {
  OrderStatus,
  ProductionTaskDisputeStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';

export class TaskDisputeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskDisputeError';
  }
}

type TaskDisputeActor = { id: string; role: Role };

export type WorkerTaskDisputeView = {
  id: string;
  productionTaskId: string;
  status: ProductionTaskDisputeStatus;
  reason: string;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedBy: { displayName: string } | null;
};

export type OrderTaskDisputeView = WorkerTaskDisputeView & {
  worker: { id: string; displayName: string };
  productionTask: {
    id: string;
    status: TaskStatus;
    plannedQty: number;
    completedQty: number;
    pieceworkAmount: unknown;
    orderItem: { sequence: number; name: string };
    craft: { name: string };
  };
};

function disputeLockKey(disputeOrTaskId: string): string {
  return `print-shop-erp:task-dispute:${disputeOrTaskId}`;
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 5 || normalized.length > 1000) {
    throw new TaskDisputeError('异议原因需为 5–1000 个字符');
  }
  return normalized;
}

function normalizeResolution(resolution: string): string {
  const normalized = resolution.trim();
  if (normalized.length < 2 || normalized.length > 1000) {
    throw new TaskDisputeError('处理回复需为 2–1000 个字符');
  }
  return normalized;
}

export async function createTaskDispute(
  input: { taskId: string; reason: string },
  actor: TaskDisputeActor,
) {
  if (actor.role !== Role.WORKER) {
    throw new TaskDisputeError('只有师傅可以发起任务异议');
  }
  const reason = normalizeReason(input.reason);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${disputeLockKey(
      input.taskId,
    )}))`;
    const task = await tx.productionTask.findFirst({
      where: {
        id: input.taskId,
        workerId: actor.id,
        orderItem: {
          order: { status: { not: OrderStatus.SUBMITTED } },
        },
      },
      select: {
        id: true,
        orderItem: { select: { orderId: true, name: true, sequence: true } },
        craft: { select: { name: true } },
      },
    });
    if (!task) {
      throw new TaskDisputeError('任务不存在、未完成排产或不属于当前师傅');
    }
    const pending = await tx.productionTaskDispute.findFirst({
      where: {
        productionTaskId: task.id,
        status: ProductionTaskDisputeStatus.PENDING,
      },
      select: { id: true },
    });
    if (pending) {
      throw new TaskDisputeError('该任务已有待处理异议，请等待管理员回复');
    }
    const dispute = await tx.productionTaskDispute.create({
      data: {
        productionTaskId: task.id,
        workerId: actor.id,
        reason,
      },
      select: { id: true, status: true, createdAt: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: task.orderItem.orderId,
        operatorId: actor.id,
        action: 'TASK_DISPUTE_CREATED',
        changedFields: {
          taskId: { before: null, after: task.id },
          disputeStatus: { before: null, after: dispute.status },
        },
        remark: `师傅发起任务异议：${task.orderItem.name} (#${task.orderItem.sequence}) · ${task.craft.name}；${reason}`,
      },
    });
    return {
      disputeId: dispute.id,
      taskId: task.id,
      orderId: task.orderItem.orderId,
    };
  });
}

export async function reviewTaskDispute(
  input: {
    disputeId: string;
    decision: 'RESOLVED' | 'REJECTED';
    resolution: string;
  },
  actor: TaskDisputeActor,
  now = new Date(),
) {
  if (actor.role !== Role.ADMIN) {
    throw new TaskDisputeError('只有管理员可以处理任务异议');
  }
  const resolution = normalizeResolution(input.resolution);
  const status =
    input.decision === 'RESOLVED'
      ? ProductionTaskDisputeStatus.RESOLVED
      : ProductionTaskDisputeStatus.REJECTED;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${disputeLockKey(
      input.disputeId,
    )}))`;
    const dispute = await tx.productionTaskDispute.findUnique({
      where: { id: input.disputeId },
      select: {
        id: true,
        status: true,
        workerId: true,
        productionTaskId: true,
        productionTask: {
          select: {
            orderItem: {
              select: { orderId: true, name: true, sequence: true },
            },
            craft: { select: { name: true } },
          },
        },
      },
    });
    if (!dispute) throw new TaskDisputeError('异议记录不存在');
    if (dispute.status !== ProductionTaskDisputeStatus.PENDING) {
      throw new TaskDisputeError('该异议已处理，不能重复操作');
    }
    const updated = await tx.productionTaskDispute.update({
      where: { id: dispute.id },
      data: {
        status,
        resolution,
        resolvedById: actor.id,
        resolvedAt: now,
      },
      select: { id: true, status: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: dispute.productionTask.orderItem.orderId,
        operatorId: actor.id,
        action:
          status === ProductionTaskDisputeStatus.RESOLVED
            ? 'TASK_DISPUTE_RESOLVED'
            : 'TASK_DISPUTE_REJECTED',
        changedFields: {
          taskId: { before: dispute.productionTaskId, after: dispute.productionTaskId },
          disputeStatus: { before: dispute.status, after: status },
          disputeResolution: { before: null, after: resolution },
        },
        remark: `处理任务异议：${dispute.productionTask.orderItem.name} (#${dispute.productionTask.orderItem.sequence}) · ${dispute.productionTask.craft.name}；${resolution}`,
      },
    });
    return {
      disputeId: updated.id,
      taskId: dispute.productionTaskId,
      orderId: dispute.productionTask.orderItem.orderId,
      status: updated.status,
    };
  });
}

export async function listWorkerTaskDisputes(
  taskId: string,
  actor: TaskDisputeActor,
): Promise<WorkerTaskDisputeView[]> {
  if (actor.role !== Role.WORKER) {
    throw new TaskDisputeError('只有师傅可以查看本人任务异议');
  }
  const task = await db.productionTask.findFirst({
    where: {
      id: taskId,
      workerId: actor.id,
      orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
    },
    select: { id: true },
  });
  if (!task) {
    throw new TaskDisputeError('任务不存在或不属于当前师傅');
  }
  return db.productionTaskDispute.findMany({
    where: { productionTaskId: task.id, workerId: actor.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      productionTaskId: true,
      status: true,
      reason: true,
      resolution: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
      resolvedBy: { select: { displayName: true } },
    },
  });
}

export async function listOrderTaskDisputes(
  orderId: string,
  actor: TaskDisputeActor,
): Promise<OrderTaskDisputeView[]> {
  if (actor.role !== Role.ADMIN) {
    throw new TaskDisputeError('只有管理员可以查看整单任务异议');
  }
  return db.productionTaskDispute.findMany({
    where: { productionTask: { orderItem: { orderId } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      productionTaskId: true,
      status: true,
      reason: true,
      resolution: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
      worker: { select: { id: true, displayName: true } },
      resolvedBy: { select: { displayName: true } },
      productionTask: {
        select: {
          id: true,
          status: true,
          plannedQty: true,
          completedQty: true,
          pieceworkAmount: true,
          orderItem: { select: { sequence: true, name: true } },
          craft: { select: { name: true } },
        },
      },
    },
  });
}
