import { isValidElement, Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), sales: vi.fn(), crafts: vi.fn(), read: vi.fn(), orders: vi.fn(), trend: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/analytics/overview', () => ({ getAnalyticsOverview: async () => ({ metrics: [], ranking: [], distribution: [] }) }));
vi.mock('@/lib/analytics/queries', () => ({ getAnalyticsSales: mocks.sales, getAnalyticsCrafts: mocks.crafts, analyticsRead: mocks.read, readOrders: mocks.orders, getAnalyticsTrend: mocks.trend, getAnalyticsFinance: vi.fn() }));
import Page from '@/app/(admin)/owner/analytics/page';
import { OwnerAnalytics, ProductionTrendChartSection, SalesRankingChartSection, CategoryDistributionChartSection } from '@/components/business/dashboard/OwnerAnalytics';
import { ErrorBoundary, PageHeader } from '@/components/ui-business';
import { parseAnalyticsFilters } from '@/lib/analytics/filters';
function find(node: ReactNode, type: unknown): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(child => find(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...find(node.props.children as ReactNode, type)];
}
const actor = { id: 'admin', role: Role.ADMIN };
const filters = parseAnalyticsFilters({});
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue(actor); mocks.sales.mockResolvedValue([]); mocks.crafts.mockResolvedValue([]); mocks.read.mockResolvedValue([]); });
describe('analytics page boundaries', () => {
  it('authenticates before data and keeps the breadcrumb return contract', async () => {
    const result = await Page({ searchParams: Promise.resolve({}) });
    expect(mocks.permission).toHaveBeenCalledWith('report:all');
    expect(find(result, PageHeader)[0]?.props).toMatchObject({ title: '经营概览' });
    expect(find(result, PageHeader)[0]?.props.back).toBeUndefined();
    expect(find(result, OwnerAnalytics)).toHaveLength(1);
    expect(mocks.trend).not.toHaveBeenCalled();
  });
  it('blocks all option and report reads for unauthorized users', async () => {
    mocks.permission.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('Forbidden');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.crafts).not.toHaveBeenCalled(); expect(mocks.sales).not.toHaveBeenCalled();
  });
  it('shows a recoverable validation state before querying', async () => {
    const result = await Page({ searchParams: Promise.resolve({ from: '2026-02-30' }) });
    expect(find(result, 'p')[0]?.props.role).toBe('alert');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.crafts).not.toHaveBeenCalled();
  });
  it('isolates summary and all three charts with loading/error states', () => {
    const boundaries = find(OwnerAnalytics({ actor, filters }), ErrorBoundary);
    expect(boundaries).toHaveLength(4);
    for (const boundary of boundaries) { expect(boundary.props.scope).toBe('section'); expect(find(boundary.props.children as ReactNode, Suspense)[0]?.props.fallback).toBeDefined(); }
  });
  it('a trend failure does not replace the other charts with zero', async () => {
    mocks.trend.mockRejectedValueOnce(new Error('db unavailable'));
    const results = await Promise.allSettled([ProductionTrendChartSection({ actor, filters }), SalesRankingChartSection({ actor, filters }), CategoryDistributionChartSection({ actor, filters })]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });
});
