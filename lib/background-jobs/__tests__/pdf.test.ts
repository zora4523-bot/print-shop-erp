import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, enqueueBackgroundJobMock, getOrderForPrintMock, renderMock, writeFileMock } = vi.hoisted(() => ({
  dbMock: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    backgroundJob: { findUnique: vi.fn(), findFirst: vi.fn() },
    backgroundWorkerHeartbeat: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  enqueueBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getOrderForPrintMock: vi.fn(),
  renderMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../clock', () => ({ databaseNow: async () => new Date('2026-09-11T00:00:00Z') }));
vi.mock('../repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));
vi.mock('@/lib/order/print-view', () => ({
  getOrderForPrint: getOrderForPrintMock,
}));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: async () => '<html>sheet</html>' }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: renderMock }));
vi.mock('@/lib/settings', () => ({ getSetting: async () => ({ name: '测试工厂' }) }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(), readdir: async () => [], readFile: vi.fn(), rename: vi.fn(),
  stat: vi.fn(), unlink: vi.fn(), writeFile: writeFileMock,
}));

import { BackgroundJobStatus, Role } from '../../../generated/prisma/enums';
import {
  enqueueOrderPdfJob,
  handleOrderPdfJob,
  OrderPdfVersionStaleError,
  waitForOrderPdfJob,
} from '../pdf';

beforeEach(() => {
  dbMock.backgroundJob.findUnique.mockReset();
  dbMock.backgroundJob.findFirst.mockReset().mockResolvedValue(null);
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
  dbMock.$transaction.mockReset().mockImplementation(async (callback: (tx: typeof dbMock) => unknown) =>
    callback(dbMock));
  dbMock.backgroundWorkerHeartbeat.findFirst.mockReset();
  enqueueBackgroundJobMock.mockReset();
  getOrderForPrintMock.mockReset();
  renderMock.mockReset().mockResolvedValue(Buffer.from('pdf'));
  writeFileMock.mockReset();
  dbMock.user.findUnique.mockResolvedValue({ role: Role.ADMIN, isActive: true });
});

it.each(['older-content', undefined])('rejects a completed task with a stale or missing content binding (%s)', async (snapshotKey) => {
  dbMock.backgroundJob.findUnique.mockResolvedValue({
    type: 'ORDER_PDF',
    payload: { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'user-1', role: Role.ADMIN }, snapshotKey },
    status: BackgroundJobStatus.SUCCEEDED,
    result: { artifactName: 'old.pdf' },
  });
  await expect(waitForOrderPdfJob('job', { expected: {
    orderId: 'order-1', actorId: 'user-1', actorRole: Role.ADMIN, workOrderVersion: 3, snapshotKey: 'current-content',
  } })).resolves.toEqual({ status: 'failed', errorCode: 'OrderPdfVersionStaleError' });
});

