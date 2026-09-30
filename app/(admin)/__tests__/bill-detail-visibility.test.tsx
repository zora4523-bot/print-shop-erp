import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillStatus,
  OrderCostCategory,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '@/generated/prisma/enums';

const {
  getAdminBillDetailMock,
  getAgentMonthlyBillDetailMock,
  getSalesMonthlyBillMock,
  requirePermissionMock,
} = vi.hoisted(() => ({
  getAdminBillDetailMock: vi.fn(),
  getAgentMonthlyBillDetailMock: vi.fn(),
  getSalesMonthlyBillMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/agent-monthly-billing/sales-query', () => ({ getSalesMonthlyBill: getSalesMonthlyBillMock }));
vi.mock('@/lib/agent-monthly-billing/query', () => ({
  getAgentMonthlyBillDetail: getAgentMonthlyBillDetailMock,
}));
vi.mock('@/actions/agent-monthly-bill', () => ({
  confirmAgentMonthlyBillAction: vi.fn(),
  createAgentMonthlyBillCreditAction: vi.fn(),
  generateAgentMonthlyBillsAction: vi.fn(),
  markAgentMonthlyBillPaidAction: vi.fn(),
}));

vi.mock('@/lib/bill', () => ({
  getAdminBillDetail: getAdminBillDetailMock,
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}));
// 标题取数模块直连 Prisma —— 见 order-detail 测试里的同名注释。
vi.mock('@/lib/page-title/refs', () => ({
  getAdminBillTitleRef: vi.fn(),
  getSalesBillTitleRef: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

import OwnerBillDetailPage from '@/app/(billing)/owner/bills/[id]/page';
import LegacyBillArchiveDetailPage from '@/app/(billing)/owner/bills/archive/[id]/page';
import AgentMonthlyBillDetailPage from '@/app/(billing)/owner/agent-bills/[id]/page';
import SalesBillDetailPage from '@/app/(admin)/sales/bills/[id]/page';
import { BillItemsList } from '@/components/business/agent-monthly-billing/BillItemsList';

const finishedAt = new Date('2026-08-01T02:00:00.000Z');
const paidAt = new Date('2026-08-02T03:00:00.000Z');

beforeEach(() => {
  getAdminBillDetailMock.mockReset();
  getAgentMonthlyBillDetailMock.mockReset();
  getSalesMonthlyBillMock.mockReset();
  requirePermissionMock.mockReset();
});

describe('bill detail visibility boundary', () => {
  it('renders frozen monthly bill facts without exposing internal notes or current order costs', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    getSalesMonthlyBillMock.mockResolvedValue({
      id: 'bill-1', period: '2026-08', status: 'PAID', memberSubtotal: '500.00', adjustmentAmount: '0.00', totalAmount: '500.00', confirmedAt: paidAt, paidAt,
      internalNote: '内部财务甲', adjustments: [],
      items: [{ credits: [], id: 'item', orderNoSnapshot: '20260801-0001', customerRefSnapshot: '外部客户甲', workOrderVersionSnapshot: 2, settledFeeSnapshot: '500.00', settledAtSnapshot: finishedAt,
        order: { customName: '中秋礼盒', totalAmount: '9999.00', costs: '内部成本' } }],
    });
    const html = renderToStaticMarkup(await SalesBillDetailPage({ params: Promise.resolve({ id: 'bill-1' }) }));
    expect(getSalesMonthlyBillMock).toHaveBeenCalledWith({ id: 'sales-1', role: Role.SALES }, 'bill-1');
    expect(html).toContain('500.00');
    expect(html).toContain('20260801-0001');
    // 客户名称/简称停用（业主 2026-09-27）：明细改列工单名称，冻结的客户快照不再展示。
    expect(html).toContain('<th class="p-3 text-left">工单名称</th>');
    expect(html).toContain('中秋礼盒');
    expect(html).not.toContain('客户');
    for (const forbidden of ['内部财务甲', '内部成本', '9999.00']) expect(html).not.toContain(forbidden);
  });

  it('marks a sales bill member without an order name as 未命名工单', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    getSalesMonthlyBillMock.mockResolvedValue({
      id: 'bill-1', period: '2026-08', status: 'CONFIRMED', memberSubtotal: '500.00', adjustmentAmount: '0.00', totalAmount: '500.00', confirmedAt: paidAt, paidAt: null,
      receipt: null, adjustments: [],
      items: [{ credits: [], id: 'item', orderId: 'order-1', orderNoSnapshot: '20260801-0001', customerRefSnapshot: '外部客户甲', orderStatusSnapshot: 'SETTLED', workOrderVersionSnapshot: 2, settledFeeSnapshot: '500.00', settledAtSnapshot: finishedAt,
        order: { customName: '   ' } }],
    });
    const html = renderToStaticMarkup(await SalesBillDetailPage({ params: Promise.resolve({ id: 'bill-1' }) }));
    const row = html.match(/<tr class="grid [\s\S]*?<\/tr>/)?.[0] ?? '';
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    expect(cells[1]).toBe('未命名工单<span class="block text-xs text-muted-foreground">当前名称</span>');
    expect(html).not.toContain('外部客户甲');
  });

  it('lists the order name, not the frozen customer snapshot, on the administrator monthly bill', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getAgentMonthlyBillDetailMock.mockResolvedValue({
      id: 'agent-bill-1', period: '2026-08', status: 'CONFIRMED',
      agentDisplayNameSnapshot: '外部销售甲', agentUsernameSnapshot: 'sales-a',
      memberSubtotal: '800.00', adjustmentAmount: '0.00', totalAmount: '800.00',
      confirmedAt: paidAt, paidAt: null, receipt: null, adjustments: [],
      items: [
        { credits: [], id: 'item-1', orderNoSnapshot: '20260801-0001', customerRefSnapshot: '外部客户甲', orderStatusSnapshot: 'SETTLED', workOrderVersionSnapshot: 2, settledFeeSnapshot: '500.00', settledAtSnapshot: finishedAt, order: { customName: '中秋礼盒' } },
        { credits: [], id: 'item-2', orderNoSnapshot: '20260801-0002', customerRefSnapshot: '外部客户乙', orderStatusSnapshot: 'SETTLED', workOrderVersionSnapshot: 1, settledFeeSnapshot: '300.00', settledAtSnapshot: finishedAt, order: { customName: null } },
      ],
    });
    const html = renderToStaticMarkup(await AgentMonthlyBillDetailPage({ params: Promise.resolve({ id: 'agent-bill-1' }) }));
    expect(requirePermissionMock).toHaveBeenCalledWith('bill:view:all');
    const headers = [...html.matchAll(/<th class="p-3 text-left">([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(headers).toEqual(['工单号', '工单名称', '结算日期', '状态']);
    expect(html).toContain('<th class="p-3 text-right">结算金额</th>');
    expect(html.match(/>录入抵扣<\/a>/g)).toHaveLength(2);
    expect(html).toContain('href="/owner/agent-bills/agent-bill-1/credits/item-1/new"');
    expect(html).toContain('href="/owner/agent-bills/agent-bill-1/credits/item-2/new"');
    const nameCells = [...html.matchAll(/<td[^>]*>([^<]*<span class="block text-xs text-muted-foreground">当前名称<\/span>)<\/td>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
    expect(nameCells).toEqual(['中秋礼盒当前名称', '未命名工单当前名称']);
    for (const customer of ['外部客户甲', '外部客户乙', '客户']) expect(html).not.toContain(customer);
  });

  it('lists the order name on the read-only legacy bill archive', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    getAdminBillDetailMock.mockResolvedValue({
      id: 'bill-1', salesUserId: 'sales-1', period: '2026-08', sequence: 1,
      openingAmount: '0.00', totalAmount: '800.00', paidAmount: '800.00', status: BillStatus.FULLY_PAID,
      issuedAt: paidAt, paidAt, remark: null, createdAt: finishedAt, updatedAt: paidAt,
      salesUser: { id: 'sales-1', displayName: '外部销售甲', role: Role.SALES },
      payments: [],
      items: [
        { id: 'bill-item-1', orderId: 'order-1', orderAmount: '500.00', order: { id: 'order-1', orderNo: '20260801-0001', customName: '中秋礼盒', customerRef: '外部客户甲', finishedAt } },
        { id: 'bill-item-2', orderId: 'order-2', orderAmount: '300.00', order: { id: 'order-2', orderNo: '20260801-0002', customName: null, customerRef: '外部客户乙', finishedAt } },
      ],
    });
    const html = renderToStaticMarkup(await LegacyBillArchiveDetailPage({ params: Promise.resolve({ id: 'bill-1' }) }));
    expect(requirePermissionMock).toHaveBeenCalledWith('bill:view:all');
    const headers = [...html.matchAll(/<th class="px-4 py-2 text-left">([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(headers).toEqual(['工单', '工单名称', '完成时间']);
    const nameCells = [...html.matchAll(/<td class="px-4 py-3">([^<]*)<\/td>/g)].map((match) => match[1]);
    expect(nameCells).toEqual(['中秋礼盒', '未命名工单']);
    for (const customer of ['外部客户甲', '外部客户乙']) expect(html).not.toContain(customer);
  });

  it('moves legacy administrator deep links to the read-only archive', async () => {
    requirePermissionMock.mockResolvedValue({
      id: 'admin-1',
      role: Role.ADMIN,
    });
    getAdminBillDetailMock.mockResolvedValue({
      id: 'bill-1',
      salesUserId: 'sales-1',
      period: '2026-08',
      sequence: 1,
      openingAmount: '0.00',
      totalAmount: '500.00',
      paidAmount: '500.00',
      status: BillStatus.FULLY_PAID,
      issuedAt: paidAt,
      paidAt,
      remark: null,
      createdAt: finishedAt,
      updatedAt: paidAt,
      salesUser: {
        id: 'sales-1',
        displayName: '外部销售甲',
        role: Role.SALES,
      },
      payments: [
        {
          id: 'payment-1',
          amount: '500.00',
          paidAt,
          paymentMethod: '银行转账',
          referenceNo: 'PUBLIC-001',
          remark: null,
          idempotencyKey: 'payment-public-1',
          createdAt: paidAt,
          recordedBy: { displayName: '内部财务甲' },
        },
      ],
      items: [
        {
          id: 'bill-item-1',
          orderId: 'order-1',
          orderAmount: '500.00',
          order: {
            id: 'order-1',
            orderNo: '20260801-0001',
            settlementType: OrderSettlementType.EXTERNAL_SALES,
            customerRef: '外部客户甲',
            processingAmount: '488.00',
            finishedAt,
            status: OrderStatus.FINISHED,
            shipments: [],
            customerCharges: [
              {
                amount: '8.00',
                status: 'FINAL',
                category: { code: 'SHIPPING_FEE', name: '快递费' },
                shipment: { sequence: 1 },
              },
              {
                amount: '4.00',
                status: 'FINAL',
                category: { code: 'PACKING_MATERIAL', name: '打包耗材费' },
                shipment: { sequence: 1 },
              },
              {
                amount: null,
                status: 'PENDING_AMOUNT',
                category: { code: 'SHIPPING_FEE', name: '快递费' },
                shipment: { sequence: 2 },
              },
            ],
            costEntries: [
              {
                id: 'cost-1',
                category: OrderCostCategory.MATERIAL,
                description: '秘密材料成本',
                quantity: '1.000',
                unit: '批',
                unitPrice: '88.0000',
                amount: '88.00',
                remark: '工厂内部成本备注',
                createdAt: finishedAt,
                createdBy: { displayName: '内部财务甲' },
              },
            ],
            items: [{ tasks: [{ pieceworkAmount: '20.00' }] }],
            outsourceOrders: [{ amount: '30.00' }],
            reworkOrders: [
              {
                id: 'rework-1',
                orderNo: '重做内部单',
                items: [{ tasks: [{ pieceworkAmount: '5.00' }] }],
                outsourceOrders: [],
                costEntries: [
                  {
                    id: 'rework-cost-1',
                    category: OrderCostCategory.SHIPPING,
                    description: '重做补发内部运费',
                    quantity: null,
                    unit: null,
                    unitPrice: null,
                    amount: '6.00',
                    remark: null,
                    createdAt: finishedAt,
                    createdBy: { displayName: '内部财务乙' },
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    await expect(
      OwnerBillDetailPage({
        params: Promise.resolve({ id: 'bill-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/owner/bills/archive/bill-1');
    expect(requirePermissionMock).not.toHaveBeenCalled();
    expect(getAdminBillDetailMock).not.toHaveBeenCalled();
  });
});

it.each([
  ['CONFIRMED', false, '0.00', true],
  ['PAID', false, '-100.00', true],
  ['CONFIRMED', false, '-500.00', false],
  ['DRAFT', false, '0.00', false],
  ['CONFIRMED', true, '0.00', false],
] as const)('preserves credit eligibility on %s bills, sales=%s, requested credit=%s', (billStatus, sales, requestedAmount, eligible) => {
  const html = renderToStaticMarkup(<BillItemsList
    period="2026-08" billId="bill-1" billStatus={billStatus} sales={sales}
    items={[{
      id: 'item-1', orderId: 'order-1', orderNoSnapshot: '20260801-0001', orderStatusSnapshot: 'SETTLED',
      workOrderVersionSnapshot: 7, settledFeeSnapshot: '500.00', settledAtSnapshot: finishedAt,
      credits: requestedAmount === '0.00' ? [] : [{ id: 'credit-1', requestedAmount, createdAt: paidAt, allocations: [] }],
      order: { customName: '中秋礼盒' },
    }]}
  />);
  expect(html.includes('href="/owner/agent-bills/bill-1/credits/item-1/new"')).toBe(eligible);
  expect(html.includes('录入抵扣')).toBe(eligible);
  expect(html.match(/aria-label="查看 20260801-0001 明细"/g)).toHaveLength(1);
  expect(html).not.toContain('href="/orders/order-1"');
  expect(html).not.toContain('v7');
});

it('paginates and searches administrator bill items without changing whole-bill amounts', async () => {
  requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
  getAgentMonthlyBillDetailMock.mockResolvedValue({
    id: 'agent-bill-1', period: '2026-08', status: 'DRAFT',
    agentDisplayNameSnapshot: '外部销售甲', agentUsernameSnapshot: 'sales-a',
    memberSubtotal: '800.00', adjustmentAmount: '0.00', totalAmount: '800.00',
    confirmedAt: null, paidAt: null, receipt: null, adjustments: [],
    items: Array.from({ length: 61 }, (_, i) => ({
      id: `item-${i}`, orderId: `order-${i}`, orderNoSnapshot: `SEARCH-${String(i).padStart(3, '0')}`,
      orderStatusSnapshot: 'SETTLED', workOrderVersionSnapshot: 1,
      settledFeeSnapshot: '10.00', settledAtSnapshot: finishedAt, credits: [], order: { customName: `工单 ${i}` },
    })),
  });
  const html = renderToStaticMarkup(await AgentMonthlyBillDetailPage({ params: Promise.resolve({ id: 'agent-bill-1' }), searchParams: Promise.resolve({ q: 'SEARCH-', page: '3', returnTo: '/owner/agent-bills?status=DRAFT' }) }));
  expect(html).toContain('当前匹配 61 / 61 单');
  expect(html).toContain('800.00');
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(table.match(/<tr class="grid /g)).toHaveLength(1);
  expect(table).toContain('SEARCH-060');
  expect(table).not.toContain('SEARCH-059');
  expect(html).toContain('q=SEARCH-');
});
