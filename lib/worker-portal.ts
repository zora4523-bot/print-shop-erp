import Decimal from 'decimal.js';
import type { Prisma } from '../generated/prisma/client';
import {
  DesignFileType,
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  WorkerType,
} from '../generated/prisma/enums';
import { paginatedResult, paginationWindow } from './admin/table';
import { db } from './db';
import { getReporterOperationTypeOrNull } from './production/operation-portal';
import { getHourlyPayrollWorkerType } from './salary/hourly-aggregate';
import {
  getPieceworkSettlementDetail,
  listWorkerPieceworkSettlements,
} from './salary/piecework-settlement';

// 师傅端 H5 一屏能承受的卡片数。取值与 lib/order/list-query.ts 的
// ORDER_LIST_DEFAULT_PAGE_SIZE 一致，两端口径对齐。
export const WORKER_ORDER_PAGE_SIZE = 20;

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

function requireOperationSalaryActor(actor: WorkerSalaryActor): void {
  requireWorkerActor(actor);
  if (
    actor.workerType !== WorkerType.MACHINE &&
    actor.workerType !== WorkerType.PACKER
  ) {
    throw new WorkerPortalError('仅烫金师傅或打包员可访问工序计件结算');
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

// 新工单按账号固定工序 lane 可见，不建立人员与工单的绑定关系。
function operationOrderWhere(
  operationType: PieceworkOperationType | null,
): Prisma.OrderWhereInput {
  return {
    status: { not: OrderStatus.SUBMITTED },
    OR: [
      ...(operationType
        ? [{ productionOperations: { some: { operationType } } }]
        : []),
      { productionProgressSteps: { some: {} } },
    ],
  };
}

export async function listWorkerOrders(
  actor: WorkerActor,
  options?: { page?: number },
) {
  requireWorkerActor(actor);
  const operationType = await getReporterOperationTypeOrNull(actor);
  // 计数与取行必须共用同一个 where，否则页码会指向不存在的行。
  const where = operationOrderWhere(operationType);
  const total = await db.order.count({ where });
  const window = paginationWindow(
    total,
    options?.page ?? 1,
    WORKER_ORDER_PAGE_SIZE,
  );

  const orders = await db.order.findMany({
    where,
    // 最新的工单排最前。这个页面是归档/查询视图，不是待办队列。急单只
    // 作为徽标呈现：如果继续把
    // isUrgent 当第一排序键，老员工的历史急单会长期霸占第一页，今天的新单
    // 反而翻不到。id 是稳定 tiebreaker，既保证翻页不重不漏，也命中 Order
    // 上已有的 @@index([createdAt(sort: Desc), id(sort: Desc)])。
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: window.skip,
    take: window.take,
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
      productionOperations: {
        where: {
          operationType: operationType ?? { in: [] },
        },
        select: {
          id: true,
          status: true,
          reports: {
            where: { reporterId: actor.id },
            select: {
              amount: true,
            },
          },
        },
      },
      productionProgressSteps: {
        select: { id: true, status: true },
      },
    },
  });

  return paginatedResult(
    orders.map((order) => {
      const operations = order.productionOperations;
      const progressSteps = order.productionProgressSteps;
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
        operationCount: operations.length + progressSteps.length,
        completedOperationCount:
          operations.filter(
            (operation) =>
              operation.status === ProductionOperationStatus.COMPLETED,
          ).length +
          progressSteps.filter(
            (step) => step.status === ProductionOperationStatus.COMPLETED,
          ).length,
        pieceworkAmount: operations
          .flatMap((operation) => operation.reports)
          .reduce(
            (sum, report) =>
              sum.plus(new Decimal(report.amount as Decimal.Value)),
            new Decimal(0),
          )
          .toFixed(2),
      };
    }),
    total,
    window,
  );
}

export async function getWorkerOrderDetail(
  orderId: string,
  actor: WorkerActor,
) {
  requireWorkerActor(actor);
  const operationType = await getReporterOperationTypeOrNull(actor);
  return db.order.findFirst({
    where: { id: orderId, ...operationOrderWhere(operationType) },
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
        },
      },
      productionOperations: {
        where: {
          operationType: operationType ?? { in: [] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          operationType: true,
          unit: true,
          status: true,
          plannedQty: true,
          sources: {
            orderBy: { createdAt: 'asc' },
            select: {
              sourceQty: true,
              orderItemId: true,
              packagingGroupId: true,
            },
          },
          reports: {
            select: {
              reporterId: true,
              reportedCompletedQty: true,
              defectQty: true,
              reworkQty: true,
              amount: true,
              reportedAt: true,
            },
          },
        },
      },
      productionProgressSteps: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          craftCode: true,
          craftName: true,
          status: true,
          plannedQty: true,
          orderItemId: true,
          orderItem: {
            select: { sequence: true, name: true },
          },
          reports: {
            select: {
              reporterId: true,
              completedQty: true,
              defectQty: true,
              reworkQty: true,
              reportedAt: true,
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

export async function listWorkerPieceworkSettlementsForPortal(
  actor: WorkerSalaryActor,
  filters?: { from?: Date; to?: Date },
) {
  requireOperationSalaryActor(actor);
  return listWorkerPieceworkSettlements({
    reporterId: actor.id,
    from: filters?.from,
    to: filters?.to,
  });
}

export async function getWorkerPieceworkSettlementDetail(
  settlementId: string,
  actor: WorkerSalaryActor,
) {
  requireOperationSalaryActor(actor);
  return getPieceworkSettlementDetail(settlementId, actor.id);
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
