import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock collaborators before importing dispatch.
const { notifyMock, afterMock, modeMock, enqueueNotificationJobMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
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
      workOrderVersion: 1,
      externalSalesName: '外销甲',
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

  it('ORDER_SUBMITTED 在 durable 持久化前移除历史金额字段', async () => {
    modeMock.mockReturnValue('durable');

    await dispatchNotification('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'GD-260902-001',
      submitterName: '张三',
      customerRef: '苹果福',
      totalAmount: '9,999.00',
      urgentMark: '',
      summary: '客户：苹果福 · 提交人：张三',
      deepLink: '/orders#wo=GD-260902-001',
    });

    const queuedPayload = enqueueNotificationJobMock.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(queuedPayload).not.toHaveProperty('totalAmount');
    expect(queuedPayload).toMatchObject({
      orderNo: 'GD-260902-001',
      summary: '新工单已提交，待工厂确认',
      deepLink: '/orders#wo=GD-260902-001',
    });
    expect(JSON.stringify(queuedPayload)).not.toContain('苹果福');
    expect(JSON.stringify(queuedPayload)).not.toContain('张三');
  });

  it('spreadIndex 原样透传给入队（批量扇出的限流节流）', async () => {
    modeMock.mockReturnValue('durable');
    await dispatchNotification(
      'ORDER_OVERDUE',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        externalSalesName: '外销甲',
        customerRef: '客户',
        promisedDate: '2026-08-20',
        daysOverdue: 2,
        status: '生产中',
      },
      { dedupeKey: 'notification:ORDER_OVERDUE:2026-08-21:o1', spreadIndex: 7 },
    );
    expect(enqueueNotificationJobMock).toHaveBeenCalledWith(
      'ORDER_OVERDUE',
      expect.objectContaining({ orderId: 'o1' }),
      { dedupeKey: 'notification:ORDER_OVERDUE:2026-08-21:o1', spreadIndex: 7 },
    );
  });

  it('durable 入队失败向上冒泡，绝不做可能双发的 inline fallback', async () => {
    modeMock.mockReturnValue('durable');
    enqueueNotificationJobMock.mockRejectedValue(
      Object.assign(new Error('connection string must stay private'), {
        name: 'DatabaseUnavailableError',
      }),
    );
    await expect(
      dispatchNotification('ORDER_COMPLETED', {
        orderId: 'o1',
        orderNo: 'O-1',
        workOrderVersion: 1,
        externalSalesName: '外销甲',
        customerRef: null,
      }),
    ).rejects.toMatchObject({ name: 'DatabaseUnavailableError' });

    expect(notifyMock).not.toHaveBeenCalled();
  });
});

// notify 现在返回 NotifyOutcome（含 retryable），只有 handleNotificationJob
// 会据此抛异常。这一组把「同步调用点不会被带崩」钉死：dispatch 的三条路径
// 都忽略返回值，`void notify(...)` 更不能变成 unhandled rejection —— Node 24
// 默认 --unhandled-rejections=throw，那等于让一次企业微信抖动打死 web 进程。
describe('dispatchNotification · notify 返回可重试 outcome 时不带崩同步路径', () => {
  const retryableOutcome = {
    event: 'ORDER_COMPLETED',
    attempted: 1,
    delivered: 0,
    skipped: 0,
    failed: 1,
    retryable: true,
    unknown: 0,
    unlogged: 0,
    errorCodes: ['http 500'],
  };

  beforeEach(() => {
    notifyMock.mockResolvedValue(retryableOutcome);
  });

  const payload = {
    orderId: 'o1',
    orderNo: 'O-1',
    workOrderVersion: 1,
    externalSalesName: '外销甲',
    customerRef: null,
  } as const;

  it('inline after() 回调：dispatch 不抛，回调本身也 resolve', async () => {
    await expect(
      dispatchNotification('ORDER_COMPLETED', payload),
    ).resolves.toBeUndefined();
    const cb = afterMock.mock.calls[0]![0] as () => unknown;
    await expect(Promise.resolve(cb())).resolves.toMatchObject({
      retryable: true,
    });
  });

  it('after() 无 request scope 的 void 降级：不抛', async () => {
    afterMock.mockImplementation(() => {
      throw new Error('after() cannot be called outside of a request scope');
    });
    await expect(
      dispatchNotification('ORDER_COMPLETED', payload),
    ).resolves.toBeUndefined();
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('durable 入队失败：冒泡且不启动 inline sender', async () => {
    modeMock.mockReturnValue('durable');
    enqueueNotificationJobMock.mockRejectedValue(new Error('db down'));
    await expect(
      dispatchNotification('ORDER_COMPLETED', payload),
    ).rejects.toThrow('db down');
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
