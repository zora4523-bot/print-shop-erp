import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks for all 4 cron routes' lib dependencies. Using vi.hoisted so
// mocks are wired before route imports below.
const {
  computeDailyMock,
  settleReadyCsMock,
  getOverdueOutsourcingMock,
  scanOverdueOrdersMock,
  getEndingPeriodsMock,
  dbMock,
  dispatchMock,
  MockDailyBatchUnexpectedError,
  MockCsBatchUnexpectedError,
} = vi.hoisted(() => ({
  computeDailyMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  settleReadyCsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getOverdueOutsourcingMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  scanOverdueOrdersMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getEndingPeriodsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  dbMock: {
    user: { findMany: vi.fn() },
  },
  dispatchMock: vi.fn<(...args: unknown[]) => void>(),
  MockDailyBatchUnexpectedError: class extends Error {
    partialResult: unknown;
    constructor(partialResult: unknown) {
      super('unexpected daily batch failure');
      this.partialResult = partialResult;
    }
  },
  MockCsBatchUnexpectedError: class extends Error {
    partialResult: unknown;
    constructor(partialResult: unknown) {
      super('unexpected batch failure');
      this.partialResult = partialResult;
    }
  },
}));
vi.mock('@/lib/salary/daily', () => ({
  computeDailyForAllMachineWorkers: computeDailyMock,
  DailyBatchUnexpectedError: MockDailyBatchUnexpectedError,
}));
vi.mock('@/lib/salary/cs', () => ({
  settleReadyCsPeriods: settleReadyCsMock,
  CsBatchUnexpectedError: MockCsBatchUnexpectedError,
}));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getOverdueOutsourcing: getOverdueOutsourcingMock,
  getEndingPeriods: getEndingPeriodsMock,
}));
vi.mock('@/lib/order/overdue-scan', () => ({
  ORDER_OVERDUE_NOTIFY_CAP: 200,
  scanOverdueOrders: scanOverdueOrdersMock,
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchMock,
}));

import { POST as dailySalaryPost } from '../daily-salary/route';
import { POST as csSettlePost } from '../cs-settle/route';
import { POST as outsourceOverduePost } from '../outsource-overdue/route';
import { POST as orderOverduePost } from '../order-overdue/route';
import { POST as csPeriodEndingPost } from '../cs-period-ending/route';

const SECRET = 'test-cron-secret-12345';

beforeEach(() => {
  computeDailyMock.mockReset();
  settleReadyCsMock.mockReset();
  getOverdueOutsourcingMock.mockReset();
  scanOverdueOrdersMock.mockReset();
  getEndingPeriodsMock.mockReset();
  dbMock.user.findMany.mockReset();
  dispatchMock.mockReset();
  process.env.CRON_SECRET = SECRET;
});

