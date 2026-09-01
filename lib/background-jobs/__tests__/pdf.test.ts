import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, enqueueBackgroundJobMock, getOrderForPrintMock } = vi.hoisted(() => ({
  dbMock: {
    backgroundJob: { findUnique: vi.fn() },
  },
  enqueueBackgroundJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getOrderForPrintMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));
vi.mock('@/lib/order/print-view', () => ({
  getOrderForPrint: getOrderForPrintMock,
}));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: vi.fn() }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: vi.fn() }));

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
});

describe('durable order PDF jobs', () => {
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

  it('returns a ready artifact only for the expected actor and order', async () => {
    dbMock.backgroundJob.findUnique.mockResolvedValue({
      type: 'ORDER_PDF',
      payload: {
        orderId: 'order-1',
        expectedWorkOrderVersion: 3,
        actor: { id: 'user-1', role: Role.ADMIN },
      },
      status: BackgroundJobStatus.SUCCEEDED,
      result: { artifactName: 'job-pdf.pdf' },
      lastErrorCode: null,
    });

    await expect(
      waitForOrderPdfJob('job-pdf', {
        expected: {
          orderId: 'order-1',
          actorId: 'user-1',
          workOrderVersion: 3,
        },
      }),
    ).resolves.toEqual({ status: 'ready', artifactName: 'job-pdf.pdf' });
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
          actorId: 'user-1',
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
          actorId: 'user-1',
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
});
