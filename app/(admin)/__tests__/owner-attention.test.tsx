import { isValidElement, Suspense, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ui-business';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { WatchlistTable } from '@/components/business/dashboard/WatchlistTable';
import { DashboardSectionLoading } from '@/components/business/dashboard/DashboardSectionLoading';
import { ATTENTION_PAGE_SIZE, ATTENTION_TITLES, type AttentionKind } from '@/lib/dashboard/attention';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  due: vi.fn(),
  shipments: vi.fn(),
  outsource: vi.fn(),
  'over-reports': vi.fn(),
  settlements: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({
  getDueOrders: mocks.due,
  getPendingShipments: mocks.shipments,
  getOverdueOutsourcing: mocks.outsource,
  getRecentOverReports: mocks['over-reports'],
  getEndingPeriods: mocks.settlements,
}));

import OwnerAttentionPage from '../owner/attention/page';
import { AttentionContent } from '@/components/business/dashboard/OwnerAttentionContent';

const kinds: AttentionKind[] = ['due', 'shipments', 'outsource', 'over-reports', 'settlements'];
const paginatedKinds = ['due', 'shipments', 'over-reports'] as const;
const fullListKinds = ['outsource', 'settlements'] as const;

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...findElements(node.props.children as ReactNode, predicate),
  ];
}

function selectedContent(node: ReactNode) {
  const content = findElements(node, (element) => element.type === AttentionContent)[0];
  expect(content).toBeDefined();
  return content!;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  for (const kind of paginatedKinds) {
    mocks[kind].mockResolvedValue({
      rows: [], total: 0, page: 1, pageCount: 1, pageSize: ATTENTION_PAGE_SIZE,
      hasMore: false, sinceYmd: '2026-09-01', promisedThroughYmd: '2026-09-10',
    });
  }
  for (const kind of fullListKinds) mocks[kind].mockResolvedValue([]);
});

