import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Role } from '@/generated/prisma/enums';

const { ownerDetail, salesDetail, permission } = vi.hoisted(() => ({
  ownerDetail: vi.fn(), salesDetail: vi.fn(), permission: vi.fn(),
}));
vi.mock('@/lib/agent-monthly-billing/query', () => ({ getAgentMonthlyBillDetail: ownerDetail }));
vi.mock('@/lib/agent-monthly-billing/sales-query', () => ({ getSalesMonthlyBill: salesDetail }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/page-title/refs', () => ({ getSalesBillTitleRef: vi.fn() }));
vi.mock('@/actions/agent-monthly-bill', () => ({
  confirmAgentMonthlyBillAction: vi.fn(), createAgentMonthlyBillCreditAction: vi.fn(), markAgentMonthlyBillPaidAction: vi.fn(),
}));
// Sheet 内容只在打开后挂载；这里内联渲染，才能断言抵扣来源链接。
vi.mock('@/components/business/agent-monthly-billing/BillDetailDisclosure', () => ({
  BillDetailDisclosure: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import OwnerDetailPage from '@/app/(billing)/owner/agent-bills/[id]/page';
import CreditPage from '@/app/(billing)/owner/agent-bills/[id]/credits/[itemId]/new/page';
import SalesDetailPage from '@/app/(admin)/sales/bills/[id]/page';
import { BillItemEvidence } from '@/components/business/agent-monthly-billing/BillItemEvidence';
import { BreadcrumbParent } from '@/components/business/admin/breadcrumb-entity';
import { isValidElement, type ReactNode } from 'react';

// 返回入口是顶栏面包屑父级（业主 2026-10-02「请保持一致性」）：页面把带范围的地址交给
// BreadcrumbParent（不渲染 DOM），这里从元素树里取它的 href。
function breadcrumbParentHref(node: ReactNode): string | undefined {
  if (Array.isArray(node)) return node.map(breadcrumbParentHref).find(Boolean);
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return undefined;
  if (node.type === BreadcrumbParent) return node.props.href;
  return breadcrumbParentHref(node.props.children);
}

const OWNER_SCOPE = '/owner/agent-bills?period=2026-08&status=CONFIRMED&page=2';
const OWNER_SCOPE_PARAM = `returnTo=${encodeURIComponent(OWNER_SCOPE)}`.replaceAll('&', '&amp;');
const SALES_SCOPE = '/sales/bills?period=2026-08&page=3';
const SALES_SCOPE_PARAM = `returnTo=${encodeURIComponent(SALES_SCOPE)}`.replaceAll('&', '&amp;');
const at = new Date('2026-08-20T00:00:00Z');

const credit = {
  id: 'credit-1', requestedAmount: new Decimal('-100.00'), createdAt: at,
  allocations: [
    { id: 'alloc-1', amount: new Decimal('-30.00'), bill: { id: 'bill-sep', period: '2026-09', status: 'CONFIRMED' } },
    { id: 'alloc-2', amount: new Decimal('-50.00'), bill: { id: 'bill-oct', period: '2026-10', status: 'DRAFT' } },
  ],
};
const item = {
  id: 'item-1', orderId: 'order-1', orderNoSnapshot: 'WO-1', orderStatusSnapshot: 'SETTLED', workOrderVersionSnapshot: 2,
  settledFeeSnapshot: new Decimal('500.00'), settledAtSnapshot: at, credits: [credit], order: { customName: '中秋礼盒' },
};
const adjustments = [{ id: 'adj-1', amount: new Decimal('-20.00'), credit: { sourceItem: { id: 'src', orderId: 'o', orderNoSnapshot: 'WO-0', bill: { id: 'bill-jul', period: '2026-07' } } } }];
const ownerBill = {
  id: 'bill-aug', period: '2026-08', status: 'CONFIRMED', agentDisplayNameSnapshot: '销售甲', agentUsernameSnapshot: 'sales-a',
  memberSubtotal: '500.00', adjustmentAmount: '-20.00', totalAmount: '480.00', confirmedAt: at, paidAt: null, receipt: null,
  items: [item], adjustments,
};
const salesBill = { ...ownerBill, _count: { items: 1 } };

const evidenceHtml = (props: Parameters<typeof BillItemEvidence>[0]) => {
  const element = BillItemEvidence(props);
  return renderToStaticMarkup(<>{element.props.children}</>);
};

beforeEach(() => {
  vi.resetAllMocks();
  ownerDetail.mockResolvedValue(ownerBill);
  salesDetail.mockResolvedValue(salesBill);
});

describe('credit allocation display', () => {
  it('counts only frozen target bills as deducted and lists DRAFT allocations as provisional', () => {
    const html = evidenceHtml({ item, period: '2026-08' });
    expect(html).toContain('已抵扣 ¥ 30.00');
    expect(html).toContain('暂计抵扣（账单整理中） ¥ 50.00');
    expect(html).toContain('待抵扣 ¥ 20.00');
    expect(html).toContain('2026-10 月账单（整理中）');
    expect(html).not.toContain('2026-09 月账单（整理中）');
  });

  it('omits the provisional segment when every allocation is frozen', () => {
    const frozen = { ...item, credits: [{ ...credit, allocations: [credit.allocations[0]] }] };
    const html = evidenceHtml({ item: frozen, period: '2026-08', sales: true });
    expect(html).toContain('已抵扣 ¥ 30.00');
    expect(html).not.toContain('暂计抵扣');
    expect(html).toContain('待抵扣 ¥ 70.00');
  });
});

describe('owner return scope', () => {
  it('threads the sanitized list scope through credit, allocation and deduction-source links', async () => {
    permission.mockResolvedValue({ id: 'admin', role: Role.ADMIN });
    const html = renderToStaticMarkup(await OwnerDetailPage({ params: Promise.resolve({ id: 'bill-aug' }), searchParams: Promise.resolve({ returnTo: `${OWNER_SCOPE}&unknown=x` }) }));
    expect(html).toContain(`href="/owner/agent-bills/bill-aug/credits/item-1/new?${OWNER_SCOPE_PARAM}"`);
    expect(html).toContain(`href="/owner/agent-bills/bill-jul?${OWNER_SCOPE_PARAM}"`);
    expect(html).not.toContain('unknown');
    const evidence = evidenceHtml({ item, period: '2026-08', returnTo: OWNER_SCOPE });
    expect(evidence).toContain(`href="/owner/agent-bills/bill-sep?${OWNER_SCOPE_PARAM}"`);
    expect(evidence).toContain(`href="/owner/agent-bills/bill-oct?${OWNER_SCOPE_PARAM}"`);
  });

  it('drops unsafe destinations instead of forwarding them', async () => {
    permission.mockResolvedValue({ id: 'admin', role: Role.ADMIN });
    const html = renderToStaticMarkup(await OwnerDetailPage({ params: Promise.resolve({ id: 'bill-aug' }), searchParams: Promise.resolve({ returnTo: 'https://evil.example/owner/agent-bills?period=2026-08' }) }));
    expect(html).toContain('href="/owner/agent-bills/bill-aug/credits/item-1/new"');
    expect(html).toContain('href="/owner/agent-bills/bill-jul"');
    expect(html).not.toContain('evil.example');
    const evidence = evidenceHtml({ item, period: '2026-08', returnTo: '//evil.example' });
    expect(evidence).toContain('href="/owner/agent-bills/bill-sep"');
    expect(evidence).not.toContain('evil.example');
  });

  it('returns from the credit page to the scoped bill detail', async () => {
    permission.mockResolvedValue({ id: 'admin', role: Role.ADMIN });
    ownerDetail.mockResolvedValue({ ...ownerBill, status: 'DRAFT' });
    const scoped = await CreditPage({ params: Promise.resolve({ id: 'bill-aug', itemId: 'item-1' }), searchParams: Promise.resolve({ returnTo: OWNER_SCOPE }) });
    expect(breadcrumbParentHref(scoped)).toBe(`/owner/agent-bills/bill-aug?${OWNER_SCOPE_PARAM.replaceAll('&amp;', '&')}`);
    expect(renderToStaticMarkup(scoped)).not.toContain('data-slot="page-header-back"');
    const unsafe = await CreditPage({ params: Promise.resolve({ id: 'bill-aug', itemId: 'item-1' }), searchParams: Promise.resolve({ returnTo: '/sales/bills?period=2026-08' }) });
    expect(breadcrumbParentHref(unsafe)).toBe('/owner/agent-bills/bill-aug');
    expect(renderToStaticMarkup(unsafe)).not.toContain('/sales/bills');
  });

  it('returns from the bill detail to the scoped list through the breadcrumb parent', async () => {
    permission.mockResolvedValue({ id: 'admin', role: Role.ADMIN });
    const scoped = await OwnerDetailPage({ params: Promise.resolve({ id: 'bill-aug' }), searchParams: Promise.resolve({ returnTo: `${OWNER_SCOPE}&unknown=x` }) });
    const href = breadcrumbParentHref(scoped)!;
    expect(href).toMatch(/^\/owner\/agent-bills\?/);
    expect(new URLSearchParams(href.split('?')[1]).get('period')).toBe('2026-08');
    expect(new URLSearchParams(href.split('?')[1]).get('status')).toBe('CONFIRMED');
    expect(new URLSearchParams(href.split('?')[1]).get('page')).toBe('2');
    expect(href).not.toContain('unknown');
    expect(renderToStaticMarkup(scoped)).not.toContain('data-slot="page-header-back"');
    const unsafe = await OwnerDetailPage({ params: Promise.resolve({ id: 'bill-aug' }), searchParams: Promise.resolve({ returnTo: 'https://evil.example/owner/agent-bills?period=2026-08' }) });
    expect(breadcrumbParentHref(unsafe)).toBe('/owner/agent-bills');
  });
});

describe('sales return scope', () => {
  it('keeps the sales list scope on deduction-source links and never forwards owner-only filters', async () => {
    permission.mockResolvedValue({ id: 'sales-a', role: Role.SALES });
    const html = renderToStaticMarkup(await SalesDetailPage({ params: Promise.resolve({ id: 'bill-aug' }), searchParams: Promise.resolve({ returnTo: `${SALES_SCOPE}&agentUserId=other` }) }));
    expect(html).toContain(`href="/sales/bills/bill-jul?${SALES_SCOPE_PARAM}"`);
    expect(html).not.toContain('agentUserId');
    const evidence = evidenceHtml({ item, period: '2026-08', sales: true, returnTo: SALES_SCOPE });
    expect(evidence).toContain(`href="/sales/bills/bill-sep?${SALES_SCOPE_PARAM}"`);
    const crossRole = evidenceHtml({ item, period: '2026-08', sales: true, returnTo: OWNER_SCOPE });
    expect(crossRole).toContain('href="/sales/bills/bill-sep"');
  });
});
