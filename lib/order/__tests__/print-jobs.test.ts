import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderPrintJobState,
  OrderPrintKind,
  OrderStatus,
  Role,
} from '../../../generated/prisma/enums';

const { dbMock, databaseClockNowMock } = vi.hoisted(() => ({
  dbMock: { $transaction: vi.fn(), orderPrintJob: { findUnique: vi.fn() } },
  databaseClockNowMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseClockNowMock,
}));

import {
  createNextOrderPrintRequest,
  createOrderPrintRequestInTx,
  markOrderPrintRequestPrinted,
  markOrderPrintRequestPrintedInTx,
  OrderPrintJobError,
  supersedeOlderOrderPrintRequestsInTx,
} from '../print-jobs';

const admin = { id: 'admin-1', role: Role.ADMIN };
const printedAt = new Date('2026-09-02T05:00:00.000Z');

function txMock() {
  return {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn() },
    orderPrintJob: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    orderLog: { create: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseClockNowMock.mockResolvedValue(printedAt);
});

describe('versioned order print jobs', () => {
  it('derives REPRINT from same-version printed history under the order lock', async () => {
    const tx = txMock();
    dbMock.$transaction.mockImplementationOnce(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.orderPrintJob.findFirst
      .mockResolvedValueOnce({ id: 'printed-receipt-v1' })
      .mockResolvedValueOnce(null);
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.FOILING,
      workOrderVersion: 1,
    });
    tx.orderPrintJob.create.mockResolvedValue({ id: 'reprint-request-v1' });

    await expect(
      createNextOrderPrintRequest(
        {
          orderId: 'order-1',
          workOrderVersion: 1,
          reason: '管理端批量创建打印任务',
          idempotencyKey: 'batch-print-order-1-v1-again',
        },
        admin,
      ),
    ).resolves.toMatchObject({ jobId: 'reprint-request-v1' });

    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.orderPrintJob.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        orderId: 'order-1',
        workOrderVersion: 1,
        state: OrderPrintJobState.PRINTED,
      },
      select: { id: true },
    });
    expect(tx.orderPrintJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderVersion: 1,
        printKind: OrderPrintKind.REPRINT,
      }),
      select: { id: true },
    });
  });

  it('derives INITIAL for a higher version with no printed history', async () => {
    const tx = txMock();
    dbMock.$transaction.mockImplementationOnce(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.orderPrintJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.RELEASED,
      workOrderVersion: 7,
    });
    tx.orderPrintJob.create.mockResolvedValue({ id: 'initial-request-v7' });

    await createNextOrderPrintRequest(
      {
        orderId: 'order-1',
        workOrderVersion: 7,
        reason: '管理端批量创建打印任务',
        idempotencyKey: 'batch-print-order-1-v7-first',
      },
      admin,
    );

    expect(tx.orderPrintJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderVersion: 7,
        printKind: OrderPrintKind.INITIAL,
      }),
      select: { id: true },
    });
  });

  it('creates one unresolved current-version request under the caller lock', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique.mockResolvedValue(null);
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.RELEASED,
      workOrderVersion: 3,
    });
    tx.orderPrintJob.findFirst.mockResolvedValue(null);
    tx.orderPrintJob.create.mockResolvedValue({ id: 'print-request-1' });
    await expect(
      createOrderPrintRequestInTx(
        tx as never,
        {
          orderId: 'order-1',
          workOrderVersion: 3,
          printKind: OrderPrintKind.INITIAL,
          reason: '首次下发',
          idempotencyKey: 'print-order-1-v3-initial',
        },
        admin,
      ),
    ).resolves.toEqual({ jobId: 'print-request-1', idempotentReplay: false });
    expect(tx.orderPrintJob.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        workOrderVersion: 3,
        state: OrderPrintJobState.PENDING,
        resolution: { is: null },
      },
      select: { id: true, printKind: true, reason: true },
    });
  });

  it('allows a same-version reprint after the prior request was resolved', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique.mockResolvedValue(null);
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.FOILING,
      workOrderVersion: 3,
    });
    // The query explicitly excludes resolved requests, so PostgreSQL returns
    // null even though append-only history still contains the original row.
    tx.orderPrintJob.findFirst.mockResolvedValue(null);
    tx.orderPrintJob.create.mockResolvedValue({ id: 'reprint-request-1' });
    await expect(
      createOrderPrintRequestInTx(
        tx as never,
        {
          orderId: 'order-1',
          workOrderVersion: 3,
          printKind: OrderPrintKind.REPRINT,
          reason: '纸张损坏重打',
          idempotencyKey: 'print-order-1-v3-reprint-2',
        },
        admin,
      ),
    ).resolves.toMatchObject({ jobId: 'reprint-request-1' });
  });

  it('does not report a new idempotency key as successful when a request is already pending', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique.mockResolvedValue(null);
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.RELEASED,
      workOrderVersion: 3,
    });
    tx.orderPrintJob.findFirst.mockResolvedValue({
      id: 'pending-existing',
      printKind: OrderPrintKind.INITIAL,
      reason: '首次下发',
    });

    await expect(
      createOrderPrintRequestInTx(
        tx as never,
        {
          orderId: 'order-1',
          workOrderVersion: 3,
          printKind: OrderPrintKind.REPRINT,
          reason: '重新打印',
          idempotencyKey: 'brand-new-request-key',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_REQUEST_ALREADY_PENDING' });
    expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
    expect(tx.orderLog.create).not.toHaveBeenCalled();
  });

  it('rejects printing an old work-order version', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'request-old',
        orderId: 'order-1',
        workOrderVersion: 2,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
        state: OrderPrintJobState.PENDING,
        resolution: null,
        order: { workOrderVersion: 3 },
      });
    await expect(
      markOrderPrintRequestPrintedInTx(
        tx as never,
        {
          requestJobId: 'request-old',
          idempotencyKey: 'printed-request-old-v2',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'VERSION_STALE' });
    expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
  });

  it('records a printed acknowledgement as a second immutable row', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'request-1',
        orderId: 'order-1',
        workOrderVersion: 3,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
        state: OrderPrintJobState.PENDING,
        resolution: null,
        order: { workOrderVersion: 3 },
      });
    tx.orderPrintJob.create.mockResolvedValue({ id: 'receipt-1' });
    await expect(
      markOrderPrintRequestPrintedInTx(
        tx as never,
        {
          requestJobId: 'request-1',
          idempotencyKey: 'printed-request-1-v3',
        },
        admin,
      ),
    ).resolves.toEqual({
      receiptId: 'receipt-1',
      orderId: 'order-1',
      idempotentReplay: false,
    });
    expect(tx.orderPrintJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        state: OrderPrintJobState.PRINTED,
        requestJobId: 'request-1',
        printedAt,
        printedById: admin.id,
      }),
      select: { id: true },
    });
  });

  it('rejects an unused key after the print request already has a resolution', async () => {
    const tx = txMock();
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'request-1',
        orderId: 'order-1',
        workOrderVersion: 3,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
        state: OrderPrintJobState.PENDING,
        resolution: { id: 'receipt-existing', printedById: admin.id },
        order: { workOrderVersion: 3 },
      });

    await expect(
      markOrderPrintRequestPrintedInTx(
        tx as never,
        {
          requestJobId: 'request-1',
          idempotencyKey: 'unused-print-confirm-key',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
    expect(tx.orderLog.create).not.toHaveBeenCalled();
  });

  it('版本升级以 SUPERSEDED 关系行闭合所有旧版未解决请求', async () => {
    const tx = txMock();
    tx.orderPrintJob.findMany.mockResolvedValue([
      {
        id: 'request-v2',
        orderId: 'order-1',
        workOrderVersion: 2,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
      },
      {
        id: 'request-v3',
        orderId: 'order-1',
        workOrderVersion: 3,
        printKind: OrderPrintKind.REPRINT,
        reason: '上次改单',
      },
    ]);
    tx.orderPrintJob.create.mockResolvedValue({ id: 'resolution' });

    await expect(
      supersedeOlderOrderPrintRequestsInTx(
        tx as never,
        {
          orderId: 'order-1',
          currentWorkOrderVersion: 4,
          reasonKey: 'x'.repeat(128),
        },
        admin,
      ),
    ).resolves.toEqual({ requestJobIds: ['request-v2', 'request-v3'] });

    expect(tx.orderPrintJob.findMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        workOrderVersion: { lt: 4 },
        state: OrderPrintJobState.PENDING,
        requestJobId: null,
        resolution: { is: null },
      },
      orderBy: [
        { workOrderVersion: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        orderId: true,
        workOrderVersion: true,
        printKind: true,
        reason: true,
      },
    });
    expect(tx.orderPrintJob.create).toHaveBeenNthCalledWith(1, {
      data: {
        orderId: 'order-1',
        workOrderVersion: 2,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
        state: OrderPrintJobState.SUPERSEDED,
        requestJobId: 'request-v2',
        idempotencyKey: expect.stringMatching(/^supersede:[a-f0-9]{64}$/),
        createdById: admin.id,
      },
      select: { id: true },
    });
    expect(tx.orderPrintJob.create).toHaveBeenCalledTimes(2);
    const keys = tx.orderPrintJob.create.mock.calls.map(
      (call) => call[0].data.idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((key) => key.length <= 128)).toBe(true);
    expect(tx.orderLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORDER_PRINT_REQUESTS_SUPERSEDED',
        changedFields: expect.objectContaining({
          requestJobIds: ['request-v2', 'request-v3'],
        }),
      }),
    });
  });

  it('locks the owning order before the public print confirmation', async () => {
    const tx = txMock();
    dbMock.$transaction.mockImplementationOnce(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.orderPrintJob.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'request-1',
        orderId: 'order-1',
        workOrderVersion: 3,
        printKind: OrderPrintKind.INITIAL,
        reason: '首次下发',
        state: OrderPrintJobState.PENDING,
        resolution: null,
        order: { workOrderVersion: 3 },
      });
    tx.orderPrintJob.create.mockResolvedValue({ id: 'receipt-1' });
    await markOrderPrintRequestPrinted(
      {
        requestJobId: 'request-1',
        idempotencyKey: 'printed-request-1-v3',
      },
      admin,
    );
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const sql = (tx.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(
      '?',
    );
    expect(sql).toContain('pg_advisory_xact_lock');
  });

  it('rejects non-admin print writers', async () => {
    const tx = txMock();
    await expect(
      createOrderPrintRequestInTx(
        tx as never,
        {
          orderId: 'order-1',
          workOrderVersion: 1,
          printKind: OrderPrintKind.INITIAL,
          reason: '首次下发',
          idempotencyKey: 'print-order-1-v1-initial',
        },
        { id: 'sales-1', role: Role.SALES },
      ),
    ).rejects.toBeInstanceOf(OrderPrintJobError);
  });
});
