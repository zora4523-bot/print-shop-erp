import Decimal from 'decimal.js';
import { Role, TaskStatus } from '../generated/prisma/client';
import { db } from './db';

export type WorkerActor = { id: string; role: Role };

export class WorkerPortalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerPortalError';
  }
}

function requireWorkerActor(actor: WorkerActor): void {
  if (actor.role !== Role.WORKER) {
    throw new WorkerPortalError('仅师傅账号可访问个人工作台');
  }
}

// 师傅工单的唯一可见性定义：工单中至少一个 ProductionTask.workerId
// 等于当前登录用户。列表与详情复用同一形状，避免页面层漏加归属条件。
function ownOrderWhere(workerId: string) {
  return {
    items: {
      some: {
        tasks: { some: { workerId } },
      },
    },
  } as const;
}

export async function listWorkerOrders(actor: WorkerActor) {
  requireWorkerActor(actor);
  const orders = await db.order.findMany({
    where: ownOrderWhere(actor.id),
    orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      orderNo: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      createdAt: true,
      items: {
        where: { tasks: { some: { workerId: actor.id } } },
        select: {
          id: true,
          tasks: {
            where: { workerId: actor.id },
            select: {
              id: true,
              status: true,
              pieceworkAmount: true,
            },
          },
        },
      },
    },
  });

  return orders.map((order) => {
    const tasks = order.items.flatMap((item) => item.tasks);
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      isUrgent: order.isUrgent,
      customerRef: order.customerRef,
      promisedDate: order.promisedDate,
      createdAt: order.createdAt,
      taskCount: tasks.length,
      completedTaskCount: tasks.filter(
        (task) => task.status === TaskStatus.COMPLETED,
      ).length,
      pieceworkAmount: tasks
        .reduce(
          (sum, task) =>
            sum.plus(new Decimal(task.pieceworkAmount as Decimal.Value)),
          new Decimal(0),
        )
        .toFixed(2),
    };
  });
}

export async function getWorkerOrderDetail(
  orderId: string,
  actor: WorkerActor,
) {
  requireWorkerActor(actor);
  return db.order.findFirst({
    where: { id: orderId, ...ownOrderWhere(actor.id) },
    select: {
      id: true,
      orderNo: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      packageRequirement: true,
      remark: true,
      createdAt: true,
      items: {
        where: { tasks: { some: { workerId: actor.id } } },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          specification: true,
          paperType: true,
          quantity: true,
          isDoubleSided: true,
          isDoubleColor: true,
          remark: true,
          tasks: {
            where: { workerId: actor.id },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              status: true,
              machineType: true,
              plannedQty: true,
              completedQty: true,
              defectQty: true,
              reworkQty: true,
              boardCount: true,
              pressCount: true,
              pieceworkAmount: true,
              startedAt: true,
              completedAt: true,
              craft: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

export async function listWorkerSalaries(actor: WorkerActor) {
  requireWorkerActor(actor);
  return db.dailyWorkerSalary.findMany({
    where: { workerId: actor.id },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      date: true,
      machineType: true,
      baseSalary: true,
      totalPieceworkAmount: true,
      adjustmentAmount: true,
      actualSalary: true,
      taskCount: true,
      orderCount: true,
      isPaid: true,
      paidAt: true,
    },
  });
}

export async function getWorkerSalaryDetail(
  salaryId: string,
  actor: WorkerActor,
) {
  requireWorkerActor(actor);
  return db.dailyWorkerSalary.findFirst({
    // The workerId predicate is deliberately in the database query rather
    // than checked after reading, so another worker's salary never enters
    // process memory or the React render tree.
    where: { id: salaryId, workerId: actor.id },
    include: {
      items: {
        orderBy: [{ completedAt: 'asc' }, { orderNo: 'asc' }],
      },
      adjustments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          amount: true,
          reason: true,
          createdAt: true,
        },
      },
    },
  });
}