describe('durable order PDF jobs', () => {
  it('coalesces one authorized snapshot and separates actors, versions and explicit regeneration', async () => {
    enqueueBackgroundJobMock.mockResolvedValue({ job: { id: 'job-1' } });
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    await enqueueOrderPdfJob(input);
    await enqueueOrderPdfJob(input);
    await enqueueOrderPdfJob({ ...input, actor: { id: 'b', role: Role.ADMIN } });
    await enqueueOrderPdfJob({ ...input, expectedWorkOrderVersion: 4 });
    await enqueueOrderPdfJob({ ...input, regenerationKey: 'retry' });
    const keys = enqueueBackgroundJobMock.mock.calls.map(([call]) => (call as { dedupeKey: string }).dedupeKey);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys)).toHaveProperty('size', 4);
  });

  it('reuses a pending/running job of the same authorized scope instead of enqueueing another regeneration', async () => {
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    enqueueBackgroundJobMock.mockResolvedValue({ job: { id: 'job-window' } });
    await enqueueOrderPdfJob(input);
    const windowKey = (enqueueBackgroundJobMock.mock.calls[0][0] as { dedupeKey: string }).dedupeKey;
    dbMock.backgroundJob.findFirst.mockResolvedValue({ id: 'job-in-flight' });

    await expect(enqueueOrderPdfJob({ ...input, regenerationKey: 'r1' })).resolves.toBe('job-in-flight');
    await expect(enqueueOrderPdfJob({ ...input, regenerationKey: 'r2' })).resolves.toBe('job-in-flight');

    expect(enqueueBackgroundJobMock).toHaveBeenCalledTimes(1);
    const scopePrefix = windowKey.slice(0, windowKey.lastIndexOf(':') + 1);
    expect(dbMock.backgroundJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        type: 'ORDER_PDF',
        dedupeKey: { startsWith: scopePrefix },
        status: { in: [BackgroundJobStatus.PENDING, BackgroundJobStatus.RUNNING] },
      },
    }));
  });

  it('anchors a regeneration on the latest finished job so concurrent retries coalesce into one job', async () => {
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    enqueueBackgroundJobMock.mockResolvedValue({ job: { id: 'job-new' } });
    await enqueueOrderPdfJob(input);
    // 两个同时到达的重新生成都没查到在途任务，最近一个任务都是已失败的 job-dead。
    let latest: { id: string; status: BackgroundJobStatus } = { id: 'job-dead', status: BackgroundJobStatus.DEAD };
    dbMock.backgroundJob.findFirst.mockImplementation(async ({ where }: { where: { status?: unknown } }) =>
      where.status ? null : latest);
    await Promise.all([
      enqueueOrderPdfJob({ ...input, regenerationKey: 'r1' }),
      enqueueOrderPdfJob({ ...input, regenerationKey: 'r2' }),
    ]);
    // 之后那个任务也结束了，再次重新生成应当另起一个任务。
    latest = { id: 'job-done', status: BackgroundJobStatus.SUCCEEDED };
    await enqueueOrderPdfJob({ ...input, regenerationKey: 'r3' });

    const [windowKey, firstRetry, concurrentRetry, laterRetry] = enqueueBackgroundJobMock.mock.calls
      .map(([call]) => (call as { dedupeKey: string }).dedupeKey);
    const scopePrefix = windowKey.slice(0, windowKey.lastIndexOf(':') + 1);
    expect(firstRetry.startsWith(scopePrefix)).toBe(true);
    expect(concurrentRetry).toBe(firstRetry);
    expect(laterRetry.startsWith(scopePrefix)).toBe(true);
    expect(new Set([windowKey, firstRetry, laterRetry]).size).toBe(3);
  });

  it('a plain download reuses an in-flight regeneration instead of requeueing the dead window job', async () => {
    // A: window job, DEAD. B: in-flight regeneration of the same authorized scope.
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    dbMock.backgroundJob.findFirst.mockImplementation(async ({ where }: { where: { status?: unknown } }) =>
      where.status ? { id: 'job-b-regenerating' } : null);

    await expect(enqueueOrderPdfJob(input)).resolves.toBe('job-b-regenerating');

    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
  });

  it('serializes every PDF entry of one scope on the same transaction lock and enqueues inside it', async () => {
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    enqueueBackgroundJobMock.mockResolvedValue({ job: { id: 'job-x' } });
    const order: string[] = [];
    dbMock.$executeRaw.mockImplementation(async () => { order.push('lock'); return 1; });
    dbMock.backgroundJob.findFirst.mockImplementation(async () => { order.push('lookup'); return null; });
    enqueueBackgroundJobMock.mockImplementation(async (_input, client) => {
      order.push(client === dbMock ? 'enqueue:tx' : 'enqueue:global');
      return { job: { id: 'job-x' } };
    });

    await enqueueOrderPdfJob(input);
    await enqueueOrderPdfJob({ ...input, regenerationKey: 'r1' });
    await enqueueOrderPdfJob({ ...input, actor: { id: 'b', role: Role.ADMIN } });

    expect(dbMock.$transaction).toHaveBeenCalledTimes(3);
    expect(order.slice(0, 3)).toEqual(['lock', 'lookup', 'enqueue:tx']);
    expect(order).not.toContain('enqueue:global');
    const lockKeys = dbMock.$executeRaw.mock.calls.map((call) => JSON.stringify(call.slice(1)));
    expect(lockKeys[0]).toBe(lockKeys[1]);
    expect(lockKeys[2]).not.toBe(lockKeys[0]);
  });

  it('reuses a job that became pending between the in-flight lookup and the anchor lookup', async () => {
    const input = { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'a', role: Role.ADMIN }, baseUrl: 'https://erp.example.com', snapshotKey: 'same' };
    dbMock.backgroundJob.findFirst.mockImplementation(async ({ where }: { where: { status?: unknown } }) =>
      where.status ? null : { id: 'job-just-queued', status: BackgroundJobStatus.PENDING });
    await expect(enqueueOrderPdfJob({ ...input, regenerationKey: 'r1' })).resolves.toBe('job-just-queued');
    expect(enqueueBackgroundJobMock).not.toHaveBeenCalled();
  });

  it.each(['tasks', 'unknown'])('does not serve retired or invalid PDF jobs (%s)', async (mode) => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      type: 'ORDER_PDF',
      payload: { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'user-1' }, mode },
      status: BackgroundJobStatus.SUCCEEDED,
      result: { artifactName: 'wrong-mode.pdf' },
      lastErrorCode: null,
    });
    await expect(waitForOrderPdfJob('job-pdf', {
      expected: { orderId: 'order-1', actorId: 'user-1', actorRole: Role.ADMIN, workOrderVersion: 3 },
    })).resolves.toEqual({ status: 'failed', errorCode: 'JobNotFound' });
  });

  it.each(['tasks', 'unknown'])('rejects retired or invalid jobs before loading order data (%s)', async (mode) => {
    await expect(handleOrderPdfJob({ payload: {
      orderId: 'order-1', expectedWorkOrderVersion: 3,
      actor: { id: 'user-1', role: Role.ADMIN },
      baseUrl: 'https://erp.example.com', mode,
    } } as never)).rejects.toMatchObject({ name: 'InvalidOrderPdfJobPayloadError' });
    expect(getOrderForPrintMock).not.toHaveBeenCalled();
  });
  it('enqueues heavy work with actor/order binding', async () => {
    enqueueBackgroundJobMock.mockResolvedValue({
      job: { id: 'job-pdf' },
      created: true,
      requeued: false,
    });

    await expect(
      enqueueOrderPdfJob({
        orderId: 'order-1',
        expectedWorkOrderVersion: 3,
        actor: { id: 'user-1', role: Role.ADMIN },
        baseUrl: 'https://erp.example.com',
      }),
    ).resolves.toBe('job-pdf');

    expect(enqueueBackgroundJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORDER_PDF',
        queue: 'HEAVY',
        payload: {
          orderId: 'order-1',
          expectedWorkOrderVersion: 3,
          actor: { id: 'user-1', role: Role.ADMIN },
          baseUrl: 'https://erp.example.com',
        },
      }),
      dbMock,
    );
  });

  it.each([undefined, 'order'])('returns compatible order artifacts only for the expected actor (%s)', async (mode) => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      type: 'ORDER_PDF',
      payload: {
        orderId: 'order-1',
        expectedWorkOrderVersion: 3,
        actor: { id: 'user-1', role: Role.ADMIN },
        mode,
      },
      status: BackgroundJobStatus.SUCCEEDED,
      result: { artifactName: 'job-pdf.pdf' },
      lastErrorCode: null,
    });

    await expect(
      waitForOrderPdfJob('job-pdf', {
        expected: {
          orderId: 'order-1',
          actorId: 'user-1', actorRole: Role.ADMIN,
          workOrderVersion: 3,
        },
      }),
    ).resolves.toEqual({ status: 'ready', artifactName: 'job-pdf.pdf' });
  });

  it('does not reuse an artifact generated under a different role', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({ type: 'ORDER_PDF', payload: { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'user-1', role: Role.ADMIN } }, status: BackgroundJobStatus.SUCCEEDED, result: { artifactName: 'old-role.pdf' } });
    await expect(waitForOrderPdfJob('job-1', { expected: { orderId: 'order-1', actorId: 'user-1', actorRole: Role.WORKER, workOrderVersion: 3 } })).resolves.toEqual({ status: 'failed', errorCode: 'JobNotFound' });
  });

  it('hides a job id bound to another actor', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      type: 'ORDER_PDF',
      payload: {
        orderId: 'order-1',
        expectedWorkOrderVersion: 3,
        actor: { id: 'other-user', role: Role.ADMIN },
      },
      status: BackgroundJobStatus.SUCCEEDED,
      result: { artifactName: 'other.pdf' },
      lastErrorCode: null,
    });

    await expect(
      waitForOrderPdfJob('job-pdf', {
        expected: {
          orderId: 'order-1',
          actorId: 'user-1', actorRole: Role.ADMIN,
          workOrderVersion: 3,
        },
      }),
    ).resolves.toEqual({ status: 'failed', errorCode: 'JobNotFound' });
  });

  it('拒绝返回同一工单的旧版 PDF 任务', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      type: 'ORDER_PDF',
      payload: {
        orderId: 'order-1',
        expectedWorkOrderVersion: 2,
        actor: { id: 'user-1', role: Role.ADMIN },
      },
      status: BackgroundJobStatus.SUCCEEDED,
      result: { artifactName: 'old-version.pdf' },
      lastErrorCode: null,
    });

    await expect(
      waitForOrderPdfJob('job-pdf', {
        expected: {
          orderId: 'order-1',
          actorId: 'user-1', actorRole: Role.ADMIN,
          workOrderVersion: 3,
        },
      }),
    ).resolves.toEqual({ status: 'failed', errorCode: 'JobNotFound' });
  });

  it('工人渲染前发现工单已升版时失败关闭', async () => {
    getOrderForPrintMock.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-1',
      workOrderVersion: 4,
    });

    await expect(
      handleOrderPdfJob({
        payload: {
          orderId: 'order-1',
          expectedWorkOrderVersion: 3,
          actor: { id: 'user-1', role: Role.ADMIN },
          baseUrl: 'https://erp.example.com',
        },
      } as never),
    ).rejects.toBeInstanceOf(OrderPdfVersionStaleError);
  });

  it.each([
    [null, 'OrderPdfNotFoundError'],
    [{ workOrderVersion: 4 }, 'OrderPdfVersionStaleError'],
  ])('生成期间撤权或升版时不写入 PDF 产物 (%j)', async (current, errorName) => {
    getOrderForPrintMock.mockResolvedValueOnce({ id: 'order-1', orderNo: 'GD-1', workOrderVersion: 3 })
      .mockResolvedValueOnce(current);
    await expect(handleOrderPdfJob({
      id: 'job-1', attempts: 1,
      payload: { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'user-1', role: Role.ADMIN }, baseUrl: 'https://erp.example.com' },
    } as never)).rejects.toMatchObject({ name: errorName });
    expect(renderMock).toHaveBeenCalledOnce();
    expect(getOrderForPrintMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('当前权限与版本复核通过后才写入并返回 PDF', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: Role.WORKER, isActive: true });
    getOrderForPrintMock.mockResolvedValue({ id: 'order-1', orderNo: 'GD-1', workOrderVersion: 3 });
    await expect(handleOrderPdfJob({
      id: 'job-1', attempts: 1,
      payload: { orderId: 'order-1', expectedWorkOrderVersion: 3, actor: { id: 'user-1', role: Role.WORKER }, baseUrl: 'https://erp.example.com' },
    } as never)).resolves.toEqual({ artifactName: 'job-1-1.pdf', byteLength: 3, orderNo: 'GD-1', workOrderVersion: 3 });
    expect(getOrderForPrintMock).toHaveBeenCalledTimes(2);
    expect(getOrderForPrintMock).toHaveBeenLastCalledWith('order-1', { id: 'user-1', role: Role.WORKER }, 'https://erp.example.com');
    expect(writeFileMock).toHaveBeenCalledOnce();
  });
});


