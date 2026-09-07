import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// notify 的公开契约是**永不抛**（dispatch.ts 有 `void notify()`，一旦会抛，
// Node 24 默认 --unhandled-rejections=throw 会把 web 进程打崩）。所以「要不要
// 重试」的判断落在 handleNotificationJob 上：它读 NotifyOutcome.retryable，
// 只有可重试的失败才抛，让 BackgroundJob 走 durable 退避 / 死信。
// 这个文件锁的就是这条分工。
const {
  notifyMock,
  replayMock,
  enqueueBackgroundJobMock,
  databaseNowMock,
  ReplayConflictError,
} = vi.hoisted(() => {
  type ConflictOutcome = {
    event: string;
    attempted: number;
    delivered: number;
    skipped: number;
    failed: number;
    retryable: boolean;
    unknown: number;
    unlogged: number;
    errorCodes: string[];
  };

  class ReplayConflictError extends Error {
    readonly partialOutcome: ConflictOutcome;

    constructor(message: string, partialOutcome: ConflictOutcome) {
      super(message);
      this.name = 'NotificationReplayConflictError';
      this.partialOutcome = partialOutcome;
    }
  }

  return {
    notifyMock: vi.fn(),
    replayMock: vi.fn(),
    enqueueBackgroundJobMock: vi.fn(),
    databaseNowMock: vi.fn(),
    ReplayConflictError,
  };
});

vi.mock('../../notification/notify', () => ({
  notify: notifyMock,
  replayDurableNotificationLogs: replayMock,
  NotificationReplayConflictError: ReplayConflictError,
}));
vi.mock('../repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));
vi.mock('../clock', () => ({ databaseNow: databaseNowMock }));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  enqueueNotificationJob,
  handleNotificationJob,
  InvalidNotificationJobPayloadError,
  NotificationDeliveryFailedError,
  NotificationDeliveryUnknownError,
  NotificationReplayTerminalError,
} from '../notification';
import type { ClaimedBackgroundJob } from '../types';

const PAYLOAD = {
  event: 'ORDER_SUBMITTED',
  payload: {
    orderId: 'o1',
    orderNo: 'O-1',
    submitterName: '张三',
    customerRef: null,
    totalAmount: '0',
    urgentMark: '',
  },
};
const DB_NOW = new Date('2026-08-21T09:00:00.000Z');

function job(
  overrides: Partial<ClaimedBackgroundJob> = {},
): ClaimedBackgroundJob {
  return {
    id: 'job-notif-1',
    type: 'NOTIFICATION',
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: 'notification:ORDER_SUBMITTED:o1',
    payload: PAYLOAD,
    attempts: 1,
    maxAttempts: 5,
    workerId: 'light-worker:1',
    claimedAt: new Date('2026-08-21T09:00:00Z'),
    ...overrides,
  };
}

function outcome(over: Record<string, unknown> = {}) {
  return {
    event: 'ORDER_SUBMITTED',
    attempted: 1,
    delivered: 1,
    skipped: 0,
    failed: 0,
    retryable: false,
    unknown: 0,
    unlogged: 0,
    errorCodes: [] as string[],
    ...over,
  };
}

