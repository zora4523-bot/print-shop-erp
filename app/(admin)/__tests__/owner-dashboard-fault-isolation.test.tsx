import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requirePermissionMock,
  getTodayOrderStatsMock,
  getMonthlyBillStatsMock,
  getPendingShipmentsMock,
  getOverdueOutsourcingMock,
  getDueOrdersMock,
  getRecentOverReportsMock,
  getEndingPeriodsMock,
  getProductionTrendMock,
  getSalesRankingMock,
  getCategoryDistributionMock,
  countRecentFailuresMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getTodayOrderStatsMock: vi.fn(),
  getMonthlyBillStatsMock: vi.fn(),
  getPendingShipmentsMock: vi.fn(),
  getOverdueOutsourcingMock: vi.fn(),
  getDueOrdersMock: vi.fn(),
  getRecentOverReportsMock: vi.fn(),
  getEndingPeriodsMock: vi.fn(),
  getProductionTrendMock: vi.fn(),
  getSalesRankingMock: vi.fn(),
  getCategoryDistributionMock: vi.fn(),
  countRecentFailuresMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/dashboard/owner-stats', () => ({
  getTodayOrderStats: getTodayOrderStatsMock,
  getMonthlyBillStats: getMonthlyBillStatsMock,
}));

vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getPendingShipments: getPendingShipmentsMock,
  getOverdueOutsourcing: getOverdueOutsourcingMock,
  getDueOrders: getDueOrdersMock,
  getRecentOverReports: getRecentOverReportsMock,
  getEndingPeriods: getEndingPeriodsMock,
  OVER_REPORT_WINDOW_DAYS: 7,
}));

vi.mock('@/lib/dashboard/owner-charts', () => ({
  getProductionTrend: getProductionTrendMock,
  getSalesRanking: getSalesRankingMock,
  getCategoryDistribution: getCategoryDistributionMock,
}));

vi.mock('@/lib/notification/admin', () => ({
  countRecentFailures: countRecentFailuresMock,
}));

import OwnerDashboardPage, {
  CategoryDistributionChartSection,
  DashboardQueueSection,
  ProductionTrendChartSection,
  SalesRankingChartSection,
} from '@/app/(admin)/owner/page';

const pagePath = join(
  process.cwd(),
  'app/(admin)/owner/page.tsx',
);

function neverSettles(): Promise<never> {
  return new Promise(() => undefined);
}

function findElement(
  node: ReactNode,
  predicate: (props: Record<string, unknown>) => boolean,
): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => findElement(child, predicate));
  }
  if (!isValidElement(node)) return false;

  const props = node.props as Record<string, unknown>;
  if (predicate(props)) return true;
  return findElement(props.children as ReactNode, predicate);
}

beforeEach(() => {
  requirePermissionMock.mockReset();
  getTodayOrderStatsMock.mockReset();
  getMonthlyBillStatsMock.mockReset();
  getPendingShipmentsMock.mockReset();
  getOverdueOutsourcingMock.mockReset();
  getDueOrdersMock.mockReset();
  getRecentOverReportsMock.mockReset();
  getEndingPeriodsMock.mockReset();
  getProductionTrendMock.mockReset();
  getSalesRankingMock.mockReset();
  getCategoryDistributionMock.mockReset();
  countRecentFailuresMock.mockReset();

  requirePermissionMock.mockResolvedValue({
    id: 'admin-1',
    displayName: '店主',
  });

  getProductionTrendMock.mockResolvedValue([]);
  getSalesRankingMock.mockResolvedValue([]);
  getCategoryDistributionMock.mockResolvedValue([]);
  for (const read of [
    getTodayOrderStatsMock,
    getMonthlyBillStatsMock,
    getPendingShipmentsMock,
    getOverdueOutsourcingMock,
    getDueOrdersMock,
    getRecentOverReportsMock,
    getEndingPeriodsMock,
    countRecentFailuresMock,
  ]) {
    read.mockReturnValue(neverSettles());
  }
});

