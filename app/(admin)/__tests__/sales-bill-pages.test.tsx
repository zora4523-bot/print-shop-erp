import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Role } from '@/generated/prisma/enums';

const { detail, list, permission, session, titleRef } = vi.hoisted(() => ({ detail: vi.fn(), list: vi.fn(), permission: vi.fn(), session: vi.fn(), titleRef: vi.fn() }));
vi.mock('@/lib/agent-monthly-billing/sales-query', () => ({ getSalesMonthlyBill: detail, listSalesMonthlyBills: list }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/auth/session', () => ({ getSession: session }));
vi.mock('@/lib/page-title/refs', () => ({ getSalesBillTitleRef: titleRef }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
import DetailPage, { generateMetadata } from '@/app/(admin)/sales/bills/[id]/page';
import ListPage from '@/app/(admin)/sales/bills/page';
import { BillItemEvidence } from '@/components/business/agent-monthly-billing/BillItemEvidence';
import { BreadcrumbParent } from '@/components/business/admin/breadcrumb-entity';
import { isValidElement, type ReactNode } from 'react';

function findElements(node: ReactNode, predicate: (element: { type: unknown; props: Record<string, unknown> }) => boolean): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...findElements(node.props.children as ReactNode, predicate)];
}

const actor = { id: 'sales-a', role: Role.SALES };
const bill = {
  id: 'bill-a', period: '2026-08', status: 'PAID', memberSubtotal: new Decimal('120.30'),
  adjustmentAmount: new Decimal(0), totalAmount: new Decimal('120.30'),
  confirmedAt: null, paidAt: new Date('2026-09-02T00:00:00Z'), receipt: null,
  _count: { items: 2 }, adjustments: [], items: ['CANCELLED', 'SETTLED'].map((status, index) => ({
    id: `item-${index}`, orderId: `order-${index}`, orderNoSnapshot: `WO-${index}`,
    orderStatusSnapshot: status, workOrderVersionSnapshot: 2,
    settledFeeSnapshot: new Decimal('60.15'), settledAtSnapshot: new Date('2026-08-20T00:00:00Z'),
    credits: [],
    order: { customName: index === 0 ? null : '中秋礼盒' },
  })),
};
function listResult(rows: Array<typeof bill>, amounts = { DRAFT: '0.00', CONFIRMED: '0.00', PAID: '0.00' }) {
  return { rows, trend: [], total: rows.length, page: 1, pageSize: 30, pageCount: 1,
    summary: Object.fromEntries(Object.entries(amounts).map(([status, amount]) => [status, { amount, count: 0 }])) };
}
beforeEach(() => {
  vi.resetAllMocks();
  permission.mockResolvedValue(actor);
  detail.mockResolvedValue(bill);
  list.mockResolvedValue(listResult([]));
  session.mockResolvedValue({ user: actor });
  titleRef.mockResolvedValue({ period: bill.period });
});
const renderDetail = async () => renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: bill.id }) }));

it('identifies the sales bill as goods payable to the factory in the title and metadata', async () => {
  const html = await renderDetail();
  expect(html).toContain('2026-08 货款账单');
  expect(html).not.toContain('本账单用于核对您应付给工厂的货款。');
  // 业主 2026-10-02「请保持一致性」：返回由顶栏面包屑「我的货款账单」承担，页头不再给返回链接。
  expect(html).not.toContain('返回我的货款账单');
  expect(html).not.toContain('data-slot="page-header-back"');
  expect(html).toContain('<dt>整单应付货款</dt>');
  expect(html).not.toContain('对客应付');
  await expect(generateMetadata({ params: Promise.resolve({ id: bill.id }) })).resolves.toEqual({ title: '2026-08 货款账单 · 我的货款账单' });
  expect(titleRef).toHaveBeenCalledWith(bill.id, actor.id);
  session.mockResolvedValue(null);
  titleRef.mockClear();
  await expect(generateMetadata({ params: Promise.resolve({ id: bill.id }) })).resolves.toEqual({ title: '我的货款账单' });
  expect(titleRef).not.toHaveBeenCalled();
});

