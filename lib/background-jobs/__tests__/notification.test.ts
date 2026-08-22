import { beforeEach, describe, expect, it, vi } from 'vitest';

// notify 的公开契约是**永不抛**（dispatch.ts 有 `void notify()`，一旦会抛，
// Node 24 默认 --unhandled-rejections=throw 会把 web 进程打崩）。所以「要不要
// 重试」的判断落在 handleNotificationJob 上：它读 NotifyOutcome.retryable，
// 只有可重试的失败才抛，让 BackgroundJob 走 durable 退避 / 死信。
// 这个文件锁的就是这条分工。
const { notifyMock, enqueueBackgroundJobMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  enqueueBackgroundJobMock: vi.fn(),
}));

vi.mock('../../notification/notify', () => ({ notify: notifyMock }));
vi.mock('../repository', () => ({
  enqueueBackgroundJob: enqueueBackgroundJobMock,
}));

import { BackgroundJobQueue } from '../../../generated/prisma/enums';
import {
  enqueueNotificationJob,
  handleNotificationJob,
  InvalidNotificationJobPayloadError,
  NotificationDeliveryFailedError,
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
    unlogged: 0,
    errorCodes: [] as string[],
    ...over,
  };
}

beforeEach(() => {
  notifyMock.mockReset().mockResolvedValue(outcome());
  enqueueBackgroundJobMock.mockReset().mockResolvedValue({
    job: { id: 'job-notif-1' },
    created: true,
    requeued: false,
  });
});

describe('handleNotificationJob', () => {
  it('把 job.dedupeKey 当 deliveryKey 传给 notify，并算出 finalAttempt', async () => {
    await handleNotificationJob(job({ attempts: 1, maxAttempts: 5 }));
    expect(notifyMock).toHaveBeenCalledWith(
      'ORDER_SUBMITTED',
      expect.objectContaining({ orderId: 'o1' }),
      { deliveryKey: 'notification:ORDER_SUBMITTED:o1', finalAttempt: false },
    );
  });

  it('最后一次 attempt 传 finalAttempt=true（失败要落 FAILED 而不是 RETRYING）', async () => {
    await handleNotificationJob(job({ attempts: 5, maxAttempts: 5 }));
    expect(notifyMock.mock.calls[0]![2]).toEqual({
      deliveryKey: 'notification:ORDER_SUBMITTED:o1',
      finalAttempt: true,
    });
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
        errorCodes: ['http 500'],
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
        errorCodes: ['http 500'],
      });
    }
    // 只打计数，不打 channel id / 消息正文
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('qy');
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
    expect(input.maxAttempts).toBe(5);
    expect(input.queue).toBe(BackgroundJobQueue.LIGHT);
  });

  it('spreadIndex=0 也留空（第一条不必推迟）', async () => {
    await enqueueNotificationJob('ORDER_SUBMITTED', PAYLOAD.payload, {
      spreadIndex: 0,
    });
    expect(enqueueBackgroundJobMock.mock.calls[0]![0].availableAt).toBeUndefined();
  });

  it('批量扇出按 spreadIndex 摊开 availableAt（压在企业微信 20 条/分钟以下）', async () => {
    const before = Date.now();
    await enqueueNotificationJob('ORDER_SUBMITTED', PAYLOAD.payload, {
      spreadIndex: 10,
    });
    const availableAt = enqueueBackgroundJobMock.mock.calls[0]![0]
      .availableAt as Date;
    // 10 × 3500ms = 35s；给测试机留一点执行漂移的余量
    expect(availableAt.getTime() - before).toBeGreaterThanOrEqual(35_000);
    expect(availableAt.getTime() - before).toBeLessThan(40_000);
  });
});
