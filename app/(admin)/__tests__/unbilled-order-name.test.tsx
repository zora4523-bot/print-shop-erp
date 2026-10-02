import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ list: vi.fn(), permission: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: m.permission }));
vi.mock('@/lib/agent-monthly-billing/query', () => ({ listUnbilledAgentOrders: m.list }));
import Page from '@/app/(billing)/owner/agent-bills/unbilled/page';
it.each([null, '', '  ', '　', '正常名称'])('keeps order links identifiable for name %s', async customName => {
  m.list.mockResolvedValue({ rows: [{ id: 'o1', orderNo: 'GD-1', customName, settledAt: new Date('2026-08-01'), settledFee: '10', submitter: { id: 's1', displayName: '销售', username: 'sales' } }], page: 1, pageCount: 1, total: 1, pageSize: 20 });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toMatch(new RegExp('href="/orders/o1">' + (customName?.trim() || 'GD-1') + '</a>'));
  expect(m.permission).toHaveBeenCalledWith('bill:view:all');
});
