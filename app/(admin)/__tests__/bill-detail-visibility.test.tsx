import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillStatus,
  OrderCostCategory,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '@/generated/prisma/enums';

const { getAdminBillDetailMock, getSalesBillDetailMock, requirePermissionMock } =
  vi.hoisted(() => ({
    getAdminBillDetailMock: vi.fn(),
    getSalesBillDetailMock: vi.fn(),
    requirePermissionMock: vi.fn(),
  }));

vi.mock('@/lib/agent-monthly-billing/sales-query', () => ({ getSalesMonthlyBill: getSalesBillDetailMock }));

vi.mock('@/lib/bill', () => ({
  getAdminBillDetail: getAdminBillDetailMock,
  getSalesBillDetail: getSalesBillDetailMock,
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
import SalesBillDetailPage from '@/app/(admin)/sales/bills/[id]/page';

const finishedAt = new Date('2026-08-01T02:00:00.000Z');
const paidAt = new Date('2026-08-02T03:00:00.000Z');

beforeEach(() => {
  getAdminBillDetailMock.mockReset();
  getSalesBillDetailMock.mockReset();
  requirePermissionMock.mockReset();
});

describe('bill detail visibility boundary', () => {
  it('renders frozen monthly bill facts without exposing internal notes or current order costs', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    getSalesBillDetailMock.mockResolvedValue({
      id: 'bill-1', period: '2026-08', status: 'PAID', memberSubtotal: '500.00', adjustmentAmount: '0.00', totalAmount: '500.00', confirmedAt: paidAt, paidAt,
      internalNote: '内部财务甲', adjustments: [],
      items: [{ id: 'item', orderNoSnapshot: '20260801-0001', customerRefSnapshot: '外部客户甲', workOrderVersionSnapshot: 2, settledFeeSnapshot: '500.00', settledAtSnapshot: finishedAt,
        order: { totalAmount: '9999.00', costs: '内部成本' } }],
    });
    const html = renderToStaticMarkup(await SalesBillDetailPage({ params: Promise.resolve({ id: 'bill-1' }) }));
    expect(getSalesBillDetailMock).toHaveBeenCalledWith({ id: 'sales-1', role: Role.SALES }, 'bill-1');
    expect(html).toContain('500.00');
    expect(html).toContain('20260801-0001');
    expect(html).toContain('外部客户甲');
    for (const forbidden of ['内部财务甲', '内部成本', '9999.00']) expect(html).not.toContain(forbidden);
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
            csSalesEntries: [],
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
