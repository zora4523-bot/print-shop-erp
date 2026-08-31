import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { TaskStatus } from '../../generated/prisma/enums';
import { db } from '../db';
import {
  deriveProductionOperationPlan,
  type ProductionMaterializationIssue,
  type ProductionOperationSpec,
} from './operation-materializer';

const LEGACY_PREFLIGHT_SELECT = {
  id: true,
  orderNo: true,
  status: true,
  pricingStatus: true,
  settlementType: true,
  items: {
    select: {
      id: true,
      sequence: true,
      craft: true,
      quantity: true,
      frontFoilColors: true,
      backFoilColors: true,
      hasLocalFoil: true,
      tasks: {
        select: {
          id: true,
          status: true,
          workerId: true,
          workerType: true,
          machineType: true,
          completedQty: true,
          pieceworkAmount: true,
          dailySalaryItem: {
            select: {
              id: true,
              dailySalary: { select: { id: true, isPaid: true } },
            },
          },
        },
      },
    },
    orderBy: { sequence: 'asc' as const },
  },
  packagingGroups: {
    select: {
      id: true,
      sequence: true,
      actualBagCount: true,
      lines: {
        select: { orderItemId: true, unitsPerBag: true },
        orderBy: { orderItemId: 'asc' as const },
      },
    },
    orderBy: { sequence: 'asc' as const },
  },
  productionOperations: { select: { id: true } },
} satisfies Prisma.OrderSelect;

type LegacyPreflightOrder = Prisma.OrderGetPayload<{
  select: typeof LEGACY_PREFLIGHT_SELECT;
}>;

export type LegacyConversionBlockingIssue =
  | ProductionMaterializationIssue
  | {
      code:
        | 'MIXED_LEGACY_TERMINAL_STATE'
        | 'LEGACY_SALARY_ALREADY_CAPTURED'
        | 'ALREADY_HAS_OPERATIONS'
        | 'NO_ACTIVE_LEGACY_TASKS';
      path: string;
      message: string;
    };

export type LegacyOrderConversionPreflight = {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  activeTaskIds: string[];
  assignedActiveTaskCount: number;
  inProgressTaskCount: number;
  completedLegacyTaskCount: number;
  paidLegacyTaskCount: number;
  convertible: boolean;
  issues: LegacyConversionBlockingIssue[];
  /** Read-only deterministic conversion plan; never persisted by preflight. */
  proposedOperations: ProductionOperationSpec[];
};

export type LegacyOperationMigrationPreflight = {
  generatedAt: Date;
  scannedOrderCount: number;
  activeTaskCount: number;
  assignedActiveTaskCount: number;
  convertibleOrderCount: number;
  blockedOrderCount: number;
  orders: LegacyOrderConversionPreflight[];
};

type PreflightClient = Pick<PrismaClient, 'order'>;

function preflightOneOrder(
  order: LegacyPreflightOrder,
): LegacyOrderConversionPreflight {
  const tasks = order.items.flatMap((item) => item.tasks);
  const activeTasks = tasks.filter(
    (task) =>
      task.status === TaskStatus.PENDING ||
      task.status === TaskStatus.IN_PROGRESS,
  );
  const completedTasks = tasks.filter(
    (task) => task.status === TaskStatus.COMPLETED,
  );
  const paidTasks = tasks.filter(
    (task) => task.dailySalaryItem?.dailySalary.isPaid === true,
  );
  const issues: LegacyConversionBlockingIssue[] = [];

  const plan = deriveProductionOperationPlan({
    orderId: order.id,
    items: order.items,
    packagingGroups: order.packagingGroups,
  });
  if (!plan.ok) issues.push(...plan.issues);
  if (activeTasks.length === 0) {
    issues.push({
      code: 'NO_ACTIVE_LEGACY_TASKS',
      path: 'items.tasks',
      message: '本单没有非终态旧任务，不应进入在途转换集',
    });
  }
  if (completedTasks.length > 0) {
    issues.push({
      code: 'MIXED_LEGACY_TERMINAL_STATE',
      path: 'items.tasks',
      message:
        '同一工单同时存在已完成和未完成旧任务，无法在不重复计件的前提下自动合并',
    });
  }
  if (paidTasks.length > 0) {
    issues.push({
      code: 'LEGACY_SALARY_ALREADY_CAPTURED',
      path: 'items.tasks.dailySalaryItem',
      message: '在途工单已有发薪的旧任务，禁止套用新工价转换',
    });
  }
  if (order.productionOperations.length > 0) {
    issues.push({
      code: 'ALREADY_HAS_OPERATIONS',
      path: 'productionOperations',
      message: '工单已存在新工序，预检拒绝生成第二套转换计划',
    });
  }

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    orderStatus: order.status,
    activeTaskIds: activeTasks.map((task) => task.id).sort(),
    assignedActiveTaskCount: activeTasks.filter((task) => task.workerId !== null)
      .length,
    inProgressTaskCount: activeTasks.filter(
      (task) => task.status === TaskStatus.IN_PROGRESS,
    ).length,
    completedLegacyTaskCount: completedTasks.length,
    paidLegacyTaskCount: paidTasks.length,
    convertible: issues.length === 0,
    issues,
    proposedOperations: issues.length === 0 && plan.ok ? plan.specs : [],
  };
}

/**
 * Read-only cutover evidence. This function intentionally exposes no `apply`
 * flag and performs no writes; deployment must stop if even one order is
 * blocked, then run a separately reviewed conversion transaction.
 */
export async function preflightLegacyOperationConversion(
  client: PreflightClient = db,
  generatedAt: Date = new Date(),
): Promise<LegacyOperationMigrationPreflight> {
  const orders = await client.order.findMany({
    where: {
      items: {
        some: {
          tasks: {
            some: {
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
            },
          },
        },
      },
    },
    select: LEGACY_PREFLIGHT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const results = orders.map(preflightOneOrder);
  return {
    generatedAt,
    scannedOrderCount: results.length,
    activeTaskCount: results.reduce(
      (total, order) => total + order.activeTaskIds.length,
      0,
    ),
    assignedActiveTaskCount: results.reduce(
      (total, order) => total + order.assignedActiveTaskCount,
      0,
    ),
    convertibleOrderCount: results.filter((order) => order.convertible).length,
    blockedOrderCount: results.filter((order) => !order.convertible).length,
    orders: results,
  };
}
