import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role, TaskStatus } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findMany: vi.fn(), findFirst: vi.fn() },
    dailyWorkerSalary: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getWorkerOrderDetail,
  getWorkerSalaryDetail,
  listWorkerOrders,
  listWorkerSalaries,
  WorkerPortalError,
} from '../worker-portal';

const worker = { id: 'worker-a', role: Role.WORKER };

beforeEach(() => {
  dbMock.order.findMany.mockReset().mockResolvedValue([]);
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.dailyWorkerSalary.findMany.mockReset().mockResolvedValue([]);
  dbMock.dailyWorkerSalary.findFirst.mockReset().mockResolvedValue(null);
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
  it('lists only the current worker salaries', async () => {
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

  it('rejects non-worker actors before querying any personal data', async () => {
    await expect(
      listWorkerSalaries({ id: 'owner-1', role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(WorkerPortalError);
    expect(dbMock.dailyWorkerSalary.findMany).not.toHaveBeenCalled();
  });
});
