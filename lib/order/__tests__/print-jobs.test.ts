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
  recordRenderedPrintInTx,
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
    orderWorkflowDecision: { findFirst: vi.fn() },
    orderPrintAttempt: { findUnique: vi.fn(), create: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseClockNowMock.mockResolvedValue(printedAt);
});

describe('versioned order print jobs', () => {
  it.each([OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING])(
    'queues the approved new version while paused from %s', async (fromStatus) => {
      const tx = txMock();
      tx.order.findUnique.mockResolvedValue({ id: 'order-1', status: OrderStatus.ON_HOLD, workOrderVersion: 2 });
      tx.orderWorkflowDecision.findFirst.mockResolvedValue({ fromStatus });
      tx.orderPrintJob.create.mockResolvedValue({ id: 'paused-reprint' });

      await expect(createOrderPrintRequestInTx(tx as never, {
        orderId: 'order-1', workOrderVersion: 2, printKind: OrderPrintKind.REPRINT,
        reason: '修改批准后重打', idempotencyKey: 'paused-approved-v2',
      }, admin)).resolves.toMatchObject({ jobId: 'paused-reprint' });
      expect(tx.orderPrintJob.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ printKind: OrderPrintKind.REPRINT, workOrderVersion: 2 }),
      }));
    },
  );

  it.each([
    { fromStatus: OrderStatus.CONFIRMED, printKind: OrderPrintKind.REPRINT },
    { fromStatus: null, printKind: OrderPrintKind.REPRINT },
    { fromStatus: OrderStatus.FOILING, printKind: OrderPrintKind.INITIAL },
  ])('does not bypass release or pause evidence: %j', async ({ fromStatus, printKind }) => {
    const tx = txMock();
    tx.order.findUnique.mockResolvedValue({ id: 'order-1', status: OrderStatus.ON_HOLD, workOrderVersion: 2 });
    tx.orderWorkflowDecision.findFirst.mockResolvedValue(fromStatus ? { fromStatus } : null);

    await expect(createOrderPrintRequestInTx(tx as never, {
      orderId: 'order-1', workOrderVersion: 2, printKind,
      reason: '暂停中请求打印', idempotencyKey: 'paused-invalid-v2',
    }, admin)).rejects.toMatchObject({ code: 'ORDER_NOT_PRINTABLE' });
    expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
  });

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
        order: { workOrderVersion: 3, status: OrderStatus.RELEASED },
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
        order: { workOrderVersion: 3, status: OrderStatus.RELEASED },
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

  it.each([OrderStatus.CANCELLED, OrderStatus.SHIPPED, OrderStatus.SETTLED])(
    '%s 工单不能再确认已打印，不写收据或日志',
    async (status) => {
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
          order: { workOrderVersion: 3, status },
        });
      tx.orderPrintJob.create.mockResolvedValue({ id: 'receipt-1' });

      await expect(
        markOrderPrintRequestPrintedInTx(
          tx as never,
          { requestJobId: 'request-1', idempotencyKey: 'printed-request-1-v3' },
          admin,
        ),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_PRINTABLE' });
      expect(tx.orderPrintJob.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
        select: expect.objectContaining({
          order: { select: { workOrderVersion: true, status: true } },
        }),
      }));
      expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
      expect(tx.orderLog.create).not.toHaveBeenCalled();
    },
  );

  it.each([OrderStatus.PACKING, OrderStatus.ON_HOLD])(
    '%s 工单仍可确认当前版待打印任务',
    async (status) => {
      const tx = txMock();
      tx.orderPrintJob.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'request-1',
          orderId: 'order-1',
          workOrderVersion: 3,
          printKind: OrderPrintKind.REPRINT,
          reason: '修改申请批准，旧版纸质工单作废',
          state: OrderPrintJobState.PENDING,
          resolution: null,
          order: { workOrderVersion: 3, status },
        });
      tx.orderPrintJob.create.mockResolvedValue({ id: 'receipt-1' });

      await expect(
        markOrderPrintRequestPrintedInTx(
          tx as never,
          { requestJobId: 'request-1', idempotencyKey: 'printed-request-1-v3' },
          admin,
        ),
      ).resolves.toMatchObject({ receiptId: 'receipt-1' });
    },
  );

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
        order: { workOrderVersion: 3, status: OrderStatus.RELEASED },
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

  // 业主 2026-10-02：点「打印」即记已打印。打印页关闭对话框 / 打开或下载批量打印文件时调用；
  // 每次打印尝试的结果写入账本，纸上内容由调用方在锁内比较。
  describe('recordRenderedPrintInTx', () => {
    const attempt = { orderId: 'order-1', workOrderVersion: 3, attemptKey: 'print-page:attempt-1' };
    const current = { id: 'order-1', status: OrderStatus.RELEASED, workOrderVersion: 3 };
    const pendingRequest = (id: string) => ({
      id, orderId: 'order-1', workOrderVersion: 3, printKind: OrderPrintKind.INITIAL, reason: '工单首次下发',
      state: OrderPrintJobState.PENDING, resolution: null, order: { workOrderVersion: 3, status: OrderStatus.RELEASED },
    });
    const sameContent = () => vi.fn(async () => true);
    const ledgerEntry = (tx: ReturnType<typeof txMock>) => tx.orderPrintAttempt.create.mock.calls[0]?.[0]?.data;

    it('locks first, compares the content under the lock, records the pending request and books the attempt', async () => {
      const tx = txMock();
      const contentIsCurrent = sameContent();
      tx.orderPrintAttempt.findUnique.mockResolvedValue(null);
      tx.orderPrintJob.findUnique
        .mockResolvedValueOnce(null) // receipt key inside markOrderPrintRequestPrintedInTx
        .mockResolvedValueOnce(pendingRequest('request-1'));
      tx.order.findUnique.mockResolvedValue(current);
      tx.orderPrintJob.findFirst.mockResolvedValueOnce({ id: 'request-1' });
      tx.orderPrintJob.create.mockResolvedValue({ id: 'receipt-1' });
      await expect(recordRenderedPrintInTx(tx as never, attempt, admin, contentIsCurrent)).resolves.toBe('MARKED');
      const sql = (tx.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.orderPrintAttempt.findUnique.mock.invocationCallOrder[0]!);
      expect(contentIsCurrent.mock.invocationCallOrder[0]).toBeLessThan(tx.orderPrintJob.findFirst.mock.invocationCallOrder[0]!);
      expect(tx.orderPrintJob.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ state: OrderPrintJobState.PRINTED, requestJobId: 'request-1', idempotencyKey: 'print-page:attempt-1' }),
      }));
      expect(ledgerEntry(tx)).toEqual({ attemptKey: 'print-page:attempt-1', orderId: 'order-1', workOrderVersion: 3, outcome: 'MARKED', receiptId: 'receipt-1', actorId: 'admin-1' });
    });

    it.each(['MARKED', 'ALREADY_PRINTED', 'STALE', 'NOT_PRINTABLE'] as const)(
      'replays a booked %s attempt without reading the order or claiming a request created afterwards', async (outcome) => {
        const tx = txMock();
        const contentIsCurrent = sameContent();
        tx.orderPrintAttempt.findUnique.mockResolvedValue({ orderId: 'order-1', outcome });
        tx.orderPrintJob.findFirst.mockResolvedValue({ id: 'manual-reprint-created-later' });
        await expect(recordRenderedPrintInTx(tx as never, attempt, admin, contentIsCurrent)).resolves.toBe(outcome);
        expect(contentIsCurrent).not.toHaveBeenCalled();
        expect(tx.order.findUnique).not.toHaveBeenCalled();
        expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
        expect(tx.orderPrintAttempt.create).not.toHaveBeenCalled();
      });

    it('refuses an attempt key booked for another order', async () => {
      const tx = txMock();
      tx.orderPrintAttempt.findUnique.mockResolvedValue({ orderId: 'order-2', outcome: 'MARKED' });
      await expect(recordRenderedPrintInTx(tx as never, attempt, admin, sameContent())).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('creates and records the first print when release did not queue one', async () => {
      const tx = txMock();
      tx.orderPrintAttempt.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(current);
      tx.orderPrintJob.findFirst.mockResolvedValue(null);
      tx.orderPrintJob.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(pendingRequest('request-new'));
      tx.orderPrintJob.create.mockResolvedValueOnce({ id: 'request-new' }).mockResolvedValueOnce({ id: 'receipt-1' });
      await expect(recordRenderedPrintInTx(tx as never, attempt, admin, sameContent())).resolves.toBe('MARKED');
      expect(tx.orderPrintJob.create.mock.calls[0]?.[0]).toMatchObject({ data: {
        orderId: 'order-1', workOrderVersion: 3, printKind: OrderPrintKind.INITIAL, reason: '管理员直接打印',
        state: OrderPrintJobState.PENDING, idempotencyKey: expect.stringMatching(/^print-request:/),
      } });
      expect(tx.orderPrintJob.create.mock.calls[1]?.[0]).toMatchObject({ data: {
        state: OrderPrintJobState.PRINTED, requestJobId: 'request-new', idempotencyKey: 'print-page:attempt-1',
      } });
      expect(ledgerEntry(tx)).toMatchObject({ outcome: 'MARKED', receiptId: 'receipt-1' });
    });

    it.each([
      ['an older work-order version', { ...current, workOrderVersion: 4 }, true, null, null, 'STALE'],
      ['changed paper instructions (e.g. production worker reassigned)', current, false, { id: 'request-2' }, null, 'STALE'],
      ['an order that left production', { ...current, status: OrderStatus.SHIPPED }, true, { id: 'request-1' }, null, 'NOT_PRINTABLE'],
      ['a version already printed', current, true, null, { id: 'receipt-0' }, 'ALREADY_PRINTED'],
      ['a paused order with nothing queued', { ...current, status: OrderStatus.ON_HOLD }, true, null, null, 'NOT_PRINTABLE'],
    ])('books but does not print for %s', async (_label, order, contentMatches, pending, printed, outcome) => {
      const tx = txMock();
      tx.orderPrintAttempt.findUnique.mockResolvedValue(null);
      tx.order.findUnique.mockResolvedValue(order);
      tx.orderPrintJob.findFirst.mockResolvedValueOnce(pending).mockResolvedValueOnce(printed);
      await expect(recordRenderedPrintInTx(tx as never, attempt, admin, vi.fn(async () => contentMatches))).resolves.toBe(outcome);
      expect(tx.orderPrintJob.create).not.toHaveBeenCalled();
      expect(tx.orderLog.create).not.toHaveBeenCalled();
      // 账本记下这次结果：之后同一尝试的重试只返回它，不会认领之后新建的任务。
      expect(ledgerEntry(tx)).toEqual({ attemptKey: 'print-page:attempt-1', orderId: 'order-1', workOrderVersion: 3, outcome, receiptId: null, actorId: 'admin-1' });
    });

    it('rejects non-admin writers before locking', async () => {
      const tx = txMock();
      await expect(recordRenderedPrintInTx(tx as never, attempt, { id: 'sales-1', role: Role.SALES }, sameContent())).rejects.toBeInstanceOf(OrderPrintJobError);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
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