describe('owner dashboard fault isolation', () => {
  it('returns the static shell without waiting for dashboard reads', async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      OwnerDashboardPage(),
      new Promise<'timed-out'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timed-out'), 500);
      }),
    ]);
    clearTimeout(timeoutId);

    expect(result).not.toBe('timed-out');
    if (result === 'timed-out') return;

    expect(
      findElement(
        result,
        (props) => props.children === 'Dashboard',
      ),
    ).toBe(true);
    expect(
      findElement(
        result,
        (props) => props['data-slot'] === 'dashboard-shortcuts',
      ),
    ).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock).toHaveBeenCalledWith('report:all');

    for (const read of [
      getTodayOrderStatsMock,
      getMonthlyBillStatsMock,
      getPendingShipmentsMock,
      getOverdueOutsourcingMock,
      getDueOrdersMock,
      getRecentOverReportsMock,
      getEndingPeriodsMock,
      countRecentFailuresMock,
    ]) {
      expect(read).toHaveBeenCalledOnce();
      expect(requirePermissionMock.mock.invocationCallOrder[0]).toBeLessThan(
        read.mock.invocationCallOrder[0]!,
      );
    }
  });

  it('keeps every independent consumer under a local error and loading boundary', () => {
    const page = readFileSync(pagePath, 'utf8');

    for (const call of [
      'getTodayOrderStats()',
      'getMonthlyBillStats()',
      'getPendingShipments()',
      'getOverdueOutsourcing()',
      'getDueOrders()',
      'getRecentOverReports()',
      'getEndingPeriods()',
      'countRecentFailures(24)',
      'getProductionTrend()',
      'getSalesRanking()',
      'getCategoryDistribution()',
    ]) {
      expect(page.split(call)).toHaveLength(2);
    }

    expect(page.indexOf("await requirePermission('report:all')")).toBeLessThan(
      page.indexOf('const todayPromise = getTodayOrderStats()'),
    );
    expect(page.indexOf('<h1')).toBeLessThan(page.indexOf('<ErrorBoundary'));
    expect(page).toContain('data-slot="dashboard-shortcuts"');
    expect(page.match(/<ErrorBoundary/g)).toHaveLength(12);
    expect(page.match(/<Suspense/g)).toHaveLength(12);

    for (const section of [
      'DashboardHeaderMetadata',
      'DashboardQueueSection',
      'TodayStatsSection',
      'MonthlyStatsSection',
      'PendingShipmentsWatchlist',
      'OverdueOutsourcingWatchlist',
      'DueOrdersWatchlist',
      'OverReportsWatchlist',
      'EndingPeriodsWatchlist',
      'ProductionTrendChartSection',
      'SalesRankingChartSection',
      'CategoryDistributionChartSection',
    ]) {
      const usage = page.indexOf(`<${section}`);
      expect(usage).toBeGreaterThan(-1);
      expect(page.lastIndexOf('<ErrorBoundary', usage)).toBeGreaterThan(-1);
      expect(page.lastIndexOf('<Suspense', usage)).toBeGreaterThan(-1);
    }

    expect(page).not.toMatch(/const \[\s*today,\s*monthly,/);
    expect(page).not.toMatch(/\bcatch\s*\(/);
  });

  it('surfaces recent notification failures as an actionable queue entry', async () => {
    const result = await DashboardQueueSection({
      todayPromise: Promise.resolve({
        date: '2026-09-02',
        submittedToday: 0,
        urgentSubmittedToday: 0,
        completedToday: 0,
        completedYesterday: 0,
        shippedToday: 0,
      }),
      pendingShipmentsPromise: Promise.resolve({ rows: [], hasMore: false }),
      overdueOutsourcingPromise: Promise.resolve([]),
      dueOrdersPromise: Promise.resolve({
        rows: [],
        total: 0,
        promisedThroughYmd: '2026-09-05',
      }),
      overReportsPromise: Promise.resolve({
        rows: [],
        total: 0,
        sinceYmd: '2026-08-27',
      }),
      endingPeriodsPromise: Promise.resolve([]),
      recentNotificationFailuresPromise: Promise.resolve(3),
    });

    expect(isValidElement(result)).toBe(true);
    if (!isValidElement(result)) return;

    const items = (result.props as { items: Array<Record<string, unknown>> })
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'notification-failures',
      kind: '推送异常',
      countLabel: '3',
      dueUrgent: true,
      href: '/owner/notifications',
      actionLabel: '去处理',
    });
  });

  it('does not add a notification queue entry when the recent count is zero', async () => {
    const result = await DashboardQueueSection({
      todayPromise: Promise.resolve({
        date: '2026-09-02',
        submittedToday: 0,
        urgentSubmittedToday: 0,
        completedToday: 0,
        completedYesterday: 0,
        shippedToday: 0,
      }),
      pendingShipmentsPromise: Promise.resolve({ rows: [], hasMore: false }),
      overdueOutsourcingPromise: Promise.resolve([]),
      dueOrdersPromise: Promise.resolve({
        rows: [],
        total: 0,
        promisedThroughYmd: '2026-09-05',
      }),
      overReportsPromise: Promise.resolve({
        rows: [],
        total: 0,
        sinceYmd: '2026-08-27',
      }),
      endingPeriodsPromise: Promise.resolve([]),
      recentNotificationFailuresPromise: Promise.resolve(0),
    });

    expect(isValidElement(result)).toBe(true);
    if (!isValidElement(result)) return;
    expect((result.props as { items: unknown[] }).items).toEqual([]);
  });

  it('lets healthy charts render when a sibling chart read fails', async () => {
    const trendFailure = new Error('trend read failed');
    getProductionTrendMock.mockRejectedValueOnce(trendFailure);
    getSalesRankingMock.mockResolvedValueOnce([
      { userId: 'sales-1', displayName: '销售甲', role: 'SALES', amount: 12 },
    ]);
    getCategoryDistributionMock.mockResolvedValueOnce([
      { categoryId: 'category-1', categoryName: '红包', count: 3 },
    ]);

    const trendResult = ProductionTrendChartSection();
    await expect(SalesRankingChartSection()).resolves.toBeDefined();
    await expect(CategoryDistributionChartSection()).resolves.toBeDefined();
    await expect(trendResult).rejects.toBe(trendFailure);

    expect(getProductionTrendMock).toHaveBeenCalledOnce();
    expect(getSalesRankingMock).toHaveBeenCalledOnce();
    expect(getCategoryDistributionMock).toHaveBeenCalledOnce();
  });
});
