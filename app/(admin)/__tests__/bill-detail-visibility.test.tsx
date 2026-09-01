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

import OwnerBillDetailPage from '@/app/(admin)/owner/bills/[id]/page';
import SalesBillDetailPage from '@/app/(admin)/sales/bills/[id]/page';

const finishedAt = new Date('2026-08-01T02:00:00.000Z');
const paidAt = new Date('2026-08-02T03:00:00.000Z');

beforeEach(() => {
  getAdminBillDetailMock.mockReset();
  getSalesBillDetailMock.mockReset();
  requirePermissionMock.mockReset();
});

describe('bill detail visibility boundary', () => {
  it('renders only the external salesperson payable view of the receivable DTO', async () => {
    requirePermissionMock.mockResolvedValue({
      id: 'sales-1',
      role: Role.SALES,
    });
    getSalesBillDetailMock.mockResolvedValue({
      id: 'bill-1',
      salesUserId: 'sales-1',
      period: '2026-08',
      sequence: 2,
      openingAmount: '0.00',
      totalAmount: '500.00',
      paidAmount: '500.00',
      status: BillStatus.FULLY_PAID,
      issuedAt: paidAt,
      paidAt,
      remark: '对外结算备注',
      payments: [
        {
          id: 'payment-1',
          amount: '500.00',
          paidAt,
          paymentMethod: '银行转账',
          referenceNo: 'PUBLIC-001',
          remark: '收款已确认',
          idempotencyKey: 'payment-public-1',
          // Deliberately simulate an accidental over-rich runtime object. The
          // page must not render an internal operator even if one is supplied.
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
            customerRef: '外部客户甲',
            processingAmount: '488.00',
            finishedAt,
            status: OrderStatus.FINISHED,
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
                category: { code: 'PLATE_MAKING_FEE', name: '制烫金版费' },
                shipment: null,
              },
            ],
            costEntries: [
              {
                description: '秘密材料成本',
                amount: '88.00',
                createdBy: { displayName: '内部财务甲' },
              },
            ],
            items: [
              {
                id: 'order-item-1',
                sequence: 1,
                name: '礼盒款',
                pricingSnapshot: {
                  internalFormula: '内部公式秘密',
                  components: [
                    {
                      source: 'ADJUSTMENT',
                      sourceId: 'adjustment-1',
                      name: '局部烫金',
                      adjustmentType: 'PER_ORDER',
                      rate: '88.0000',
                      units: '1',
                      amount: '88.00',
                    },
                  ],
                },
                tasks: [
                  {
                    pieceworkAmount: '20.00',
                    worker: { displayName: '内部师傅秘密' },
                  },
                ],
              },
            ],
            outsourceOrders: [{ amount: '30.00' }],
            reworkOrders: [{ orderNo: '重做内部单' }],
          },
        },
      ],
    });

    const html = renderToStaticMarkup(
      await SalesBillDetailPage({
        params: Promise.resolve({ id: 'bill-1' }),
      }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('bill:view:self');
    expect(getSalesBillDetailMock).toHaveBeenCalledWith('bill-1', 'sales-1');
    expect(getAdminBillDetailMock).not.toHaveBeenCalled();
    expect(html).toContain('20260801-0001');
    expect(html).toContain('外部客户甲');
    expect(html).toContain('¥ 500.00');
    expect(html).toContain('¥ 488.00');
    expect(html).toContain('¥ 8.00');
    expect(html).toContain('¥ 4.00');
    expect(html).toContain('待定');
    expect(html).not.toContain('¥ 待定');
    expect(html).toContain('快递费');
    expect(html).toContain('打包耗材');
    expect(html).toContain('应付总额');
    expect(html).toContain('已支付');
    expect(html).toContain('grid-cols-1 gap-4 sm:grid-cols-3');
    expect(html.match(/<th scope="col"/g)).toHaveLength(9);
    expect(html).not.toContain('已收');
    expect(html).toContain('对外结算备注');
    expect(html).toContain('补充账单 #2');
    expect(html).toContain('加工费分项');
    expect(html).toContain('局部烫金');
    expect(html).toContain('¥ 88.00');
    expect(html).not.toContain('秘密材料成本');
    expect(html).not.toContain('内部财务甲');
    expect(html).not.toContain('内部师傅秘密');
    expect(html).not.toContain('内部公式秘密');
    expect(html).not.toContain('重做内部单');
    expect(html).not.toContain('补录成本流水');
    expect(html).not.toContain('收入与成本');
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