it('keeps complete factory receipt facts in a disclosure closed by default with a concise paid summary', async () => {
  detail.mockResolvedValue({ ...bill, receipt: {
    amount: new Decimal('120.30'), receivedAt: new Date('2026-09-01T01:02:00Z'),
    paymentMethod: '银行转账', referenceNo: 'TX-20260901',
  } });
  const html = await renderDetail();
  const disclosure = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
  const summary = disclosure?.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0];
  expect(disclosure).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/);
  expect(summary).toContain('工厂收款记录');
  expect(summary).toContain('已收 ¥ 120.30');
  for (const text of ['120.30', '2026/09/01 09:02', '银行转账', 'TX-20260901']) expect(disclosure).toContain(text);
  expect(html).not.toContain('暂无工厂收款记录');
  expect(permission).toHaveBeenCalledWith('bill:view:self');
  expect(detail).toHaveBeenCalledWith(actor, bill.id);
});
it('renders an explicit empty receipt state even when the bill is paid', async () => {
  const html = await renderDetail();
  const disclosure = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0];
  const summary = disclosure?.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0];
  expect(disclosure).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/);
  expect(summary).toContain('工厂收款记录');
  expect(summary).not.toContain('暂无记录');
  expect(html.match(/暂无工厂收款记录/g)).toHaveLength(1);
  expect(html).toContain('暂无工厂收款记录');
  expect(html).not.toContain('<dt>流水号</dt>');
});
it('omits missing optional receipt fields while keeping amount and payment date', async () => {
  detail.mockResolvedValue({ ...bill, receipt: {
    amount: new Decimal('120.30'), receivedAt: new Date('2026-09-01T01:02:00Z'),
    paymentMethod: null, referenceNo: null,
  } });
  const html = await renderDetail();
  expect(html).not.toContain('未记录');
  expect(html).not.toContain('<dt>流水号</dt>');
  expect(html).not.toContain('<dt>付款方式</dt>');
  expect(html).toContain('已收 ¥ 120.30');
  expect(html).toContain('2026/09/01 09:02');
});
it('distinguishes CANCELLED and SETTLED rows with one compact evidence entry per order', async () => {
  const html = await renderDetail();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const cancelled = rows.find((row) => row.includes('WO-0'));
  const settled = rows.find((row) => row.includes('WO-1'));
  expect(cancelled).toContain('已取消（取消费）');
  expect(cancelled?.match(/<button[^>]*aria-label="查看 WO-0 明细"/g)).toHaveLength(1);
  expect(cancelled?.match(/<button[^>]*>([\s\S]*?)<\/button>/)?.[1]).toBe('WO-0');
  expect(cancelled).toContain('min-h-11');
  expect(cancelled).not.toContain('href="/orders/order-0"');
  expect(cancelled).not.toContain('已结算');
  expect(settled).toContain('已结算');
  expect(settled?.match(/<button[^>]*aria-label="查看 WO-1 明细"/g)).toHaveLength(1);
  expect(settled).not.toContain('href="/orders/order-1"');
  expect(settled).not.toContain('取消费');
  expect(html).not.toContain('录入抵扣');
});
it('lists members by order name and marks unnamed orders instead of repeating the order number', async () => {
  const html = await renderDetail();
  const headers = (html.match(/<th[^>]*>[^<]*<\/th>/g) ?? []).map((cell) => cell.replace(/<[^>]+>/g, ''));
  expect(headers).toEqual(['工单号', '工单名称', '结算日期', '工单金额', '状态']);
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const nameCell = (row: string | undefined) =>
    (row?.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [])[1]?.replace(/<[^>]+>/g, '');
  expect(nameCell(rows.find((row) => row.includes('WO-0')))).toBe('未命名工单当前名称');
  expect(nameCell(rows.find((row) => row.includes('WO-1')))).toBe('中秋礼盒当前名称');
  expect(rows.find((row) => row.includes('WO-0'))).toContain('2026/08/20');
  expect(html).not.toContain('纸单');
  expect(html).not.toContain('客户');
});
it('keeps the full settlement date, frozen paper version and current-order link in the evidence sheet', () => {
  const evidence = BillItemEvidence({ item: { ...bill.items[0], workOrderVersionSnapshot: 7 }, period: bill.period, sales: true });
  const html = renderToStaticMarkup(<>{evidence.props.children}</>);
  expect(html).toContain('工单金额');
  expect(html).toContain('结算工单金额');
  expect(html).not.toContain('工单金额为结算时金额；账单抵扣单独列示。');
  expect(html).not.toContain('应付货款');
  expect(html).toContain('60.15');
  expect(html).toContain('2026/08/20 08:00');
  expect(html).toContain('结算时纸单版本');
  expect(html).toContain('v7');
  expect(html).toContain('href="/orders/order-0"');
  expect(html).toContain('查看当前工单');
  expect(html).toContain('该账单未保留完整费用分项，请按结算总额核对。');
});
it('marks a DRAFT bill detail as provisional and labels item status through the order status registry', async () => {
  detail.mockResolvedValue({ ...bill, status: 'DRAFT', paidAt: null, items: [{ ...bill.items[0], orderStatusSnapshot: 'SHIPPED' }] });
  const html = await renderDetail();
  expect(html).toContain('金额未定稿');
  expect(html).not.toContain('以工厂确认后的金额为准');
  expect(html).toContain('<dt>整单暂计货款</dt>');
  expect(html).toContain('已发货');
  expect(html).not.toContain('SHIPPED');
  expect(html).not.toContain('未识别');
});
it('shows 未识别配置 instead of the raw snapshot for an unrecognised item status', async () => {
  detail.mockResolvedValue({ ...bill, items: [{ ...bill.items[0], orderStatusSnapshot: 'LEGACY_UNKNOWN' }] });
  const html = await renderDetail();
  expect(html).toContain('未识别配置');
  expect(html).not.toContain('LEGACY_UNKNOWN');
});
it('does not show the provisional notice on a confirmed bill', async () => {
  detail.mockResolvedValue({ ...bill, status: 'CONFIRMED', paidAt: null });
  expect(await renderDetail()).not.toContain('金额未定稿');
});
it('returns not found when the scoped bill lookup finds no bill', async () => {
  detail.mockResolvedValue(null);
  await expect(renderDetail()).rejects.toThrow('NEXT_NOT_FOUND');
});
it('keeps DRAFT rows visibly provisional and totals DRAFT, CONFIRMED and PAID separately', async () => {
  list.mockResolvedValue(listResult([
    { ...bill, id: 'draft-1', status: 'DRAFT', totalAmount: new Decimal('10.10') },
    { ...bill, id: 'draft-2', status: 'DRAFT', totalAmount: new Decimal('20.20') },
    { ...bill, id: 'confirmed', status: 'CONFIRMED', totalAmount: new Decimal('40.40') },
    { ...bill, id: 'paid', status: 'PAID', totalAmount: new Decimal('50.50') },
  ], { DRAFT: '30.30', CONFIRMED: '40.40', PAID: '50.50' }));
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ period: '2026-08' }) }));
  expect(html).toContain('当前筛选');
  const cards = html.split('data-slot="dashboard-kpi"').slice(1).map((part) => part.split('</div></div>')[0]);
  expect(cards).toHaveLength(3);
  for (const [index, label, amount] of [[0, '整理中', '30.30'], [1, '待付款', '40.40'], [2, '已结清', '50.50']] as const) {
    expect(cards[index]).toContain(label);
    expect(cards[index]).toContain(amount);
  }
  expect(cards[0]).toContain('金额未定稿');
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  expect(rows.filter((row) => row.includes('整理中') && row.includes('金额未定稿'))).toHaveLength(2);
  expect(html).toContain('href="/sales/bills/draft-1?returnTo=');
  expect(list).toHaveBeenCalledWith(actor, { period: '2026-08' });
});
it('uses the same sales-facing status names in the filter, the rows and the detail badge', async () => {
  list.mockResolvedValue(listResult([
    { ...bill, id: 'draft', status: 'DRAFT' },
    { ...bill, id: 'confirmed', status: 'CONFIRMED' },
    { ...bill, id: 'paid', status: 'PAID' },
  ]));
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
  const options = html.match(/<option[^>]*>[^<]*<\/option>/g) ?? [];
  expect(options.map((option) => option.replace(/<[^>]+>/g, ''))).toEqual(['全部', '整理中', '待付款', '已结清']);
  for (const adminOnly of ['草稿', '已确认·待收', '已收']) expect(html).not.toContain(adminOnly);
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  expect(rows.find((row) => row.includes('/sales/bills/confirmed'))).toContain('待付款');
  expect(rows.find((row) => row.includes('/sales/bills/paid'))).toContain('已结清');
});
it.each([
  ['DRAFT', '整理中'],
  ['CONFIRMED', '待付款'],
  ['PAID', '已结清'],
])('renders the %s detail badge with the sales-facing label %s', async (status, label) => {
  detail.mockResolvedValue({ ...bill, status, paidAt: status === 'PAID' ? bill.paidAt : null });
  const html = await renderDetail();
  // 只看账单状态徽标本身：DRAFT 的未定稿提示条也含「整理中」，不能靠全文包含来断言；
  // 明细表里是逐行的工单状态徽标（另一套注册表），不属于账单状态。
  const outsideTable = html.replace(/<table[\s\S]*?<\/table>/g, '');
  const badges = (outsideTable.match(/<[a-z]+[^>]*data-slot="badge"[^>]*>[\s\S]*?<\/[a-z]+>/g) ?? []).map((tag) => tag.replace(/<[^>]+>/g, '').trim());
  expect(badges).toEqual([label]);
  for (const adminOnly of ['草稿', '已确认·待收', '已收']) expect(html).not.toContain(adminOnly);
});
it('shows zero totals and an empty state for an empty filtered list', async () => {
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ status: 'DRAFT' }) }));
  expect(html).toContain('当前筛选条件下暂无账单');
  expect(html.match(/0\.00/g)).toHaveLength(3);
  expect(list).toHaveBeenCalledWith(actor, { status: 'DRAFT' });
});

