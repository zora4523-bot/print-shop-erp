import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderChangeRequestStatus } from '@/generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    orderChangeRequest: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('server-only', () => ({}));

import {
  listPendingOrderChangeRequests,
  PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE,
} from '../change-request-list';

beforeEach(() => {
  dbMock.orderChangeRequest.count.mockReset();
  dbMock.orderChangeRequest.findMany.mockReset();
});

describe('listPendingOrderChangeRequests', () => {
  it('counts and pages only pending requests at the database', async () => {
    dbMock.orderChangeRequest.count.mockResolvedValue(45);
    dbMock.orderChangeRequest.findMany.mockResolvedValue([]);

    const result = await listPendingOrderChangeRequests({
      page: 3,
      pageSize: 20,
    });

    const where = { status: OrderChangeRequestStatus.PENDING };
    expect(dbMock.orderChangeRequest.count).toHaveBeenCalledWith({ where });
    expect(dbMock.orderChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 40,
        take: 20,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(result).toMatchObject({
      total: 45,
      page: 3,
      pageSize: 20,
      pageCount: 3,
    });
  });

  it('selects every business and work-order version needed by the queue', async () => {
    dbMock.orderChangeRequest.count.mockResolvedValue(1);
    dbMock.orderChangeRequest.findMany.mockResolvedValue([]);

    await listPendingOrderChangeRequests();

    const query = dbMock.orderChangeRequest.findMany.mock.calls[0]![0];
    expect(query.select).toMatchObject({
      baseRevision: true,
      baseWorkOrderVersion: true,
      workOrderVersionAfter: true,
      type: true,
      proposedChanges: true,
      order: {
        select: {
          revision: true,
          workOrderVersion: true,
        },
      },
    });
  });

  it('clamps an out-of-range page before querying rows', async () => {
    dbMock.orderChangeRequest.count.mockResolvedValue(21);
    dbMock.orderChangeRequest.findMany.mockResolvedValue([]);

    const result = await listPendingOrderChangeRequests({
      page: 999,
      pageSize: PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE,
    });

    expect(dbMock.orderChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(result).toMatchObject({ page: 2, pageCount: 2, total: 21 });
  });

  it('normalizes invalid pagination and caps page size', async () => {
    dbMock.orderChangeRequest.count.mockResolvedValue(0);
    dbMock.orderChangeRequest.findMany.mockResolvedValue([]);

    const result = await listPendingOrderChangeRequests({
      page: Number.NaN,
      pageSize: 1000,
    });

    expect(dbMock.orderChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );
    expect(result).toMatchObject({
      page: 1,
      pageSize: 100,
      pageCount: 1,
      total: 0,
    });
  });
});
