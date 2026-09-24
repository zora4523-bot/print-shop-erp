import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerType } from '../../../generated/prisma/enums';

// 历史打包时薪月结存档只剩读路径：生成、重算、标记发放均已删除。
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    hourlyWorkerPayroll: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalSalary: null } }),
      findMany: vi.fn(),
    },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getHourlyPayrollWorkerType,
  listHourlyPayrolls,
  listHourlyPayrollWorkerIds,
} from '../hourly-aggregate';

beforeEach(() => {
  dbMock.hourlyWorkerPayroll.count.mockReset().mockResolvedValue(0);
  dbMock.hourlyWorkerPayroll.aggregate.mockReset().mockResolvedValue({ _sum: { totalSalary: null } });
  dbMock.hourlyWorkerPayroll.findMany.mockReset();
});

describe('getHourlyPayrollWorkerType', () => {
  it('only recognises the archived PACKER snapshot', () => {
    expect(getHourlyPayrollWorkerType({ workerType: WorkerType.PACKER })).toBe(WorkerType.PACKER);
    expect(getHourlyPayrollWorkerType({ workerType: WorkerType.MACHINE })).toBeNull();
    expect(getHourlyPayrollWorkerType({ workerType: 'UNKNOWN' })).toBeNull();
    expect(getHourlyPayrollWorkerType(null)).toBeNull();
    expect(getHourlyPayrollWorkerType([])).toBeNull();
  });
});

describe('listHourlyPayrollWorkerIds', () => {
  it('validates the month and lists archived workers of that month', async () => {
    await expect(listHourlyPayrollWorkerIds('2026/05')).rejects.toThrow(/月份格式非法/);
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([{ workerId: 'w1' }, { workerId: 'w2' }]);
    await expect(listHourlyPayrollWorkerIds('2026-05')).resolves.toEqual(['w1', 'w2']);
    expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenCalledWith({
      where: { month: '2026-05' },
      orderBy: { workerId: 'asc' },
      select: { workerId: true },
    });
  });
});

describe('listHourlyPayrolls', () => {
  it('validates month format early (Codex round 44 pattern)', async () => {
    await expect(
      listHourlyPayrolls({ month: '2026/05' }),
    ).rejects.toThrow(/月份格式非法/);
  });

  it('passes through filters when all valid', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
    await listHourlyPayrolls({
      month: '2026-05',
      workerId: 'worker-1',
      isPaid: false,
    });
    const where = dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      month: '2026-05',
      workerId: 'worker-1',
      isPaid: false,
    });
  });

  it('derives the historical display type from the payroll snapshot, not current User.workerType', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([
      {
        id: 'payroll-1',
        salaryRuleSnapshot: { workerType: WorkerType.PACKER },
        worker: { displayName: '已改岗员工' },
      },
    ]);

    const rows = await listHourlyPayrolls({});

    expect(rows.rows[0].payrollWorkerType).toBe(WorkerType.PACKER);
    expect(dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].select.worker)
      .toEqual({ select: { displayName: true } });
  });
});

describe('salary list pagination', () => {
  it.each([
    [undefined, undefined, 1, 50, 0],
    [['2', '9'], '20', 2, 20, 20],
    ['oops', '-2', 1, 1, 0],
    ['999', '999', 3, 100, 200],
  ])('parses page=%s pageSize=%s and bounds take/skip', async (page, pageSize, expectedPage, take, skip) => {
    dbMock.hourlyWorkerPayroll.count.mockResolvedValue(205);
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
    const result = await listHourlyPayrolls({ page, pageSize });
    expect(result).toMatchObject({ page: expectedPage, pageSize: take, total: 205 });
    expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take, skip }));
  });
});

it('keeps filtered owner totals independent of the visible page', async () => {
  dbMock.hourlyWorkerPayroll.count.mockResolvedValue(120);
  dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.aggregate
    .mockResolvedValueOnce({ _sum: { totalSalary: '1000.01' } })
    .mockResolvedValueOnce({ _sum: { totalSalary: null } });
  const result = await listHourlyPayrolls({ workerId: 'w1', isPaid: true, page: '2' });
  expect(result).toMatchObject({ total: 120, totalSalary: '1000.01', unpaidSalary: '0' });
  expect(dbMock.hourlyWorkerPayroll.aggregate).toHaveBeenNthCalledWith(1, { where: { workerId: 'w1', isPaid: true }, _sum: { totalSalary: true } });
  expect(dbMock.hourlyWorkerPayroll.aggregate).toHaveBeenNthCalledWith(2, { where: { AND: [{ workerId: 'w1', isPaid: true }, { isPaid: false }] }, _sum: { totalSalary: true } });
});
