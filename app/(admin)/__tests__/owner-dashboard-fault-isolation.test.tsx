import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '@/components/ui-business';

vi.mock('@/components/business/dashboard/OrderAttentionSection', () => ({ OrderAttentionSection: () => null, OrderAttentionLoading: () => null }));
const mocks = vi.hoisted(() => ({
  permission: vi.fn(), today: vi.fn(), monthly: vi.fn(), shipments: vi.fn(), outsource: vi.fn(), due: vi.fn(), overReports: vi.fn(), failures: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/dashboard/owner-stats', () => ({ getTodayOrderStats: mocks.today, getMonthlyBillStats: mocks.monthly }));
vi.mock('@/lib/dashboard/owner-watchlist', () => ({ getPendingShipments: mocks.shipments, getOverdueOutsourcing: mocks.outsource, getDueOrders: mocks.due, getRecentOverReports: mocks.overReports }));
vi.mock('@/lib/notification/admin', () => ({ countRecentFailures: mocks.failures }));
import OwnerDashboardPage from '../owner/page';
import { NotificationAttention } from '@/components/business/dashboard/NotificationAttention';
import { DueOrdersWatchlist, PendingShipmentsWatchlist } from '@/components/business/dashboard/OwnerWatchlists';

const reads = [mocks.today, mocks.monthly, mocks.shipments, mocks.outsource, mocks.due, mocks.overReports, mocks.failures];
function visit(node: ReactNode, predicate: (node: React.ReactElement<Record<string, unknown>>) => boolean): boolean {
  if (Array.isArray(node)) return node.some(child => visit(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return false;
  return predicate(node) || visit(node.props.children as ReactNode, predicate);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  for (const read of reads) read.mockReturnValue(new Promise(() => undefined));
});
describe('owner dashboard fault isolation', () => {
  it('returns the shell before slow reads settle and checks permission first', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([OwnerDashboardPage(), new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 500); })]);
    clearTimeout(timer);
    expect(result).not.toBe('timeout');
    expect(visit(result, node => node.props['data-slot'] === 'dashboard-shortcuts')).toBe(true);
    expect(mocks.permission).toHaveBeenCalledWith('report:all');
    for (const read of reads) {
      expect(read).toHaveBeenCalledOnce();
      expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
    }
    const labels = ['工单待办', '推送异常', '交期预警', '待发货工单', '超期外协', '超计划报工记录', '今日工单指标', '本月已出账金额'];
    for (const label of labels) {
      expect(visit(result, node => node.type === ErrorBoundary && node.props.title === `${label}暂时无法加载`)).toBe(true);
    }
  });
  it('does not read business data without authorization', async () => {
    mocks.permission.mockRejectedValueOnce(new Error('forbidden'));
    await expect(OwnerDashboardPage()).rejects.toThrow('forbidden');
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });
  it('keeps healthy watchlists available when a sibling fails', async () => {
    await expect(DueOrdersWatchlist({ resultPromise: Promise.reject(new Error('unavailable')) })).rejects.toThrow('unavailable');
    const healthy = await PendingShipmentsWatchlist({ now: new Date('2026-09-07T00:00:00Z'), resultPromise: Promise.resolve({ rows: [], total: 0, hasMore: false, page: 1, pageCount: 1, pageSize: 3 }) });
    expect(renderToStaticMarkup(healthy)).toContain('暂无待发货工单');
  });
  it('shows actionable notification failures once, without a fake grand total', async () => {
    const html = renderToStaticMarkup(await NotificationAttention({ countPromise: Promise.resolve(3) }));
    expect(html).toContain('3');
    expect(html).toContain('href="/owner/notifications"');
    expect(html).not.toContain('今天要处理');
    await expect(NotificationAttention({ countPromise: Promise.resolve(0) })).resolves.toBeNull();
    await expect(NotificationAttention({ countPromise: Promise.reject(new Error('failed')) })).rejects.toThrow('failed');
  });
  it('labels the monthly bill card by what each figure counts (M-8)', async () => {
    const stats = Promise.resolve({ month: '2026-04', total: '3550.50', paid: '3300.50', outstanding: '1350.00' });
    mocks.monthly.mockReturnValue(stats);
    const page = await OwnerDashboardPage();
    let section: React.ReactElement<Record<string, unknown>> | undefined;
    visit(page, node => {
      if (node.props.resultPromise === stats) section = node;
      return false;
    });
    expect(section).toBeDefined();
    const render = section!.type as (props: Record<string, unknown>) => Promise<ReactNode>;
    const html = renderToStaticMarkup(await render(section!.props));
    expect(html).toContain('本月已出账金额');
    expect(html).toContain('3,550.50');
    expect(html).toContain('本月已收 ¥ 3,300.50');
    expect(html).toContain('待收款 ¥ 1,350.00');
    expect(html).not.toContain('未收');
  });
});
