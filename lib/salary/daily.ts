import Decimal from 'decimal.js';
import { Role, WorkerType } from '../../generated/prisma/enums';
import { parseStrictYmd } from '../auth/schemas';
import { db } from '../db';
import { DailySalaryError } from './daily-common';

// Legacy DailyWorkerSalary is a historical snapshot after the operation-ledger
// cutover. This module intentionally contains read helpers only: it cannot
// recompute, adjust or change payment state.
export { DailySalaryError, shanghaiDayRange } from './daily-common';

export async function listDailyWorkerSalaries(filter: {
  date?: string;
  workerId?: string;
  isPaid?: boolean;
}) {
  const where: {
    date?: Date;
    workerId?: string;
    isPaid?: boolean;
  } = {};
  if (filter.date) {
    const parsed = parseStrictYmd(filter.date);
    if (!parsed) {
      throw new DailySalaryError(
        `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${filter.date}`,
      );
    }
    where.date = parsed;
  }
  if (filter.workerId) where.workerId = filter.workerId;
  if (filter.isPaid !== undefined) where.isPaid = filter.isPaid;

  return db.dailyWorkerSalary.findMany({
    where,
    orderBy: [{ date: 'desc' }, { workerId: 'asc' }],
    select: {
      id: true,
      workerId: true,
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
      worker: { select: { displayName: true } },
    },
  });
}

/** Users shown in the legacy archive filter; no eligibility or pricing use. */
export async function listMachineWorkersForSalary() {
  return db.user.findMany({
    where: {
      OR: [
        { dailyWorkerSalaries: { some: {} } },
        {
          role: Role.WORKER,
          workerType: WorkerType.MACHINE,
          isActive: true,
        },
      ],
    },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, username: true },
  });
}

export async function getDailyWorkerSalaryDetail(id: string) {
  return db.dailyWorkerSalary.findUnique({
    where: { id },
    include: {
      worker: {
        select: {
          id: true,
          displayName: true,
          username: true,
          machineType: true,
        },
      },
      items: {
        orderBy: [{ completedAt: 'asc' }, { orderNo: 'asc' }],
      },
      adjustments: {
        orderBy: { createdAt: 'asc' },
        include: {
          createdBy: { select: { displayName: true, username: true } },
        },
      },
    },
  });
}

/**
 * Historical order-cost drill-down. It reads immutable legacy salary items and
 * is never combined with ProductionReport costs in this adapter.
 */
export async function getOrderPieceworkSummary(orderId: string) {
  const items = await db.dailyWorkerSalaryItem.findMany({
    where: { orderId },
    orderBy: { completedAt: 'asc' },
    select: {
      id: true,
      dailySalaryId: true,
      productionTaskId: true,
      orderItemName: true,
      craftName: true,
      completedQty: true,
      defectQty: true,
      reworkQty: true,
      boardCount: true,
      pressCount: true,
      pieceworkAmount: true,
      completedAt: true,
      dailySalary: {
        select: {
          date: true,
          worker: { select: { displayName: true } },
        },
      },
    },
  });
  const total = items.reduce(
    (sum, item) => sum.plus(new Decimal(item.pieceworkAmount)),
    new Decimal(0),
  );
  return { items, total: total.toFixed(2) };
}
