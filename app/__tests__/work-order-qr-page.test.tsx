import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const {
  dbMock,
  notFoundMock,
  redirectMock,
  requireSessionMock,
  resolveWorkerScanMock,
} = vi.hoisted(() => ({
  dbMock: { order: { findFirst: vi.fn() } },
  notFoundMock: vi.fn(),
  redirectMock: vi.fn(),
  requireSessionMock: vi.fn(),
  resolveWorkerScanMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth/session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/production/work-order-scan', () => ({
  resolveWorkerWorkOrderScan: resolveWorkerScanMock,
}));
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));

import WorkOrderQrRedirectPage from '@/app/wo/[orderNo]/page';

const STOP = new Error('navigation');

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  requireSessionMock.mockReset();
  resolveWorkerScanMock.mockReset().mockResolvedValue(null);
  notFoundMock.mockReset().mockImplementation(() => {
    throw STOP;
  });
  redirectMock.mockReset().mockImplementation(() => {
    throw STOP;
  });
});

function renderPage(input: {
  orderNo?: string;
  version?: string;
  task?: string;
}) {
  return WorkOrderQrRedirectPage({
    params: Promise.resolve({ orderNo: input.orderNo ?? 'GD-001' }),
    searchParams: Promise.resolve({
      v: input.version,
      task: input.task,
    }),
  });
}

describe('/wo/[orderNo] printed QR', () => {
  it('师傅扫当前版本行内码时进入已授权的新工序', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'worker-1', role: Role.WORKER },
    });
    resolveWorkerScanMock.mockResolvedValue({
      orderId: 'order-1',
      workOrderVersion: 3,
      defaultTaskId: 'operation-v3',
      requestedTaskAllowed: true,
    });

    await expect(
      renderPage({ version: '3', task: 'operation/v3' }),
    ).rejects.toBe(STOP);

    expect(resolveWorkerScanMock).toHaveBeenCalledWith(
      'GD-001',
      { id: 'worker-1', role: Role.WORKER },
      'operation/v3',
    );
    expect(redirectMock).toHaveBeenCalledWith(
      '/worker/tasks/operation%2Fv3',
    );
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('师傅扫旧纸时先看到整页作废告警，不打开旧 task', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'worker-1', role: Role.WORKER },
    });
    resolveWorkerScanMock.mockResolvedValue({
      orderId: 'order-1',
      workOrderVersion: 3,
      defaultTaskId: 'operation-v3',
      requestedTaskAllowed: false,
    });

    const element = await renderPage({ version: '2', task: 'operation-v2' });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('此工单已作废，当前版本 v3');
    expect(html).toContain('role="alert"');
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('当前版本下伪造或跨 lane task id 返回 404', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'worker-1', role: Role.WORKER },
    });
    resolveWorkerScanMock.mockResolvedValue({
      orderId: 'order-1',
      workOrderVersion: 3,
      defaultTaskId: 'operation-v3',
      requestedTaskAllowed: false,
    });

    await expect(
      renderPage({ version: '3', task: 'operation-other-lane' }),
    ).rejects.toBe(STOP);
    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('主码只有一个待报工任务时直达该任务', async () => {
    requireSessionMock.mockResolvedValue({ user: { id: 'packer-1', role: Role.WORKER } });
    resolveWorkerScanMock.mockResolvedValue({ orderId: 'order-1', workOrderVersion: 3, defaultTaskId: 'pack-2', requestedTaskAllowed: true });
    await expect(renderPage({ version: '3' })).rejects.toBe(STOP);
    expect(redirectMock).toHaveBeenCalledWith('/worker/tasks/pack-2');
  });

  it.each(['多个待报工任务', '全部工序已完成'])('主码%s时进入工单选择页，不默选第一条', async () => {
    requireSessionMock.mockResolvedValue({ user: { id: 'packer-1', role: Role.WORKER } });
    resolveWorkerScanMock.mockResolvedValue({ orderId: 'order-1', workOrderVersion: 3, defaultTaskId: null, requestedTaskAllowed: true });
    await expect(renderPage({ version: '3' })).rejects.toBe(STOP);
    expect(redirectMock).toHaveBeenCalledWith('/worker/orders/order-1');
  });

  it('管理员扫当前版本头部码仍进入管理端订单', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      workOrderVersion: 3,
    });

    await expect(renderPage({ version: '3' })).rejects.toBe(STOP);

    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: { orderNo: 'GD-001' },
      select: { id: true, workOrderVersion: true },
    });
    expect(redirectMock).toHaveBeenCalledWith('/orders/order-1');
    expect(resolveWorkerScanMock).not.toHaveBeenCalled();
  });
});