function authedReq(url: string, body: unknown = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function unauthedReq(url: string): Request {
  return new Request(url, { method: 'POST' });
}

// ─── /api/cron/daily-salary wire (DAILY_WORKER_SALARY) ───

describe('POST /api/cron/daily-salary → DAILY_WORKER_SALARY', () => {
  it('settled.length > 0 → fire DAILY_WORKER_SALARY with summed totalAmount', async () => {
    computeDailyMock.mockResolvedValue({
      settled: [
        { workerId: 'w1', date: '2026-04-27', actualSalary: '120.50', machineType: 'HAND_PRESS', totalPieceworkAmount: '120.50', baseSalary: '0', taskCount: 1, orderCount: 1 },
        { workerId: 'w2', date: '2026-04-27', actualSalary: '80.00', machineType: 'WINDMILL', totalPieceworkAmount: '80.00', baseSalary: '0', taskCount: 2, orderCount: 1 },
        { workerId: 'w3', date: '2026-04-27', actualSalary: '0.50', machineType: 'GLUE', totalPieceworkAmount: '0.50', baseSalary: '0', taskCount: 1, orderCount: 1 },
      ],
      errors: [],
    });
    const res = await dailySalaryPost(
      authedReq('http://x/api/cron/daily-salary', { date: '2026-04-27' }),
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'DAILY_WORKER_SALARY',
      {
        date: '2026-04-27',
        workerCount: 3,
        // 千分位 + 不含 ¥（formatMoneyPlain；round 109 P2）
        totalAmount: '201.00',
      },
      { dedupeKey: 'notification:DAILY_WORKER_SALARY:2026-04-27' },
    );
  });

  it('settled empty → 不触发推送', async () => {
    computeDailyMock.mockResolvedValue({ settled: [], errors: [] });
    const res = await dailySalaryPost(
      authedReq('http://x/api/cron/daily-salary', { date: '2026-04-27' }),
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('401 / 503 路径 → 不触发推送', async () => {
    delete process.env.CRON_SECRET;
    const a = await dailySalaryPost(
      authedReq('http://x/api/cron/daily-salary'),
    );
    expect(a.status).toBe(503);

    process.env.CRON_SECRET = SECRET;
    const b = await dailySalaryPost(
      unauthedReq('http://x/api/cron/daily-salary'),
    );
    expect(b.status).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(computeDailyMock).not.toHaveBeenCalled();
  });

  it('Decimal sum 精度（0.1 + 0.2 + 0.3 = 0.60）', async () => {
    computeDailyMock.mockResolvedValue({
      settled: [
        { workerId: 'w1', date: '2026-04-27', actualSalary: '0.10', machineType: 'HAND_PRESS', totalPieceworkAmount: '0.10', baseSalary: '0', taskCount: 0, orderCount: 0 },
        { workerId: 'w2', date: '2026-04-27', actualSalary: '0.20', machineType: 'HAND_PRESS', totalPieceworkAmount: '0.20', baseSalary: '0', taskCount: 0, orderCount: 0 },
        { workerId: 'w3', date: '2026-04-27', actualSalary: '0.30', machineType: 'HAND_PRESS', totalPieceworkAmount: '0.30', baseSalary: '0', taskCount: 0, orderCount: 0 },
      ],
      errors: [],
    });
    await dailySalaryPost(
      authedReq('http://x/api/cron/daily-salary', { date: '2026-04-27' }),
    );
    const payload = dispatchMock.mock.calls[0]![1] as { totalAmount: string };
    expect(payload.totalAmount).toBe('0.60');
  });

  it('partial batch failure logs counts, withholds an incomplete aggregate notification, and retries', async () => {
    computeDailyMock.mockRejectedValue(
      new MockDailyBatchUnexpectedError({
        settled: [
          {
            workerId: 'w1',
            date: '2026-04-27',
            actualSalary: '120.50',
          },
        ],
        errors: [{ workerId: 'w-known', message: 'known business error' }],
      }),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await dailySalaryPost(
      authedReq('http://x/api/cron/daily-salary', { date: '2026-04-27' }),
    );

    expect(response.status).toBe(500);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[cron:daily-salary] unexpected failure after partial progress:',
      { committedCount: 1, businessErrorCount: 1 },
    );
    consoleError.mockRestore();
  });
});

// ─── /api/cron/cs-settle wire (CS_PERIOD_SETTLED, per-period) ───

describe('POST /api/cron/cs-settle → CS_PERIOD_SETTLED', () => {
  it('settled[N] → N 条 CS_PERIOD_SETTLED notify（每条 csName/totalSales/commission）', async () => {
    settleReadyCsMock.mockResolvedValue({
      settled: [
        {
          commissionId: 'c1',
          periodId: 'p1',
          csUserId: 'u1',
          totalSales: '300000.00',
          tierRate: '0.03',
          commissionAmount: '9000.00',
          monthlyBaseTotal: '20000.00',
          totalIncome: '29000.00',
          nextPeriodId: 'p1-next',
        },
        {
          commissionId: 'c2',
          periodId: 'p2',
          csUserId: 'u2',
          totalSales: '50000.00',
          tierRate: '0.005',
          commissionAmount: '250.00',
          monthlyBaseTotal: '20000.00',
          totalIncome: '20250.00',
          nextPeriodId: null,
        },
      ],
      errors: [],
    });
    dbMock.user.findMany.mockResolvedValue([
      { id: 'u1', displayName: 'CS 张' },
      { id: 'u2', displayName: 'CS 李' },
    ]);

    const res = await csSettlePost(authedReq('http://x/api/cron/cs-settle'));
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenNthCalledWith(
      1,
      'CS_PERIOD_SETTLED',
      {
        settledCount: 2,
        csName: 'CS 张',
        totalSales: '300,000.00',
        commission: '9,000.00',
      },
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:p1' },
    );
    expect(dispatchMock).toHaveBeenNthCalledWith(
      2,
      'CS_PERIOD_SETTLED',
      {
        settledCount: 2,
        csName: 'CS 李',
        totalSales: '50,000.00',
        commission: '250.00',
      },
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:p2' },
    );
  });

  it('settled empty → 不触发推送 + 不查 user', async () => {
    settleReadyCsMock.mockResolvedValue({ settled: [], errors: [] });
    const res = await csSettlePost(authedReq('http://x/api/cron/cs-settle'));
    expect(res.status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it('user 查不到（数据漂移）→ 用 csUserId 当 csName fallback，仍触发', async () => {
    settleReadyCsMock.mockResolvedValue({
      settled: [
        {
          commissionId: 'c1',
          periodId: 'p1',
          csUserId: 'ghost-user',
          totalSales: '100.00',
          tierRate: '0.005',
          commissionAmount: '0.50',
          monthlyBaseTotal: '0.00',
          totalIncome: '0.50',
          nextPeriodId: null,
        },
      ],
      errors: [],
    });
    dbMock.user.findMany.mockResolvedValue([]);
    await csSettlePost(authedReq('http://x/api/cron/cs-settle'));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const payload = dispatchMock.mock.calls[0]![1] as { csName: string };
    expect(payload.csName).toBe('ghost-user');
  });

  it('partial batch failure still queues notifications for committed periods before retrying', async () => {
    const settled = [
      {
        commissionId: 'c1',
        periodId: 'p1',
        csUserId: 'u1',
        totalSales: '300000.00',
        tierRate: '0.03',
        commissionAmount: '9000.00',
        monthlyBaseTotal: '20000.00',
        totalIncome: '29000.00',
        nextPeriodId: 'p1-next',
      },
    ];
    settleReadyCsMock.mockRejectedValue(
      new MockCsBatchUnexpectedError({ settled, errors: [] }),
    );
    dbMock.user.findMany.mockResolvedValue([
      { id: 'u1', displayName: 'CS 张' },
    ]);

    const response = await csSettlePost(
      authedReq('http://x/api/cron/cs-settle'),
    );

    expect(response.status).toBe(500);
    expect(dispatchMock).toHaveBeenCalledWith(
      'CS_PERIOD_SETTLED',
      expect.objectContaining({ csName: 'CS 张' }),
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:p1' },
    );
  });

  it('partial failure plus user lookup failure still notifies by user id and preserves retry', async () => {
    const settled = [
      {
        commissionId: 'c1',
        periodId: 'p1',
        csUserId: 'u1',
        totalSales: '300000.00',
        tierRate: '0.03',
        commissionAmount: '9000.00',
        monthlyBaseTotal: '20000.00',
        totalIncome: '29000.00',
        nextPeriodId: 'p1-next',
      },
    ];
    settleReadyCsMock.mockRejectedValue(
      new MockCsBatchUnexpectedError({ settled, errors: [] }),
    );
    dbMock.user.findMany.mockRejectedValue(new Error('database unavailable'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await csSettlePost(
      authedReq('http://x/api/cron/cs-settle'),
    );

    expect(response.status).toBe(500);
    expect(dispatchMock).toHaveBeenCalledWith(
      'CS_PERIOD_SETTLED',
      expect.objectContaining({ csName: 'u1' }),
      { dedupeKey: 'notification:CS_PERIOD_SETTLED:p1' },
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[cs-settle] user display-name lookup failed; using user ids:',
      'Error',
    );
    consoleError.mockRestore();
  });
});

// ─── /api/cron/outsource-overdue (NEW) ───

describe('POST /api/cron/outsource-overdue → OUTSOURCE_OVERDUE', () => {
  it('rows[N] → N 条 OUTSOURCE_OVERDUE notify', async () => {
    getOverdueOutsourcingMock.mockResolvedValue([
      {
        id: 'os1',
        supplierName: '阿福外协',
        expectedDate: new Date('2026-04-22T16:00:00Z'),
        status: 'IN_PROGRESS',
        orderNo: 'O-1',
        daysOverdue: 3,
      },
      {
        id: 'os2',
        supplierName: '甲乙外协',
        expectedDate: new Date('2026-04-23T16:00:00Z'),
        status: 'SENT',
        orderNo: null, // 独立外协
        daysOverdue: 2,
      },
    ]);
    const res = await outsourceOverduePost(
      authedReq('http://x/api/cron/outsource-overdue'),
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    const first = dispatchMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(first.outsourceId).toBe('os1');
    expect(first.supplierName).toBe('阿福外协');
    expect(first.orderNo).toBe('O-1');
    expect(first.daysOverdue).toBe(3);
    expect(first.expectedDate).toMatch(/2026/); // formatted date string
    expect(typeof first.expectedDate).toBe('string');
    const second = dispatchMock.mock.calls[1]![1] as Record<string, unknown>;
    expect(second.outsourceId).toBe('os2');
    expect(second.orderNo).toBeNull();
  });

  it('rows empty → 不触发', async () => {
    getOverdueOutsourcingMock.mockResolvedValue([]);
    const res = await outsourceOverduePost(
      authedReq('http://x/api/cron/outsource-overdue'),
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('401 / 503 路径', async () => {
    delete process.env.CRON_SECRET;
    expect(
      (await outsourceOverduePost(authedReq('http://x/api/cron/outsource-overdue'))).status,
    ).toBe(503);
    process.env.CRON_SECRET = SECRET;
    expect(
      (await outsourceOverduePost(unauthedReq('http://x/api/cron/outsource-overdue'))).status,
    ).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('lib 抛异常 → 500 通用错误，不泄漏 message', async () => {
    getOverdueOutsourcingMock.mockRejectedValue(new Error('connection lost'));
    const res = await outsourceOverduePost(
      authedReq('http://x/api/cron/outsource-overdue'),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).not.toContain('connection lost');
  });
});

// ─── /api/cron/cs-period-ending (NEW) ───

describe('POST /api/cron/cs-period-ending → CS_PERIOD_ENDING', () => {
  it('rows[N] → N 条 CS_PERIOD_ENDING notify（用 salesForTier 不是 totalSales）', async () => {
    getEndingPeriodsMock.mockResolvedValue([
      {
        id: 'p1',
        csUserId: 'u1',
        csDisplayName: 'CS 张',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-04-30T00:00:00Z'),
        durationMonths: 4,
        // 关键：totalSales=200k 但 initialSales=100k → salesForTier=300k
        // 命中最高档；只发 totalSales 会让消息&ldquo;业绩 200k&rdquo;但实际命中
        // 300k 档位的提成（Codex round 112 medium）。
        totalSales: '200000.00',
        initialSales: '100000.00',
        salesForTier: '300000.00',
        monthlyBase: '5000.00',
        daysUntilEnd: 3,
        predictedCommission: '9000.00',
        predictedTotalIncome: '29000.00',
        predictedBelowAllTiers: false,
      },
    ]);
    const res = await csPeriodEndingPost(
      authedReq('http://x/api/cron/cs-period-ending'),
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      'CS_PERIOD_ENDING',
      {
        periodId: 'p1',
        csName: 'CS 张',
        daysLeft: 3,
        // **salesForTier 千分位**，不是 totalSales 千分位
        totalSales: '300,000.00',
      },
      {
        dedupeKey: expect.stringMatching(
          /^notification:CS_PERIOD_ENDING:\d{4}-\d{2}-\d{2}:p1$/,
        ),
        // 批量扇出按循环下标摊开 availableAt，压在企业微信 20 条/分钟
        // 之下（lib/background-jobs/notification.ts FANOUT_SPACING_MS）。
        // 第一条是 0，不会被推迟。
        spreadIndex: 0,
      },
    );
  });

  it('rows empty → 不触发', async () => {
    getEndingPeriodsMock.mockResolvedValue([]);
    await csPeriodEndingPost(
      authedReq('http://x/api/cron/cs-period-ending'),
    );
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('401 路径', async () => {
    expect(
      (await csPeriodEndingPost(unauthedReq('http://x/api/cron/cs-period-ending')))
        .status,
    ).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

// ─── /api/cron/order-overdue (ORDER_OVERDUE，业主 2026-07-07 新增) ───

describe('POST /api/cron/order-overdue → ORDER_OVERDUE', () => {
  // 「due-soon 不进群」现在由 SQL 边界保证，断言在
  // lib/order/__tests__/overdue-scan.test.ts（where.promisedDate.lt =
  // 今日上海日界）。这里只管：拿到多少推多少、payload 映射、截断透传。
  const overdueRow = (over: Record<string, unknown> = {}) => ({
    id: 'o1',
    orderNo: '20260701-0001',
    customerRef: '苹果福',
    status: 'IN_PRODUCTION',
    promisedDate: new Date('2026-07-04T00:00:00Z'),
    daysOverdue: 3,
    ...over,
  });

  it('扫描结果逐条推送（不再在 JS 里过滤）', async () => {
    scanOverdueOrdersMock.mockResolvedValue({
      rows: [
        overdueRow(),
        overdueRow({ id: 'o2', orderNo: '20260701-0002', daysOverdue: 1 }),
      ],
      truncated: false,
    });
    const res = await orderOverduePost(
      authedReq('http://x/api/cron/order-overdue'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      overdueCount: 2,
      truncated: false,
    });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    const [event, payload] = dispatchMock.mock.calls[0]!;
    expect(event).toBe('ORDER_OVERDUE');
    const p = payload as Record<string, unknown>;
    expect(p.orderNo).toBe('20260701-0001');
    expect(p.customerRef).toBe('苹果福');
    expect(p.daysOverdue).toBe(3);
    expect(p.status).toBe('生产中'); // 中文标签，不是裸枚举
    expect(p.promisedDate).toMatch(/2026\/07\/04/);
  });

  it('撞到 fan-out 上限：已取回的仍然推，响应带 truncated，日志不含工单号', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    scanOverdueOrdersMock.mockResolvedValue({
      rows: [overdueRow()],
      truncated: true,
    });
    const res = await orderOverduePost(
      authedReq('http://x/api/cron/order-overdue'),
    );
    expect(await res.json()).toEqual({
      status: 'ok',
      overdueCount: 1,
      truncated: true,
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain(
      '20260701-0001',
    );
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('苹果福');
    errorSpy.mockRestore();
  });

  it('customerRef null → 映射为「未填」（模板必填占位符不留 raw）', async () => {
    scanOverdueOrdersMock.mockResolvedValue({
      rows: [overdueRow({ customerRef: null })],
      truncated: false,
    });
    await orderOverduePost(authedReq('http://x/api/cron/order-overdue'));
    const p = dispatchMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(p.customerRef).toBe('未填');
  });

  it('401 / 503 / 500 路径', async () => {
    delete process.env.CRON_SECRET;
    expect(
      (await orderOverduePost(authedReq('http://x/api/cron/order-overdue'))).status,
    ).toBe(503);
    process.env.CRON_SECRET = SECRET;
    expect(
      (await orderOverduePost(unauthedReq('http://x/api/cron/order-overdue'))).status,
    ).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();

    scanOverdueOrdersMock.mockRejectedValue(new Error('db down: secret detail'));
    const res = await orderOverduePost(
      authedReq('http://x/api/cron/order-overdue'),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).not.toMatch(/secret detail/);
  });
});