describe('管理员完整关注列表', () => {
  it('权限通过后才提供读取区域，慢查询不阻塞页面壳', async () => {
    const shell = await OwnerAttentionPage({ searchParams: Promise.resolve({ kind: 'due' }) });
    expect(mocks.permission).toHaveBeenCalledWith('report:all');
    for (const kind of kinds) expect(mocks[kind]).not.toHaveBeenCalled();
    expect(selectedContent(shell).props).toMatchObject({ kind: 'due', page: 1 });

    await AttentionContent({ kind: 'due', page: 1 });
    expect(mocks.permission.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.due.mock.invocationCallOrder[0]);
  });

  it('未授权时拒绝页面，不读取任何关注数据', async () => {
    const forbidden = new Error('forbidden');
    mocks.permission.mockRejectedValueOnce(forbidden);
    await expect(OwnerAttentionPage({ searchParams: Promise.resolve({ kind: 'shipments' }) }))
      .rejects.toBe(forbidden);
    for (const kind of kinds) expect(mocks[kind]).not.toHaveBeenCalled();
  });

  it.each([undefined, 'unknown', '../orders', []])('未知分类 %j 回退到交期预警', async (kind) => {
    const shell = await OwnerAttentionPage({ searchParams: Promise.resolve({ kind }) });
    expect(selectedContent(shell).props.kind).toBe('due');
    const active = findElements(shell, (element) => element.props['aria-current'] === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]?.props.href).toBe('/owner/attention?kind=due');
  });

  it('重复参数采用第一项，分类切换清除旧页码', async () => {
    const shell = await OwnerAttentionPage({
      searchParams: Promise.resolve({ kind: ['shipments', 'due'], page: ['2', '999'] }),
    });
    expect(selectedContent(shell).props).toMatchObject({ kind: 'shipments', page: 2 });
    const nav = findElements(shell, (element) => element.props['aria-label'] === '关注事项分类')[0];
    const links = findElements(nav, (element) => typeof element.props.href === 'string');
    expect(links.map((link) => link.props.href)).toEqual(kinds.map((kind) => `/owner/attention?kind=${kind}`));
  });

  it.each([undefined, 'invalid', '0', '-4'])('无效页码 %j 从第一页读取', async (page) => {
    const shell = await OwnerAttentionPage({ searchParams: Promise.resolve({ kind: 'due', page }) });
    expect(selectedContent(shell).props.page).toBe(1);
  });

  it.each(paginatedKinds)('%s 向领域查询传递固定页大小与请求页，并采用领域返回的安全页码', async (kind) => {
    const rows = [{ id: `${kind}-last-row` }];
    mocks[kind].mockResolvedValueOnce({
      rows, total: 41, page: 3, pageCount: 3, pageSize: ATTENTION_PAGE_SIZE,
      sinceYmd: '2026-09-01', promisedThroughYmd: '2026-09-10', hasMore: false,
    });
    const content = await AttentionContent({ kind, page: 999 });
    expect(mocks[kind]).toHaveBeenCalledWith(expect.any(Date), ATTENTION_PAGE_SIZE, 999);
    for (const other of kinds.filter((value) => value !== kind)) expect(mocks[other]).not.toHaveBeenCalled();
    const table = findElements(content, (element) => element.type === WatchlistTable)[0];
    expect(table?.props.rows).toBe(rows);
    expect(table?.props.title).toBe(ATTENTION_TITLES[kind]);
    if (kind === 'over-reports') expect(table?.props.description).toBe('自 2026-09-01 起');
    const pagination = findElements(content, (element) => element.type === AdminPagination)[0];
    expect(pagination?.props).toMatchObject({ total: 41, page: 3, pageCount: 3, pageSize: 20, queryParams: { kind } });
    const html = renderToStaticMarkup(pagination);
    expect(html).toContain(`href="/owner/attention?kind=${kind}&amp;page=2"`);
    expect(html).not.toContain('page=1000');
  });

  it.each(fullListKinds)('%s 对完整数据在服务端分页，超界请求收敛到末页', async (kind) => {
    const rows = Array.from({ length: 43 }, (_, index) => ({ id: `${kind}-${index}` }));
    mocks[kind].mockResolvedValueOnce(rows);
    const content = await AttentionContent({ kind, page: 999 });
    expect(mocks[kind]).toHaveBeenCalledWith(expect.any(Date));
    for (const other of kinds.filter((value) => value !== kind)) expect(mocks[other]).not.toHaveBeenCalled();
    const table = findElements(content, (element) => element.type === WatchlistTable)[0];
    expect(table?.props.rows).toEqual(rows.slice(40));
    expect(table?.props.title).toBe(ATTENTION_TITLES[kind]);
    const pagination = findElements(content, (element) => element.type === AdminPagination)[0];
    expect(pagination?.props).toMatchObject({ total: 43, page: 3, pageCount: 3, pageSize: 20, queryParams: { kind } });
    expect(renderToStaticMarkup(pagination)).toContain(`href="/owner/attention?kind=${kind}&amp;page=2"`);
    expect(rows).toHaveLength(43);
  });

  it.each(fullListKinds)('%s 的空列表保留第一页且没有无效翻页链接', async (kind) => {
    const content = await AttentionContent({ kind, page: 999 });
    const pagination = findElements(content, (element) => element.type === AdminPagination)[0];
    expect(pagination?.props).toMatchObject({ total: 0, page: 1, pageCount: 1 });
    expect(renderToStaticMarkup(pagination)).not.toContain('href=');
  });

  it('中间页的前后翻页链接都保留当前分类', async () => {
    mocks.outsource.mockResolvedValueOnce(Array.from({ length: 43 }, (_, index) => ({ id: `outsource-${index}` })));
    const content = await AttentionContent({ kind: 'outsource', page: 2 });
    const pagination = findElements(content, (element) => element.type === AdminPagination)[0];
    const html = renderToStaticMarkup(pagination);
    expect(html).toContain('href="/owner/attention?kind=outsource&amp;page=1"');
    expect(html).toContain('href="/owner/attention?kind=outsource&amp;page=3"');
  });

  it.each(kinds)('%s 读取失败向所属错误边界抛出，不伪装为空态', async (kind) => {
    const failure = new Error(`${kind} unavailable`);
    mocks[kind].mockRejectedValueOnce(failure);
    const shell = await OwnerAttentionPage({ searchParams: Promise.resolve({ kind, page: '2' }) });
    const boundary = findElements(shell, (element) => element.type === ErrorBoundary)[0];
    expect(boundary?.key).toBe(`${kind}:2`);
    expect(boundary?.props).toMatchObject({ scope: 'section', title: `${ATTENTION_TITLES[kind]}暂时无法加载` });
    const suspense = findElements(boundary, (element) => element.type === Suspense)[0];
    const loading = findElements(suspense?.props.fallback as ReactNode, (element) => element.type === DashboardSectionLoading)[0];
    expect(loading?.props.label).toBe(ATTENTION_TITLES[kind]);
    expect(selectedContent(boundary).props).toMatchObject({ kind, page: 2 });
    await expect(AttentionContent({ kind, page: 2 })).rejects.toBe(failure);
  });
});
