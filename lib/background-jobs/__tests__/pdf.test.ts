import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, enqueueBackgroundJobMock, getOrderForPrintMock, renderMock, writeFileMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundJob: { findUnique: vi.fn() },
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
  enqueueBackgroundJobMock.mockReset();
  getOrderForPrintMock.mockReset();
  renderMock.mockReset().mockResolvedValue(Buffer.from('pdf'));
  writeFileMock.mockReset();
  dbMock.user.findUnique.mockResolvedValue({ role: Role.ADMIN, isActive: true });
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