beforeEach(() => {
  notifyMock.mockReset().mockResolvedValue(outcome());
  replayMock.mockReset().mockResolvedValue(outcome());
  enqueueBackgroundJobMock.mockReset().mockResolvedValue({
    job: { id: 'job-notif-1' },
    created: true,
    requeued: false,
  });
  databaseNowMock.mockReset().mockResolvedValue(DB_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleNotificationJob', () => {
  it('把 job.dedupeKey 当 deliveryKey 传给 notify', async () => {
    await handleNotificationJob(job({ attempts: 1, maxAttempts: 5 }));
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({ orderId: 'o1' }),
      {
        deliveryKey: 'notification:ORDER_SUBMITTED:o1',
        deliveryAttempt: 1,
      },
    );
  });

  it('全部送达 → result 里带投递计数，不抛', async () => {
    notifyMock.mockResolvedValue(
      outcome({ attempted: 2, delivered: 2, skipped: 1 }),
    );
    await expect(handleNotificationJob(job())).resolves.toMatchObject({
      event: 'ORDER_SUBMITTED',
      attempted: 2,
      delivered: 2,
      skipped: 1,
      failed: 0,
    });
  });

  it('人工重发只走原日志定向路径，不再读当前规则扇出', async () => {
    await handleNotificationJob(
      job({
        attempts: 6,
        maxAttempts: 8,
        payload: {
          ...PAYLOAD,
          manualReplay: {
            targets: [{ logId: 'log-c2', stateVersion: 4 }],
          },
        },
      }),
    );

    expect(replayMock).toHaveBeenCalledExactlyOnceWith('ORDER_SUBMITTED', {
      deliveryKey: 'notification:ORDER_SUBMITTED:o1',
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      payload: PAYLOAD.payload,
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('前一目标 429 后发生重放冲突，抛专用终态错误而非传输重试', async () => {
    replayMock.mockRejectedValueOnce(
      new ReplayConflictError(
        'manual notification replay state generation mismatch',
        outcome({
          attempted: 1,
          delivered: 0,
          failed: 1,
          retryable: true,
          errorCodes: ['http 429'],
        }),
      ),
    );

    const handled = handleNotificationJob(
      job({
        attempts: 2,
        maxAttempts: 5,
        payload: {
          ...PAYLOAD,
          manualReplay: {
            targets: [{ logId: 'log-c2', stateVersion: 4 }],
          },
        },
      }),
    );

    await expect(handled).rejects.toBeInstanceOf(
      NotificationReplayTerminalError,
    );
    await expect(handled).rejects.toMatchObject({
      name: 'NotificationReplayTerminalError',
      partialResult: expect.objectContaining({
        attempted: 1,
        failed: 2,
        errorCodes: ['http 429', 'NotificationReplayConflictError'],
      }),
    });
  });

  it('纯版本冲突也立即进入不重试终态', async () => {
    replayMock.mockRejectedValueOnce(
      new ReplayConflictError(
        'manual notification replay state generation mismatch',
        outcome(),
      ),
    );

    await expect(
      handleNotificationJob(
        job({
          attempts: 1,
          maxAttempts: 5,
          payload: {
            ...PAYLOAD,
            manualReplay: {
              targets: [{ logId: 'log-c2', stateVersion: 4 }],
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'NotificationReplayTerminalError',
      partialResult: expect.objectContaining({
        failed: 1,
        errorCodes: ['NotificationReplayConflictError'],
      }),
    });
  });

  it('人工重放冲突不得掩盖先前已产生的 UNKNOWN', async () => {
    replayMock.mockRejectedValueOnce(
      new ReplayConflictError(
        'manual notification replay state generation mismatch',
        outcome({
          attempted: 1,
          delivered: 0,
          unknown: 1,
          errorCodes: ['TimeoutError'],
        }),
      ),
    );

    await expect(
      handleNotificationJob(
        job({
          attempts: 6,
          payload: {
            ...PAYLOAD,
            manualReplay: {
              targets: [{ logId: 'log-c2', stateVersion: 4 }],
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(NotificationDeliveryUnknownError);
  });

  it('拒绝结构损坏的人工重发路由标记', async () => {
    await expect(
      handleNotificationJob(
        job({ payload: { ...PAYLOAD, manualReplay: { targets: [] } } }),
      ),
    ).rejects.toBeInstanceOf(InvalidNotificationJobPayloadError);
    expect(replayMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('可重试失败 → 抛 NotificationDeliveryFailedError，携带部分进度', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    notifyMock.mockResolvedValue(
      outcome({
        attempted: 2,
        delivered: 1,
        skipped: 1,
        failed: 1,
        retryable: true,
        errorCodes: ['http 429'],
      }),
    );

    // CLAUDE.md §15.4：绝不把没送出去的 channel 标成成功。抛出去才会让
    // failBackgroundJob 按退避表重排，attempts 耗尽后判 DEAD。
    await expect(handleNotificationJob(job())).rejects.toBeInstanceOf(
      NotificationDeliveryFailedError,
    );
    try {
      await handleNotificationJob(job());
    } catch (err) {
      const failure = err as NotificationDeliveryFailedError;
      // name 会被 backgroundJobErrorCode 写进 lastErrorCode，ops 页看得到
      expect(failure.name).toBe('NotificationDeliveryFailedError');
      expect(failure.partialResult).toMatchObject({
        delivered: 1,
        skipped: 1,
        failed: 1,
        errorCodes: ['http 429'],
      });
    }
    // 只打计数，不打 channel id / 消息正文
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('qy');
    errSpy.mockRestore();
  });

  it('第 4 次仍可恢复时继续抛给统一任务状态机，由既有预算收口 DEAD', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    notifyMock.mockResolvedValue(
      outcome({
        attempted: 0,
        delivered: 0,
        failed: 2,
        retryable: true,
        errorCodes: ['management route incomplete'],
      }),
    );

    await expect(
      handleNotificationJob(job({ attempts: 4, maxAttempts: 4 })),
    ).rejects.toMatchObject({
      name: 'NotificationDeliveryFailedError',
      partialResult: expect.objectContaining({
        attempted: 0,
        failed: 2,
        errorCodes: ['management route incomplete'],
      }),
    });
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.any(Object),
      expect.objectContaining({ deliveryAttempt: 4 }),
    );
    errSpy.mockRestore();
  });

  it('永久性失败 → 不抛，但 failed / errorCodes 落进 job.result', async () => {
    // 群被关停、webhook key 失效：重试 5 次结果一模一样，抛只会白耗
    // attempts 把死信队列灌满 ops 无法处置的行。
    notifyMock.mockResolvedValue(
      outcome({
        attempted: 1,
        delivered: 0,
        failed: 1,
        retryable: false,
        errorCodes: ['wecom errcode=93000'],
      }),
    );
    await expect(handleNotificationJob(job())).resolves.toMatchObject({
      failed: 1,
      delivered: 0,
      errorCodes: ['wecom errcode=93000'],
    });
  });

  it('投递结果未知 → 抛专用错误并携带进度，禁止自动重发', async () => {
    notifyMock.mockResolvedValue(
      outcome({
        attempted: 1,
        delivered: 0,
        unknown: 1,
        errorCodes: ['AbortError'],
      }),
    );

    await expect(handleNotificationJob(job())).rejects.toMatchObject({
      name: 'NotificationDeliveryUnknownError',
      partialResult: expect.objectContaining({
        unknown: 1,
        errorCodes: ['AbortError'],
      }),
    });
    await expect(handleNotificationJob(job())).rejects.toBeInstanceOf(
      NotificationDeliveryUnknownError,
    );
  });

  it('payload 结构损坏 → InvalidNotificationJobPayloadError，且不调 notify', async () => {
    await expect(
      handleNotificationJob(job({ payload: { event: 'NOPE', payload: {} } })),
    ).rejects.toBeInstanceOf(InvalidNotificationJobPayloadError);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('enqueueNotificationJob', () => {
  it('单条事件不传 spreadIndex → availableAt 留空，用库默认 now()', async () => {
    await enqueueNotificationJob('ORDER_SUBMITTED', PAYLOAD.payload, {
      dedupeKey: 'notification:ORDER_SUBMITTED:o1',
    });
    const input = enqueueBackgroundJobMock.mock.calls[0]![0];
    expect(input.availableAt).toBeUndefined();
    // One initial delivery plus at most three retries (official errcode -1
    // guidance).
    expect(input.maxAttempts).toBe(4);
    expect(input.queue).toBe(BackgroundJobQueue.LIGHT);
    expect(databaseNowMock).not.toHaveBeenCalled();
  });

  it('spreadIndex=0 也留空（第一条不必推迟）', async () => {
    await enqueueNotificationJob('ORDER_SUBMITTED', PAYLOAD.payload, {
      spreadIndex: 0,
    });
    expect(enqueueBackgroundJobMock.mock.calls[0]![0].availableAt).toBeUndefined();
    expect(databaseNowMock).not.toHaveBeenCalled();
  });

  it('批量扇出以数据库时钟为基准摊开 availableAt', async () => {
    // 故意把 Node 墙上时间设到别处；availableAt 仍只能由 DB_NOW 决定。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2035-01-01T00:00:00.000Z'));
    await enqueueNotificationJob('ORDER_SUBMITTED', PAYLOAD.payload, {
      spreadIndex: 10,
    });
    const availableAt = enqueueBackgroundJobMock.mock.calls[0]![0]
      .availableAt as Date;
    expect(availableAt).toEqual(new Date(DB_NOW.getTime() + 35_000));
    expect(databaseNowMock).toHaveBeenCalledTimes(1);
  });
});
