import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ permission: vi.fn(), list: vi.fn(), stats: vi.fn(), accounts: vi.fn(), exports: vi.fn(), dashboard: vi.fn(), unbilled: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: m.permission }));
vi.mock('@/lib/agent-monthly-billing/query', () => ({ listAgentMonthlyBills: m.list, getAgentMonthlyBillingStats: m.stats, listAgentBillAccounts: m.accounts, listUnbilledAgentOrders: m.unbilled }));
vi.mock('@/lib/agent-monthly-billing/export', () => ({ listRecentAgentMonthlyBillExports: m.exports }));
vi.mock('@/lib/agent-monthly-billing/dashboard-query', () => ({ getAgentBillDashboard: m.dashboard }));
vi.mock('@/components/business/agent-monthly-billing/BillDashboard', () => ({ BillDashboard: () => null }));
vi.mock('@/components/business/agent-monthly-billing/AgentMonthlyBillExportControls', () => ({ AgentMonthlyBillExportControls: () => null }));
vi.mock('@/components/business/agent-monthly-billing/AgentMonthlyBillForms', () => ({ GenerateAgentMonthlyBillsForm: ({ defaultPeriod }: { defaultPeriod: string }) => <output data-testid="generate-period">{defaultPeriod}</output> }));
vi.mock('next/form', () => ({ default: ({ children, ...props }: { children: ReactNode; action: string }) => <form {...props}>{children}</form> }));
import BillsPage from '@/app/(billing)/owner/agent-bills/page';
import UnbilledPage from '@/app/(billing)/owner/agent-bills/unbilled/page';

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-31T16:00:00Z'));
  m.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  m.list.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 1, summary: { DRAFT: { amount: '0' }, CONFIRMED: { amount: '0' }, PAID: { amount: '0' } } });
  m.stats.mockResolvedValue({ receivableAmount: '0', receivableBillCount: 0, unbilledOrderCount: 0, draftBillCount: 0 });
  m.accounts.mockResolvedValue([]); m.exports.mockResolvedValue([]);
  m.unbilled.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 1 });
});
afterEach(() => vi.useRealTimers());

describe('bill generation period', () => {
  it.each([[undefined, '2026-08'], ['2026-07', '2026-07'], ['2026-08', '2026-08'], ['2026-09', '2026-08'], ['2027-01', '2026-08']])('keeps closed months and clamps %s to %s', async (period, expected) => {
    const html = renderToStaticMarkup(await BillsPage({ searchParams: Promise.resolve({ period }) }));
    expect(html).toContain(`data-testid="generate-period">${expected}</output>`);
    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ period }));
  });
  it('uses the previous year before the January Shanghai boundary', async () => {
    vi.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    const html = renderToStaticMarkup(await BillsPage({ searchParams: Promise.resolve({ period: '2027-01' }) }));
    expect(html).toContain('data-testid="generate-period">2026-12</output>');
  });
});

describe('unbilled order page', () => {
  it('uses Shanghai settlement months for links and retains filters in pagination', async () => {
    m.unbilled.mockResolvedValue({ rows: [
      { id: 'old', orderNo: 'OLD', customName: null, settledAt: new Date('2026-08-31T15:59:59Z'), settledFee: '10', submitter: { id: 'sales-a', displayName: '销售甲', username: 'a' } },
      { id: 'current', orderNo: 'CURRENT', customName: null, settledAt: new Date('2026-08-31T16:00:00Z'), settledFee: '20', submitter: { id: 'sales-b', displayName: '销售乙', username: 'b' } },
    ], total: 41, page: 2, pageSize: 20, pageCount: 3 });
    const html = renderToStaticMarkup(await UnbilledPage({ searchParams: Promise.resolve({ period: '2026-08', page: '2' }) }));
    expect(m.permission).toHaveBeenCalledWith('bill:view:all');
    expect(m.unbilled).toHaveBeenCalledWith({ period: '2026-08', page: 2 });
    expect(html).toContain('/owner/agent-bills?period=2026-08&amp;agentUserId=sales-a');
    expect(html).not.toContain('agentUserId=sales-b');
    expect(html).toContain('本月结束后可出账');
    expect(html).toContain('/owner/agent-bills/unbilled?period=2026-08&amp;page=3');
  });
  it('rejects access before querying orders', async () => {
    m.permission.mockRejectedValue(new Error('FORBIDDEN'));
    await expect(UnbilledPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('FORBIDDEN');
    expect(m.unbilled).not.toHaveBeenCalled();
  });
});
