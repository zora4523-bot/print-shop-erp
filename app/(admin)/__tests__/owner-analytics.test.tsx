import { isValidElement, Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  requirePermissionMock,
  getProductionTrendMock,
  getSalesRankingMock,
  getCategoryDistributionMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getProductionTrendMock: vi.fn(),
  getSalesRankingMock: vi.fn(),
  getCategoryDistributionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/dashboard/owner-charts', () => ({
  getProductionTrend: getProductionTrendMock,
  getSalesRanking: getSalesRankingMock,
  getCategoryDistribution: getCategoryDistributionMock,
}));

import OwnerAnalyticsPage from '@/app/(admin)/owner/analytics/page';
import {
  CategoryDistributionChartSection,
  OwnerAnalytics,
  ProductionTrendChartSection,
  SalesRankingChartSection,
} from '@/components/business/dashboard/OwnerAnalytics';
import { ErrorBoundary, PageHeader } from '@/components/ui-business';

function findElements(
  node: ReactNode,
  predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...findElements(node.props.children as ReactNode, predicate),
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
});

describe('经营概览页面', () => {
  it('验证权限后返回静态标题和返回入口，图表查询不阻塞页面壳', async () => {
    const result = await OwnerAnalyticsPage();
    expect(requirePermissionMock).toHaveBeenCalledWith('report:all');
    const header = findElements(result, (element) => element.type === PageHeader)[0];
    expect(header?.props.title).toBe('经营概览');
    const links = findElements(header?.props.actions as ReactNode, (element) => element.props.href === '/owner');
    expect(links).toHaveLength(1);
    expect(findElements(result, (element) => element.type === OwnerAnalytics)).toHaveLength(1);
    expect(getProductionTrendMock).not.toHaveBeenCalled();
    expect(getSalesRankingMock).not.toHaveBeenCalled();
    expect(getCategoryDistributionMock).not.toHaveBeenCalled();
  });

  it('未授权时拒绝整个页面，不读取经营数据', async () => {
    const forbidden = new Error('Forbidden');
    requirePermissionMock.mockRejectedValueOnce(forbidden);
    await expect(OwnerAnalyticsPage()).rejects.toBe(forbidden);
    expect(getProductionTrendMock).not.toHaveBeenCalled();
    expect(getSalesRankingMock).not.toHaveBeenCalled();
    expect(getCategoryDistributionMock).not.toHaveBeenCalled();
  });

  it('每张图表各有失败边界及加载占位，失败不会冒充空态', () => {
    const boundaries = findElements(OwnerAnalytics(), (element) => element.type === ErrorBoundary);
    expect(boundaries).toHaveLength(3);
    const sections = [ProductionTrendChartSection, SalesRankingChartSection, CategoryDistributionChartSection];
    for (const [index, boundary] of boundaries.entries()) {
      expect(boundary.props.scope).toBe('section');
      expect(boundary.props.title).toContain('暂时无法加载');
      const suspense = findElements(boundary.props.children as ReactNode, (element) => element.type === Suspense);
      expect(suspense).toHaveLength(1);
      expect(suspense[0]?.props.fallback).toBeDefined();
      expect(findElements(suspense[0]?.props.children as ReactNode, (element) => element.type === sections[index])).toHaveLength(1);
    }
  });

  it('保留原始图表数据与金额字符串，不在迁移层改写口径', async () => {
    const trend = [{ day: '2026-09-07', count: 12 }];
    const ranking = [{ userId: 'sales-1', displayName: '销售甲', role: Role.SALES, totalAmount: '1234567.89', orderCount: 4 }];
    const categories = [{ category: 'UNCATEGORIZED', orderCount: 2 }];
    getProductionTrendMock.mockResolvedValueOnce(trend);
    getSalesRankingMock.mockResolvedValueOnce(ranking);
    getCategoryDistributionMock.mockResolvedValueOnce(categories);

    expect((await ProductionTrendChartSection()).props.data).toBe(trend);
    expect((await SalesRankingChartSection()).props.data).toBe(ranking);
    expect((await CategoryDistributionChartSection()).props.data).toBe(categories);
  });

  it('单个图表读取失败时，其余图表仍能返回', async () => {
    const failure = new Error('trend read failed');
    getProductionTrendMock.mockRejectedValueOnce(failure);
    getSalesRankingMock.mockResolvedValueOnce([]);
    getCategoryDistributionMock.mockResolvedValueOnce([]);

    const results = await Promise.allSettled([
      ProductionTrendChartSection(),
      SalesRankingChartSection(),
      CategoryDistributionChartSection(),
    ]);
    expect(results[0]).toEqual({ status: 'rejected', reason: failure });
    expect(results[1]?.status).toBe('fulfilled');
    expect(results[2]?.status).toBe('fulfilled');
  });
});
