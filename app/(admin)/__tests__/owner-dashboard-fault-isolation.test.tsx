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
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getTodayOrderStatsMock: vi.fn(),
  getMonthlyBillStatsMock: vi.fn(),
  getPendingShipmentsMock: vi.fn(),
  getOverdueOutsourcingMock: vi.fn(),
  getDueOrdersMock: vi.fn(),
  getRecentOverReportsMock: vi.fn(),
  getEndingPeriodsMock: vi.fn(),
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
  getProductionTrend: vi.fn(),
  getSalesRanking: vi.fn(),
  getCategoryDistribution: vi.fn(),
}));

import OwnerDashboardPage from '@/app/(admin)/owner/page';

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

  requirePermissionMock.mockResolvedValue({
    id: 'admin-1',
    displayName: '店主',
  });
  for (const read of [
    getTodayOrderStatsMock,
    getMonthlyBillStatsMock,
    getPendingShipmentsMock,
    getOverdueOutsourcingMock,
    getDueOrdersMock,
    getRecentOverReportsMock,
    getEndingPeriodsMock,
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
    ]) {
      expect(page.split(call)).toHaveLength(2);
    }

    expect(page.indexOf("await requirePermission('report:all')")).toBeLessThan(
      page.indexOf('const todayPromise = getTodayOrderStats()'),
    );
    expect(page.indexOf('<h1')).toBeLessThan(page.indexOf('<ErrorBoundary'));
    expect(page).toContain('data-slot="dashboard-shortcuts"');
    expect(page.match(/<ErrorBoundary/g)).toHaveLength(10);
    expect(page.match(/<Suspense/g)).toHaveLength(10);

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
      'DashboardChartsSection',
    ]) {
      const usage = page.indexOf(`<${section}`);
      expect(usage).toBeGreaterThan(-1);
      expect(page.lastIndexOf('<ErrorBoundary', usage)).toBeGreaterThan(-1);
      expect(page.lastIndexOf('<Suspense', usage)).toBeGreaterThan(-1);
    }

    expect(page).not.toMatch(/const \[\s*today,\s*monthly,/);
    expect(page).not.toMatch(/\bcatch\s*\(/);
  });
});
