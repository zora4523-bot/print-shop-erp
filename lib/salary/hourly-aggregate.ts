import { paginatedResult, paginationWindow, parsePositiveInt } from '../admin/table';
import { WorkerType } from '../../generated/prisma/enums';
import { db } from '../db';
import { parseShanghaiMonth } from '../attendance';

// 历史打包时薪月结存档（只读）。打包已切换为工序计件，ERP 不再生成、重算或
// 标记发放任何时薪月结；这里只保留给管理员与打包师傅查阅旧记录的读路径。

export function getHourlyPayrollWorkerType(snapshot: unknown): WorkerType | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const value = (snapshot as Record<string, unknown>).workerType;
  return value === WorkerType.PACKER ? value : null;
}

export async function listHourlyPayrolls(filter: {
  month?: string;
  workerId?: string;
  isPaid?: boolean;
  page?: string | string[];
  pageSize?: string | string[];
}) {
  if (filter.month !== undefined) {
    // Validate month format early — same reason listDailyWorkerSalaries
    // validates date early .
    parseShanghaiMonth(filter.month);
  }
  const where = {
      ...(filter.month ? { month: filter.month } : {}),
      ...(filter.workerId ? { workerId: filter.workerId } : {}),
      ...(filter.isPaid !== undefined ? { isPaid: filter.isPaid } : {}),
  };
  const [total, sums, unpaidSums] = await Promise.all([
    db.hourlyWorkerPayroll.count({ where }),
    db.hourlyWorkerPayroll.aggregate({ where, _sum: { totalSalary: true } }),
    db.hourlyWorkerPayroll.aggregate({ where: { AND: [where, { isPaid: false }] }, _sum: { totalSalary: true } }),
  ]);
  const window = paginationWindow(total,
    parsePositiveInt(filter.page, { defaultValue: 1 }),
    parsePositiveInt(filter.pageSize, { defaultValue: 50, max: 100 }));
  const rows = await db.hourlyWorkerPayroll.findMany({
    take: window.take,
    skip: window.skip,
    where,
    orderBy: [{ month: 'desc' }, { workerId: 'asc' }],
    select: {
      id: true,
      workerId: true,
      month: true,
      totalWorkHours: true,
      totalOtHours: true,
      hourlyRate: true,
      otMultiplier: true,
      baseSalary: true,
      otSalary: true,
      totalSalary: true,
      isPaid: true,
      paidAt: true,
      salaryRuleSnapshot: true,
      worker: { select: { displayName: true } },
    },
  });
  const mapped = rows.map((row) => ({
    ...row,
    payrollWorkerType: getHourlyPayrollWorkerType(row.salaryRuleSnapshot),
  }));
  return { ...paginatedResult(mapped, total, window),
    totalSalary: String(sums._sum.totalSalary ?? 0),
    unpaidSalary: String(unpaidSums._sum.totalSalary ?? 0),
  };
}

/** Worker ids with an archived row in the month (filter options only). */
export async function listHourlyPayrollWorkerIds(month: string): Promise<string[]> {
  parseShanghaiMonth(month);
  const rows = await db.hourlyWorkerPayroll.findMany({
    where: { month },
    orderBy: { workerId: 'asc' },
    select: { workerId: true },
  });
  return rows.map((row) => row.workerId);
}
