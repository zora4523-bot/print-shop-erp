import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  Role,
  TaskStatus,
  WorkerType,
} from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findMany: vi.fn(), findFirst: vi.fn() },
    dailyWorkerSalary: { findMany: vi.fn(), findFirst: vi.fn() },
    hourlyWorkerPayroll: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getWorkerOrderDetail,
  getWorkerHourlyPayrollDetail,
  getWorkerSalaryDetail,
  listWorkerHourlyPayrolls,
  listWorkerOrders,
  listWorkerSalaries,
  WorkerPortalError,
} from '../worker-portal';

const worker = {
  id: 'worker-a',
  role: Role.WORKER,
  workerType: WorkerType.MACHINE,
};
const packer = {
  id: 'packer-a',
  role: Role.WORKER,
  workerType: WorkerType.PACKER,
};

beforeEach(() => {
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalary.findFirst.mockReset().mockResolvedValue(null);
  dbMock.hourlyWorkerPayroll.findMany.mockReset().mockResolvedValue([]);
  dbMock.hourlyWorkerPayroll.findFirst.mockReset().mockResolvedValue(null);
});

describe('worker order visibility', () => {
  it('filters both the order and every nested item/task by the session worker id', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNo: '20260719-0001',
        customName: null,
        status: OrderStatus.IN_PRODUCTION,
        isUrgent: false,
        customerRef: null,
        promisedDate: null,
        createdAt: new Date(),
        submitter: { displayName: '销售 A' },
        items: [
          {
            id: 'item-1',
            tasks: [
              { id: 'task-1', status: TaskStatus.COMPLETED, pieceworkAmount: '12' },
            ],
          },
        ],
      },
    ]);

    const result = await listWorkerOrders(worker);
    const query = dbMock.order.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      status: { not: OrderStatus.SUBMITTED },
      items: { some: { tasks: { some: { workerId: 'worker-a' } } } },
    });
    expect(query.select.items.where).toEqual({
      tasks: { some: { workerId: 'worker-a' } },
    });
    expect(query.select.items.select.tasks.where).toEqual({
      workerId: 'worker-a',
    });
    expect(result[0]).toMatchObject({
      taskCount: 1,
      completedTaskCount: 1,
      pieceworkAmount: '12.00',
    });
  });

  it('uses id + worker ownership in the detail query (other workers receive null/404)', async () => {
    await expect(getWorkerOrderDetail('order-other', worker)).resolves.toBeNull();
    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-other',
          status: { not: OrderStatus.SUBMITTED },
          items: { some: { tasks: { some: { workerId: 'worker-a' } } } },
        },
      }),
    );
    const detailQuery = dbMock.order.findFirst.mock.calls[0][0];
    expect(detailQuery.select.items.where).toEqual({
      tasks: { some: { workerId: 'worker-a' } },
    });
    expect(detailQuery.select.items.select.tasks.where).toEqual({
      workerId: 'worker-a',
    });
    expect(detailQuery.select.items.select.designs.where).toEqual({
      fileType: 'IMAGE',
    });
  });
});

describe('worker salary visibility', () => {
  it('lists daily salaries only for the current machine worker', async () => {
    await listWorkerSalaries(worker);
    expect(dbMock.dailyWorkerSalary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workerId: 'worker-a' } }),
    );
  });

  it('puts workerId in the salary detail database predicate', async () => {
    await expect(getWorkerSalaryDetail('salary-other', worker)).resolves.toBeNull();
    expect(dbMock.dailyWorkerSalary.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'salary-other', workerId: 'worker-a' },
      }),
    );
  });

  it.each([
    WorkerType.PACKER,
    WorkerType.CLEANER,
    WorkerType.COOK,
  ])('lists only the current %s worker monthly payrolls', async (workerType) => {
    await listWorkerHourlyPayrolls(
      { id: 'hourly-a', role: Role.WORKER, workerType },
      { fromMonth: '2026-01', toMonth: '2026-06' },
    );

    expect(dbMock.hourlyWorkerPayroll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workerId: 'hourly-a',
          month: { gte: '2026-01', lte: '2026-06' },
        },
      }),
    );
  });

  it('puts workerId in the hourly payroll detail database predicate', async () => {
    await expect(
      getWorkerHourlyPayrollDetail('payroll-other', packer),
    ).resolves.toBeNull();
    expect(dbMock.hourlyWorkerPayroll.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payroll-other', workerId: 'packer-a' },
      }),
    );
  });

  it('uses each owned payroll snapshot for historical worker-type display', async () => {
    dbMock.hourlyWorkerPayroll.findMany.mockResolvedValue([
      {
        id: 'payroll-1',
        salaryRuleSnapshot: { workerType: WorkerType.PACKER },
      },
    ]);
    dbMock.hourlyWorkerPayroll.findFirst.mockResolvedValue({
      id: 'payroll-1',
      salaryRuleSnapshot: { workerType: WorkerType.PACKER },
    });
    const currentCook = { ...packer, workerType: WorkerType.COOK };

    const list = await listWorkerHourlyPayrolls(currentCook);
    const detail = await getWorkerHourlyPayrollDetail(
      'payroll-1',
      currentCook,
    );

    expect(list[0].payrollWorkerType).toBe(WorkerType.PACKER);
    expect(detail?.payrollWorkerType).toBe(WorkerType.PACKER);
    expect(
      dbMock.hourlyWorkerPayroll.findMany.mock.calls[0][0].select
        .salaryRuleSnapshot,
    ).toBe(true);
    expect(
      dbMock.hourlyWorkerPayroll.findFirst.mock.calls[0][0].select
        .salaryRuleSnapshot,
    ).toBe(true);
  });

  it('keeps machine and hourly salary stores separated by worker type', async () => {
    await expect(listWorkerSalaries(packer)).rejects.toBeInstanceOf(
      WorkerPortalError,
    );
    await expect(listWorkerHourlyPayrolls(worker)).rejects.toBeInstanceOf(
      WorkerPortalError,
    );
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.findMany).not.toHaveBeenCalled();
  });

  it('rejects non-worker actors before querying any personal data', async () => {
    await expect(
      listWorkerSalaries({
        id: 'owner-1',
        role: Role.ADMIN,
        workerType: null,
      }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    await expect(
      listWorkerHourlyPayrolls({
        id: 'cs-1',
        role: Role.CUSTOMER_SERVICE,
        workerType: null,
      }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
    expect(dbMock.hourlyWorkerPayroll.findMany).not.toHaveBeenCalled();
  });
});