it('puts the month list before optional amount distribution and keeps status when drilling into a month', async () => {
  list.mockResolvedValue({ ...listResult([bill]), trend: [{ period: '2026-08', draft: '10.00', confirmed: '20.00', paid: '30.00' }] });
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ status: 'CONFIRMED', period: '2026-07' }) }));
  expect(html).toContain('账期概览');
  expect(html).toContain('查看账期金额分布');
  expect(html).toContain('<details');
  expect(html).not.toMatch(/<details[^>]*\bopen=/);
  expect(html.indexOf('id="sales-bill-results"')).toBeLessThan(html.indexOf('查看账期金额分布'));
  expect(html).toContain('全部账单 · 最近 1 个账期');
  expect(html).toContain('period=2026-08&amp;status=CONFIRMED#sales-bill-results');
  expect(html).toContain('id="sales-bill-results"');
  expect(html).toContain('导出当前筛选 CSV');
  expect(html).toContain('href="/api/sales/bills/export?period=2026-07&amp;status=CONFIRMED"');
});

it('uses one responsive list and keeps whole-bill amounts while paging matching rows', async () => {
  const items = Array.from({ length: 65 }, (_, i) => ({ ...bill.items[0], id: `entry-${i}`, orderId: `entry-${i}`, orderNoSnapshot: `BATCH-${String(i).padStart(3, '0')}`, order: { customName: `明细 ${i}` } }));
  detail.mockResolvedValue({ ...bill, items });
  const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: bill.id }), searchParams: Promise.resolve({ q: 'BATCH-', page: '3' }) }));
  const desktop = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(desktop.match(/<tr class="grid /g)).toHaveLength(5);
  expect(desktop).toContain('md:table-row');
  expect(html.match(/aria-label="查看 BATCH-060 明细"/g)).toHaveLength(1);
  for (const block of [desktop]) {
    expect(block).toContain('BATCH-060');
    expect(block).toContain('BATCH-064');
    expect(block).toContain('60.15');
    expect(block).not.toContain('BATCH-059');
  }
  expect(html).toContain('匹配 65 / 65 单');
  expect(html).toContain('120.30');
  expect(html).toContain('整单应付货款');
  expect(html).toContain('导出匹配明细 CSV');
  expect(html).toContain('href="/api/sales/bills/bill-a/export?q=BATCH-"');
});

it('hands the list filters and page to the breadcrumb parent instead of a page-header back link', async () => {
  const tree = await DetailPage({
    params: Promise.resolve({ id: bill.id }),
    searchParams: Promise.resolve({ returnTo: '/sales/bills?period=2026-08&status=PAID&page=2' }),
  });
  const parents = findElements(tree, (element) => element.type === BreadcrumbParent);
  expect(parents).toHaveLength(1);
  expect(parents[0].props.href).toMatch(/^\/sales\/bills\?/);
  expect(parents[0].props.href).toContain('period=2026-08');
  expect(parents[0].props.href).toContain('page=2');
  const plain = findElements(await DetailPage({ params: Promise.resolve({ id: bill.id }) }), (element) => element.type === BreadcrumbParent);
  expect(plain[0].props.href).toBe('/sales/bills');
});
