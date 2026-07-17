import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueCronJobMock } = vi.hoisted(() => ({
  enqueueCronJobMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: () => 'durable',
}));
vi.mock('@/lib/background-jobs/cron', () => ({
  enqueueCronJob: enqueueCronJobMock,
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
  runOrderOverdueTask: vi.fn(),
  runOutsourceOverdueTask: vi.fn(),
}));
vi.mock('@/lib/salary/hourly-aggregate', () => ({
  HourlyAggregateError: class HourlyAggregateError extends Error {},
}));

import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { POST as csPeriodEndingPost } from '../cs-period-ending/route';
import { POST as csSettlePost } from '../cs-settle/route';
import { POST as dailySalaryPost } from '../daily-salary/route';
import { POST as generateBillsPost } from '../generate-bills/route';
import { POST as hourlyPayrollPost } from '../hourly-payroll/route';
import { POST as orderOverduePost } from '../order-overdue/route';
import { POST as outsourceOverduePost } from '../outsource-overdue/route';

const SECRET = 'test-cron-secret-12345';

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  enqueueCronJobMock.mockReset().mockResolvedValue({
    jobId: 'job-1',
    created: true,
    requeued: false,
  });
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
      name: 'hourly payroll',
      post: hourlyPayrollPost,
      path: '/api/cron/hourly-payroll',
      body: { month: '2026-06' },
      expected: {
        type: BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL,
        scope: '2026-06',
        payload: { month: '2026-06' },
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
