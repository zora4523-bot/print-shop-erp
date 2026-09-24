import { beforeEach, describe, expect, it, vi } from 'vitest';

const { databaseClockNowMock, enqueueCronJobMock } = vi.hoisted(() => ({
  databaseClockNowMock: vi.fn(),
  enqueueCronJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: () => 'durable',
}));
vi.mock('@/lib/background-jobs/cron', () => ({
  enqueueCronJob: enqueueCronJobMock,
}));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseClockNowMock,
}));
vi.mock('@/lib/cron/schedule', () => ({
  isStrictYmd: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  isStrictYearMonth: (value: string) => /^\d{4}-\d{2}$/.test(value),
  previousShanghaiMonth: () => '2026-06',
  shanghaiCalendarDate: () => '2026-07-17',
  yesterdayShanghai: () => '2026-07-16',
}));
vi.mock('@/lib/cron/tasks', () => ({
  runCsPeriodEndingTask: vi.fn(),
  runCsSettleTask: vi.fn(),
  runDailySalaryTask: vi.fn(),
  runGenerateBillsTask: vi.fn(),
  runHourlyPayrollTask: vi.fn(),
  runOrderExportCleanupTask: vi.fn(),
  runOrderOverdueTask: vi.fn(),
  runOutsourceOverdueTask: vi.fn(),
}));
vi.mock('@/lib/cron/pending-factory-backlog', () => ({
  runPendingFactoryBacklogTask: vi.fn(),
}));
vi.mock('@/lib/notification/production-alerts', () => ({
  runProductionAlertNotificationTask: vi.fn(),
}));

import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { POST as csPeriodEndingPost } from '../cs-period-ending/route';
import { POST as csSettlePost } from '../cs-settle/route';
import { POST as dailySalaryPost } from '../daily-salary/route';
import { POST as generateBillsPost } from '../generate-bills/route';
import { POST as orderExportCleanupPost } from '../order-export-cleanup/route';
import { POST as orderOverduePost } from '../order-overdue/route';
import { POST as outsourceOverduePost } from '../outsource-overdue/route';
import { POST as pendingFactoryBacklogPost } from '../pending-factory-backlog/route';
import { POST as productionAlertsPost } from '../production-alerts/route';

const SECRET = 'test-cron-secret-12345';

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  enqueueCronJobMock.mockReset().mockResolvedValue({
    jobId: 'job-1',
    created: true,
    requeued: false,
  });
  databaseClockNowMock
    .mockReset()
    .mockResolvedValue(new Date('2026-07-17T04:00:00.000Z'));
});

function request(path: string, body: unknown = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('cron durable wires', () => {
  const cases = [
    {
      name: 'daily salary',
      post: dailySalaryPost,
      path: '/api/cron/daily-salary',
      body: { date: '2026-07-16' },
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY,
        scope: '2026-07-16',
        payload: { date: '2026-07-16' },
      },
    },
    {
      name: 'CS settle',
      post: csSettlePost,
      path: '/api/cron/cs-settle',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_CS_SETTLE,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'generate bills',
      post: generateBillsPost,
      path: '/api/cron/generate-bills',
      body: { period: '2026-06' },
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS,
        scope: '2026-06',
        payload: { period: '2026-06' },
      },
    },
    {
      name: 'outsource overdue',
      post: outsourceOverduePost,
      path: '/api/cron/outsource-overdue',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'CS period ending',
      post: csPeriodEndingPost,
      path: '/api/cron/cs-period-ending',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'order overdue',
      post: orderOverduePost,
      path: '/api/cron/order-overdue',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'pending factory backlog',
      post: pendingFactoryBacklogPost,
      path: '/api/cron/pending-factory-backlog',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'production alerts',
      post: productionAlertsPost,
      path: '/api/cron/production-alerts',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS,
        scope: '2026-07-17T04:00Z',
        payload: { runDate: '2026-07-17' },
      },
    },
    {
      name: 'order export cleanup',
      post: orderExportCleanupPost,
      path: '/api/cron/order-export-cleanup',
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
        scope: '2026-07-17',
        payload: { runDate: '2026-07-17' },
      },
    },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.name} authenticates and enqueues instead of running inline`, async () => {
      const response = await testCase.post(
        request(testCase.path, 'body' in testCase ? testCase.body : {}),
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        status: 'queued',
        jobId: 'job-1',
      });
      expect(enqueueCronJobMock).toHaveBeenCalledWith(testCase.expected);
    });
  }
});

// 薪资两条 cron 新增了一个 400 分支（既有 202/401/503 的形状不变）。真闸口
// 在 lib/salary/*，路由这层只是入队前的提前失败：durable 模式下一个未来
// 日期会变成一条注定烧满 maxAttempts=4 次的 BackgroundJob。
//
// 日期写死 2099，不用相对真实时钟推算 —— 免得这条断言随墙上时钟漂移。
// 谓词来自 @/lib/dashboard/shanghai-clock（本文件没有 mock 它），所以上面
// 那份 @/lib/cron/schedule 的 mock 工厂不需要跟着加导出。
describe('salary cron wires refuse future-dated scopes before enqueuing', () => {
  it('daily-salary rejects the still-open Shanghai day just like the ledger', async () => {
    const date = todayShanghai(new Date('2026-07-17T04:00:00.000Z'));
    const response = await dailySalaryPost(
      request('/api/cron/daily-salary', { date }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `open date: ${date}`,
    });
    expect(enqueueCronJobMock).not.toHaveBeenCalled();
  });

  it('daily-salary answers 400 and does not enqueue', async () => {
    const response = await dailySalaryPost(
      request('/api/cron/daily-salary', { date: '2099-01-01' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/future date/),
    });
    expect(enqueueCronJobMock).not.toHaveBeenCalled();
  });
});
