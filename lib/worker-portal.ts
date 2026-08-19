import Decimal from 'decimal.js';
import {
  DesignFileType,
  OrderStatus,
  Role,
  TaskStatus,
  WorkerType,
} from '../generated/prisma/enums';
import { db } from './db';
import { getHourlyPayrollWorkerType } from './salary/hourly-aggregate';

export type WorkerActor = { id: string; role: Role };

export type WorkerSalaryActor = WorkerActor & {
  workerType: WorkerType | null;
};

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

function requireMachineSalaryActor(actor: WorkerSalaryActor): void {
  requireWorkerActor(actor);
  if (actor.workerType !== WorkerType.MACHINE) {
    throw new WorkerPortalError('仅开机师傅可访问计件日薪');
  }
}

function requireHourlySalaryActor(actor: WorkerSalaryActor): void {
  requireWorkerActor(actor);
  if (
    actor.workerType !== WorkerType.PACKER &&
    actor.workerType !== WorkerType.CLEANER &&
    actor.workerType !== WorkerType.COOK
  ) {
    throw new WorkerPortalError('仅打包、清废或厨师账号可访问时薪月结');
  }
}

// 师傅工单的唯一可见性定义：工单中至少一个 ProductionTask.workerId
// 等于当前登录用户。列表与详情复用同一形状，避免页面层漏加归属条件。
function ownOrderWhere(workerId: string) {
  return {
    status: { not: OrderStatus.SUBMITTED },
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
    orderBy: [{ isUrgent: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      orderNo: true,
      customName: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      createdAt: true,
      submitter: { select: { displayName: true } },
      items: {
        where: { tasks: { some: { workerId: actor.id } } },
        select: {
          id: true,
          tasks: {
            where: { workerId: actor.id },
            select: {
              id: true,
              status: true,
              workerType: true,
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
      customName: order.customName,
      status: order.status,
      isUrgent: order.isUrgent,
      customerRef: order.customerRef,
      promisedDate: order.promisedDate,
      createdAt: order.createdAt,
      submitterName: order.submitter?.displayName ?? '未记录',
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
      hasPieceworkTasks: tasks.some(
        (task) => task.workerType === WorkerType.MACHINE,
      ),
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
      customName: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      packageRequirement: true,
      remark: true,
      createdAt: true,
      submitter: { select: { displayName: true } },
      items: {
        where: { tasks: { some: { workerId: actor.id } } },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          specification: true,
          paperType: true,
          foilColors: true,
          quantity: true,
          isDoubleSided: true,
          isDoubleColor: true,
          remark: true,
          designs: {
            where: { fileType: DesignFileType.IMAGE },
            orderBy: { uploadedAt: 'asc' },
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
            },
          },
          tasks: {
            where: { workerId: actor.id },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              status: true,
              workerType: true,
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

export async function listWorkerSalaries(
  actor: WorkerSalaryActor,
  filters?: { from?: Date; to?: Date },
) {
  requireMachineSalaryActor(actor);
  return db.dailyWorkerSalary.findMany({
    where: {
      workerId: actor.id,
      date:
        filters?.from || filters?.to
          ? {
              gte: filters.from,
              lte: filters.to,
            }
          : undefined,
    },
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
  actor: WorkerSalaryActor,
) {
  requireMachineSalaryActor(actor);
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

export async function listWorkerHourlyPayrolls(
  actor: WorkerSalaryActor,
  filters?: { fromMonth?: string; toMonth?: string },
) {
  requireHourlySalaryActor(actor);
  const monthFilter =
    filters?.fromMonth || filters?.toMonth
      ? {
          gte: filters.fromMonth,
          lte: filters.toMonth,
        }
      : undefined;

  const rows = await db.hourlyWorkerPayroll.findMany({
    where: {
      workerId: actor.id,
      month: monthFilter,
    },
    orderBy: { month: 'desc' },
    select: {
      id: true,
      month: true,
      totalWorkHours: true,
      totalOtHours: true,
      totalSpareHours: true,
      hourlyRate: true,
      otMultiplier: true,
      baseSalary: true,
      otSalary: true,
      spareSalary: true,
      totalSalary: true,
      salaryRuleSnapshot: true,
      isPaid: true,
      paidAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    payrollWorkerType: getHourlyPayrollWorkerType(row.salaryRuleSnapshot),
  }));
}

export async function getWorkerHourlyPayrollDetail(
  payrollId: string,
  actor: WorkerSalaryActor,
) {
  requireHourlySalaryActor(actor);
  const row = await db.hourlyWorkerPayroll.findFirst({
    // Keep ownership in the database predicate. A guessed payroll id from
    // another worker must be indistinguishable from a missing record.
    where: { id: payrollId, workerId: actor.id },
    select: {
      id: true,
      month: true,
      totalWorkHours: true,
      totalOtHours: true,
      totalSpareHours: true,
      hourlyRate: true,
      otMultiplier: true,
      baseSalary: true,
      otSalary: true,
      spareSalary: true,
      totalSalary: true,
      dailyDetail: true,
      salaryRuleSnapshot: true,
      isPaid: true,
      paidAt: true,
    },
  });
  return row
    ? {
        ...row,
        payrollWorkerType: getHourlyPayrollWorkerType(
          row.salaryRuleSnapshot,
        ),
      }
    : null;
}