describe('PDF queue availability', () => {
  const expected = { orderId: 'o', actorId: 'a', actorRole: Role.ADMIN, workOrderVersion: 1 };
  const pending = {
    type: 'ORDER_PDF', status: BackgroundJobStatus.PENDING,
    payload: { orderId: 'o', expectedWorkOrderVersion: 1, actor: { id: 'a', role: Role.ADMIN } },
    createdAt: new Date('2026-09-10T23:59:00Z'),
  };
  it('stops waiting when no active heavy worker exists', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue(pending);
    dbMock.backgroundWorkerHeartbeat.findFirst.mockResolvedValue(null);
    await expect(waitForOrderPdfJob('j', { expected })).resolves.toEqual({ status: 'unavailable' });
    expect(dbMock.backgroundWorkerHeartbeat.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ queue: 'HEAVY', lastSeenAt: { gte: expect.any(Date) } }),
    }));
  });
  it('caps waiting by persisted job age across requests without cancelling work', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({ ...pending, createdAt: new Date('2026-09-10T23:58:00Z') });
    dbMock.backgroundWorkerHeartbeat.findFirst.mockResolvedValue({ workerId: 'w' });
    await expect(waitForOrderPdfJob('j', { expected })).resolves.toEqual({ status: 'delayed' });
  });
  it('serves completed artifacts even if the worker has stopped', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({ ...pending, status: BackgroundJobStatus.SUCCEEDED, result: { artifactName: 'j.pdf' } });
    await expect(waitForOrderPdfJob('j', { expected })).resolves.toEqual({ status: 'ready', artifactName: 'j.pdf' });
    expect(dbMock.backgroundWorkerHeartbeat.findFirst).not.toHaveBeenCalled();
  });
  it('checks ownership before exposing queue availability', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue(pending);
    await expect(waitForOrderPdfJob('j', { expected: { ...expected, actorId: 'other' } })).resolves.toEqual({ status: 'failed', errorCode: 'JobNotFound' });
    expect(dbMock.backgroundWorkerHeartbeat.findFirst).not.toHaveBeenCalled();
  });
  it('trusts a fresh owning worker heartbeat even while PDF capability is stale', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({ ...pending, status: BackgroundJobStatus.RUNNING, lockedBy: 'owner:1' });
    dbMock.backgroundWorkerHeartbeat.findFirst.mockImplementation(async ({ where }) => where.workerId === 'owner' ? { workerId: 'owner' } : null);
    await expect(waitForOrderPdfJob('j', { expected, timeoutMs: 1_000 })).resolves.toEqual({ status: 'timeout', phase: 'running' });
    expect(dbMock.backgroundWorkerHeartbeat.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workerId: 'owner', lastSeenAt: { gte: expect.any(Date) } }) }));
  });
  it.each([null, 'dead-owner'])('checks capability when the running owner is missing or stale (%s)', async (lockedBy) => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({ ...pending, status: BackgroundJobStatus.RUNNING, lockedBy });
    dbMock.backgroundWorkerHeartbeat.findFirst.mockResolvedValue(null);
    await expect(waitForOrderPdfJob('j', { expected })).resolves.toEqual({ status: 'unavailable' });
    expect(dbMock.backgroundWorkerHeartbeat.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ pdfReady: true }) }));
  });

});
