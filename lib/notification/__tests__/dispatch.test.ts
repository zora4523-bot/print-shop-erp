import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock collaborators before importing dispatch.
const { notifyMock, afterMock, modeMock, enqueueNotificationJobMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  afterMock: vi.fn<(cb: () => unknown) => void>(),
  modeMock: vi.fn<() => 'inline' | 'durable'>(() => 'inline'),
  enqueueNotificationJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('../notify', () => ({ notify: notifyMock }));
vi.mock('next/server', () => ({ after: afterMock }));
vi.mock('../../background-jobs/mode', () => ({ backgroundJobsMode: modeMock }));
vi.mock('../../background-jobs/notification', () => ({
  enqueueNotificationJob: enqueueNotificationJobMock,
}));

import { dispatchNotification } from '../dispatch';

beforeEach(() => {
  notifyMock.mockReset().mockResolvedValue(undefined);
  afterMock.mockReset();
  modeMock.mockReset().mockReturnValue('inline');
  enqueueNotificationJobMock.mockReset().mockResolvedValue({
    jobId: 'job-1',
    created: true,
  });
});

describe('dispatchNotification', () => {
  it('happy path: schedules notify via after()', () => {
    dispatchNotification('ORDER_SCHEDULED', {
      orderId: 'o1',
      orderNo: 'O-1',
      taskCount: 3,
    });
    expect(afterMock).toHaveBeenCalledTimes(1);
    // notify itself is invoked when Next runs the scheduled callback;
    // simulate that here.
    const cb = afterMock.mock.calls[0]![0] as () => unknown;
    cb();
    expect(notifyMock).toHaveBeenCalledWith('ORDER_SCHEDULED', {
      orderId: 'o1',
      orderNo: 'O-1',
      taskCount: 3,
    });
  });

  it('no request scope（after() throws "outside of a request"）→ silent fallback to void notify, no console.warn', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    afterMock.mockImplementation(() => {
      throw new Error(
        'after() cannot be called outside of a request scope',
      );
    });
    dispatchNotification('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: null,
      totalAmount: '0',
      urgentMark: '',
    });
    // expected fallback path used → notify still called (background)
    expect(notifyMock).toHaveBeenCalledTimes(1);
    // expected no-scope error → NO console.warn noise
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('unexpected after() failure → console.warn 留信号，再降级到 void notify（Codex round 111 medium）', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    afterMock.mockImplementation(() => {
      throw new Error('boom: some other internal Next runtime failure');
    });
    dispatchNotification('ORDER_SHIPPED', {
      orderId: 'o1',
      orderNo: 'O-1',
      trackingNo: 'SF1',
    });
    // 仍 fall back 让 wire 能 deliver
    expect(notifyMock).toHaveBeenCalledTimes(1);
    // 但**必须**有 console.warn ops 信号
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/after\(\) failed/);
    warnSpy.mockRestore();
  });

  it('non-Error throw（极端情况）→ 也 warn + 降级（不当成 expected）', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    afterMock.mockImplementation(() => {
      throw 'string thrown';
    });
    dispatchNotification('ORDER_COMPLETED', {
      orderId: 'o1',
      orderNo: 'O-1',
      customerRef: null,
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('durable 模式只入队，不在请求进程直接 notify', async () => {
    modeMock.mockReturnValue('durable');

    await expect(
      dispatchNotification(
        'ORDER_SUBMITTED',
        {
          orderId: 'o1',
          orderNo: 'O-1',
          submitterName: '张三',
          customerRef: null,
          totalAmount: '0',
          urgentMark: '',
        },
        { dedupeKey: 'notification:ORDER_SUBMITTED:o1' },
      ),
    ).resolves.toBeUndefined();

    expect(enqueueNotificationJobMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({ orderId: 'o1', orderNo: 'O-1' }),
      { dedupeKey: 'notification:ORDER_SUBMITTED:o1' },
    );
    expect(afterMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('durable 入队失败仍永不抛，并降级 best-effort notify', async () => {
    modeMock.mockReturnValue('durable');
    enqueueNotificationJobMock.mockRejectedValue(
      Object.assign(new Error('connection string must stay private'), {
        name: 'DatabaseUnavailableError',
      }),
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      dispatchNotification('ORDER_COMPLETED', {
        orderId: 'o1',
        orderNo: 'O-1',
        customerRef: null,
      }),
    ).resolves.toBeUndefined();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[dispatchNotification] durable enqueue failed:',
      'DatabaseUnavailableError',
    );
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(
      'connection string',
    );
    errorSpy.mockRestore();
  });
});
