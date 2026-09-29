import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { Role } from '@/generated/prisma/enums';

const { detail, list, permission } = vi.hoisted(() => ({ detail: vi.fn(), list: vi.fn(), permission: vi.fn() }));
vi.mock('@/lib/agent-monthly-billing/sales-query', () => ({ getSalesMonthlyBill: detail, listSalesMonthlyBills: list }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/page-title/refs', () => ({ getSalesBillTitleRef: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
import DetailPage from '@/app/(admin)/sales/bills/[id]/page';
import ListPage from '@/app/(admin)/sales/bills/page';

const actor = { id: 'sales-a', role: Role.SALES };
const bill = {
  id: 'bill-a', period: '2026-08', status: 'PAID', memberSubtotal: new Decimal('120.30'),
  adjustmentAmount: new Decimal(0), totalAmount: new Decimal('120.30'),
  confirmedAt: null, paidAt: new Date('2026-09-02T00:00:00Z'), receipt: null,
  adjustments: [], items: ['CANCELLED', 'SETTLED'].map((status, index) => ({
    id: `item-${index}`, orderId: `order-${index}`, orderNoSnapshot: `WO-${index}`,
    orderStatusSnapshot: status, workOrderVersionSnapshot: 2,
    settledFeeSnapshot: new Decimal('60.15'), settledAtSnapshot: new Date('2026-08-20T00:00:00Z'),
    order: { customName: index === 0 ? null : '中秋礼盒' },
  })),
};
beforeEach(() => {
  vi.resetAllMocks();
  permission.mockResolvedValue(actor);
  detail.mockResolvedValue(bill);
  list.mockResolvedValue([]);
});
const renderDetail = async () => renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: bill.id }) }));

it('renders receipt amount, received time, method and reference from receipt facts', async () => {
  detail.mockResolvedValue({ ...bill, receipt: {
    amount: new Decimal('120.30'), receivedAt: new Date('2026-09-01T01:02:00Z'),
    paymentMethod: '银行转账', referenceNo: 'TX-20260901',
  } });
  const html = await renderDetail();
  const section = html.match(/<section[^>]*>[\s\S]*?<\/section>/)?.[0];
  expect(section).toContain('收款记录');
  for (const text of ['120.30', '2026/09/01 09:02', '银行转账', 'TX-20260901']) expect(section).toContain(text);
  expect(html).not.toContain('暂无收款记录');
  expect(permission).toHaveBeenCalledWith('bill:view:self');
  expect(detail).toHaveBeenCalledWith(actor, bill.id);
});
it('renders an explicit empty receipt state even when the bill is paid', async () => {
  const html = await renderDetail();
  expect(html).toContain('收款记录');
  expect(html).toContain('暂无收款记录');
  expect(html).not.toContain('<dt>流水号</dt>');
});
it('renders missing optional receipt fields as unrecorded', async () => {
  detail.mockResolvedValue({ ...bill, receipt: {
    amount: new Decimal('120.30'), receivedAt: new Date('2026-09-01T01:02:00Z'),
    paymentMethod: null, referenceNo: null,
  } });
  expect((await renderDetail()).match(/未记录/g)).toHaveLength(2);
});
it('distinguishes CANCELLED and SETTLED snapshot rows and links their order ids', async () => {
  const html = await renderDetail();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const cancelled = rows.find((row) => row.includes('WO-0'));
  const settled = rows.find((row) => row.includes('WO-1'));
  expect(cancelled).toContain('已取消（取消费）');
  expect(cancelled).toContain('href="/orders/order-0"');
  expect(cancelled).not.toContain('已结算');
  expect(settled).toContain('已结算');
  expect(settled).toContain('href="/orders/order-1"');
  expect(settled).not.toContain('取消费');
});
it('lists members by order name and marks unnamed orders instead of repeating the order number', async () => {
  const html = await renderDetail();
  const headers = (html.match(/<th[^>]*>[^<]*<\/th>/g) ?? []).map((cell) => cell.replace(/<[^>]+>/g, ''));
  expect(headers).toEqual(['工单', '工单名称', '结算状态', '版本', '结算时间', '金额']);
  const rows = html.match(/<tr class="border-t">[\s\S]*?<\/tr>/g) ?? [];
  const nameCell = (row: string | undefined) =>
    (row?.match(/<td class="p-3">[\s\S]*?<\/td>/g) ?? [])[1]?.replace(/<[^>]+>/g, '');
  expect(nameCell(rows.find((row) => row.includes('/orders/order-0')))).toBe('未命名工单');
  expect(nameCell(rows.find((row) => row.includes('/orders/order-1')))).toBe('中秋礼盒');
  expect(html).not.toContain('客户');
});
it('marks a DRAFT bill detail as provisional and labels item status through the order status registry', async () => {
  detail.mockResolvedValue({ ...bill, status: 'DRAFT', paidAt: null, items: [{ ...bill.items[0], orderStatusSnapshot: 'SHIPPED' }] });
  const html = await renderDetail();
  expect(html).toContain('金额未定稿');
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
  list.mockResolvedValue([
    { ...bill, id: 'draft-1', status: 'DRAFT', totalAmount: new Decimal('10.10') },
    { ...bill, id: 'draft-2', status: 'DRAFT', totalAmount: new Decimal('20.20') },
    { ...bill, id: 'confirmed', status: 'CONFIRMED', totalAmount: new Decimal('40.40') },
    { ...bill, id: 'paid', status: 'PAID', totalAmount: new Decimal('50.50') },
  ]);
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ period: '2026-08' }) }));
  expect(html).toContain('统计范围：当前筛选结果');
  const cards = html.split('data-slot="dashboard-kpi"').slice(1).map((part) => part.split('</div></div>')[0]);
  expect(cards).toHaveLength(3);
  for (const [index, label, amount] of [[0, '整理中', '30.30'], [1, '待支付', '40.40'], [2, '已结清', '50.50']] as const) {
    expect(cards[index]).toContain(label);
    expect(cards[index]).toContain(amount);
  }
  expect(cards[0]).toContain('金额未定稿');
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  expect(rows.filter((row) => row.includes('整理中 / 金额未定稿'))).toHaveLength(2);
  expect(html).toContain('href="/sales/bills/draft-1"');
  expect(list).toHaveBeenCalledWith(actor, { period: '2026-08' });
});
it('uses the same sales-facing status names in the filter, the rows and the detail badge', async () => {
  list.mockResolvedValue([
    { ...bill, id: 'draft', status: 'DRAFT' },
    { ...bill, id: 'confirmed', status: 'CONFIRMED' },
    { ...bill, id: 'paid', status: 'PAID' },
  ]);
  const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
  const options = html.match(/<option[^>]*>[^<]*<\/option>/g) ?? [];
  expect(options.map((option) => option.replace(/<[^>]+>/g, ''))).toEqual(['全部', '整理中', '待支付', '已结清']);
  for (const adminOnly of ['草稿', '已确认·待收', '已收']) expect(html).not.toContain(adminOnly);
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  expect(rows.find((row) => row.includes('/sales/bills/confirmed'))).toContain('待支付');
  expect(rows.find((row) => row.includes('/sales/bills/paid'))).toContain('已结清');
});
it.each([
  ['DRAFT', '整理中'],
  ['CONFIRMED', '待支付'],
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
