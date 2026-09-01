import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderExportStatus, Role } from '../../../generated/prisma/enums';

const { dbMock, tx, auditMock } = vi.hoisted(() => {
  const transaction = {
    orderExport: { create: vi.fn(), update: vi.fn() },
    order: { findMany: vi.fn() },
    orderExportSelection: { createMany: vi.fn() },
  };
  return {
    tx: transaction,
    dbMock: {
      orderExport: { findUnique: vi.fn() },
      orderExportSelection: { findMany: vi.fn() },
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    },
    auditMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: auditMock }));
vi.mock('@/lib/background-jobs/repository', () => ({
  enqueueBackgroundJob: vi.fn(),
}));

import {
  InvalidOrderExportRequestError,
  requestOrderExport,
} from '../export';

const actor = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: Role.ADMIN,
};
const now = new Date('2026-09-02T08:00:00.000Z');

function exportRow() {
  return {
    id: 'export-1',
    requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
    createdById: actor.id,
    filters: { scope: 'selected', params: {}, filterHash: 'hash' },
    snapshotAt: now,
    schemaVersion: 3,
    status: OrderExportStatus.PENDING,
    backgroundJobId: null,
    matchedOrderCount: 0,
    rowCounts: null,
    artifactName: null,
    fileName: 'selected.xlsx',
    byteSize: null,
    expiresAt: new Date(now.getTime() + 86_400_000),
    downloadCount: 0,
    lastErrorCode: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.orderExport.findUnique.mockResolvedValue(null);
  dbMock.orderExportSelection.findMany.mockResolvedValue([]);
  tx.orderExport.create.mockResolvedValue(exportRow());
  tx.order.findMany.mockResolvedValue([
    { id: 'order-b' },
    { id: 'order-a' },
  ]);
  tx.orderExportSelection.createMany.mockResolvedValue({ count: 2 });
  auditMock.mockResolvedValue(undefined);
});

describe('selected order export request', () => {
  it('persists exact ordered membership instead of hiding ids in filters JSON', async () => {
    await requestOrderExport({
      actor,
      requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
      scope: 'selected',
      params: { q: '不应保存' },
      selectedOrderIds: ['order-a', 'order-b'],
      durable: false,
      now,
    });
    expect(tx.orderExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filters: expect.objectContaining({ scope: 'selected', params: {} }),
      }),
    });
    expect(tx.orderExportSelection.createMany).toHaveBeenCalledWith({
      data: [
        { exportId: 'export-1', orderId: 'order-a', sequence: 0 },
        { exportId: 'export-1', orderId: 'order-b', sequence: 1 },
      ],
    });
  });

  it('rejects duplicate membership before opening a transaction', async () => {
    await expect(
      requestOrderExport({
        actor,
        requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
        scope: 'selected',
        params: {},
        selectedOrderIds: ['order-a', 'order-a'],
        durable: false,
        now,
      }),
    ).rejects.toBeInstanceOf(InvalidOrderExportRequestError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed when any selected order is missing at authorization time', async () => {
    tx.order.findMany.mockResolvedValueOnce([{ id: 'order-a' }]);
    await expect(
      requestOrderExport({
        actor,
        requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
        scope: 'selected',
        params: {},
        selectedOrderIds: ['order-a', 'order-b'],
        durable: false,
        now,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('无权导出'),
    });
    expect(tx.orderExportSelection.createMany).not.toHaveBeenCalled();
  });

  it('replays only when the request key has the exact ordered membership', async () => {
    dbMock.orderExport.findUnique.mockResolvedValueOnce(exportRow());
    dbMock.orderExportSelection.findMany.mockResolvedValueOnce([
      { orderId: 'order-a' },
      { orderId: 'order-b' },
    ]);

    await expect(
      requestOrderExport({
        actor,
        requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
        scope: 'selected',
        params: {},
        selectedOrderIds: ['order-a', 'order-b'],
        durable: false,
        now,
      }),
    ).resolves.toMatchObject({ id: 'export-1', scope: 'selected' });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects request-key reuse with a different selected membership', async () => {
    dbMock.orderExport.findUnique.mockResolvedValueOnce(exportRow());
    dbMock.orderExportSelection.findMany.mockResolvedValueOnce([
      { orderId: 'order-a' },
      { orderId: 'order-b' },
    ]);

    await expect(
      requestOrderExport({
        actor,
        requestKey: '01234567-89ab-4cde-8fab-0123456789ab',
        scope: 'selected',
        params: {},
        selectedOrderIds: ['order-b', 'order-a'],
        durable: false,
        now,
      }),
    ).rejects.toMatchObject({
      message: '同一请求标识不能更换所选工单',
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
