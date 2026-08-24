import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderKind,
  OrderChangeRequestStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '@/generated/prisma/enums';

const {
  getOrderDetailMock,
  requireSessionMock,
  estimateMaterialUsageMock,
  sfCollectTogglePropsMock,
  pieceworkSummaryMock,
  reassignmentViewMock,
  reworkCraftOptionsMock,
} = vi.hoisted(() => ({
  getOrderDetailMock: vi.fn(),
  requireSessionMock: vi.fn(),
  estimateMaterialUsageMock: vi.fn(),
  sfCollectTogglePropsMock: vi.fn(),
  pieceworkSummaryMock: vi.fn(),
  reassignmentViewMock: vi.fn(),
  reworkCraftOptionsMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: requireSessionMock,
  getSession: vi.fn(),
}));
vi.mock('@/lib/order', () => ({
  getOrderDetail: getOrderDetailMock,
}));
// 标题取数模块直连 Prisma；不 mock 的话 import 链会拉起 lib/db，
// 在没有 DATABASE_URL 的 node 测试环境里模块加载即抛。
vi.mock('@/lib/page-title/refs', () => ({
  getOrderTitleRef: vi.fn(),
}));
vi.mock('@/lib/bom', () => ({
  estimateMaterialUsageForOrderItems: estimateMaterialUsageMock,
}));
vi.mock('@/components/business/bom/OrderMaterialUsageEstimate', () => ({
  OrderMaterialUsageEstimate: () => null,
}));
vi.mock('@/components/business/order/DesignUploadPanel', () => ({
  DesignUploadPanel: () => null,
}));
vi.mock('@/components/business/order/SubmitOrderButton', () => ({
  SubmitOrderButton: () => null,
}));
vi.mock('@/components/business/order/CancelOrderForm', () => ({
  CancelOrderForm: () => null,
}));
vi.mock('@/components/business/order/ShipOrderForm', () => ({
  ShipOrderForm: () => null,
}));
vi.mock('@/components/business/order/FinishOrderButton', () => ({
  FinishOrderButton: () => null,
}));
vi.mock('@/components/business/order/UrgentToggleForm', () => ({
  UrgentToggleForm: () => null,
}));
vi.mock('@/components/business/order/SfCollectToggleForm', () => ({
  SfCollectToggleForm: (props: unknown) => {
    sfCollectTogglePropsMock(props);
    return <span data-testid="sf-collect-toggle" />;
  },
}));
vi.mock('@/components/business/production/ReassignTaskForm', () => ({
  ReassignTaskForm: () => null,
}));
vi.mock('@/components/business/order/ReworkOrderForm', () => ({
  ReworkOrderForm: () => null,
}));
vi.mock('@/components/business/order/OrderChangeRequestForm', () => ({
  OrderChangeRequestForm: () => null,
}));
vi.mock('@/components/business/order/OrderChangeReviewForm', () => ({
  OrderChangeReviewForm: () => null,
}));
vi.mock('@/components/business/bill/OrderCostEntryForm', () => ({
  OrderCostEntryForm: () => null,
}));
vi.mock('@/lib/salary/daily', () => ({
  getOrderPieceworkSummary: pieceworkSummaryMock,
}));
vi.mock('@/lib/production', () => ({
  getPendingTaskReassignmentView: reassignmentViewMock,
}));
vi.mock('@/lib/order/rework', () => ({
  getReworkCraftOptions: reworkCraftOptionsMock,
}));
vi.mock('@/lib/oss/read-url', () => ({
  signDesignReadUrl: vi.fn((value: string) => value),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import OrderDetailPage from '@/app/(admin)/orders/[id]/page';

beforeEach(() => {
  getOrderDetailMock.mockReset();
  requireSessionMock.mockReset();
  estimateMaterialUsageMock.mockReset().mockResolvedValue(null);
  sfCollectTogglePropsMock.mockReset();
  pieceworkSummaryMock.mockReset().mockResolvedValue(null);
  reassignmentViewMock.mockReset().mockResolvedValue({ tasks: [] });
  reworkCraftOptionsMock.mockReset().mockResolvedValue([]);
});

describe('order detail commercial visibility', () => {
  it('does not render customer charges, overrides, or internal costs for WORKER', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'worker-1', role: Role.WORKER },
    });
    getOrderDetailMock.mockResolvedValue(orderFixture());

    const html = renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(getOrderDetailMock).toHaveBeenCalledWith('order-1', {
      id: 'worker-1',
      role: Role.WORKER,
    });
    expect(html).not.toContain('结算路径');
    expect(html).not.toContain('对客应收总额');
    expect(html).not.toContain('对客快递与打包耗材费');
    expect(html).not.toContain('外部销售快递费');
    expect(html).not.toContain('外部销售打包耗材费');
    expect(html).not.toContain('物流人工改价秘密');
    expect(html).not.toContain('一次性费用');
    expect(html).not.toContain('系统建议小计');
    expect(html).not.toContain('人工改价说明');
    expect(html).not.toContain('98765.43');
    expect(html).not.toContain('87654.32');
    expect(html).not.toContain('协议改价机密说明');
    expect(html).not.toContain('收费项目明细');
    expect(html).not.toContain('外部销售专属收费项');
    expect(html).not.toContain('内部材料成本秘密');
    expect(html).not.toContain('沿用原价 87654.32');
    expect(html).not.toContain('日志沿用原价 76543.21');
    expect(html).toContain('生产安排');
    expect(html).toContain('张师傅');
    expect(html).toContain(
      'top:calc(3.5rem + env(safe-area-inset-top, 0px))',
    );
    expect(html).toContain('z-[9]');
  });

  it('keeps customer charge details for SALES without exposing internal costs', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });
    getOrderDetailMock.mockResolvedValue(orderFixture());

    const html = renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(html).toContain('结算路径');
    expect(html).toContain('对客应收总额');
    expect(html).toContain('对客快递与打包耗材费');
    expect(html).toContain('外部销售快递费');
    expect(html).toContain('外部销售打包耗材费');
    expect(html).toContain('¥ 8.00');
    expect(html).toContain('¥ 4.00');
    expect(html).toContain('调整说明：物流人工改价秘密');
    expect(html).toContain('一次性费用');
    expect(html).toContain('系统建议小计');
    expect(html).toContain('人工改价说明');
    expect(html).toContain('98765.43');
    expect(html).toContain('87654.32');
    expect(html).toContain('协议改价机密说明');
    expect(html).toContain('收费项目明细（1）');
    expect(html).toContain('外部销售专属收费项');
    expect(html).toContain('¥ 888.00');
    expect(html).toContain('沿用原价 87654.32');
    expect(html).toContain('日志沿用原价 76543.21');
    expect(html).not.toContain('内部材料成本秘密');
  });

  it('不向外部销售开放已发货工单的顺丰收费更正', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });
    const order = {
      ...orderFixture(),
      status: OrderStatus.SHIPPED,
      isSfCollect: true,
    };
    getOrderDetailMock.mockResolvedValue(order);

    renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(sfCollectTogglePropsMock).not.toHaveBeenCalled();
  });

  it('仅向管理员传递已发货外部销售工单的逐票更正事实', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    const order = {
      ...orderFixture(),
      status: OrderStatus.SHIPPED,
      isSfCollect: true,
    };
    getOrderDetailMock.mockResolvedValue(order);

    renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(sfCollectTogglePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        currentValue: true,
        status: OrderStatus.SHIPPED,
        isExternalSales: true,
        shipments: [
          expect.objectContaining({
            id: 'shipment-1',
            sequence: 1,
            destinationProvince: '广东',
            weightKg: '2.000',
          }),
        ],
      }),
    );
  });
});

// 「暂不能完工」横幅。放在这个文件是因为它已经把 OrderDetailPage 的
// 二十来个依赖都 mock 齐了；单开文件要整段复制。
describe('order detail — 暂不能完工横幅', () => {
  const inProductionWithGap = () => ({
    ...orderFixture(),
    status: OrderStatus.IN_PRODUCTION,
    uncoveredOutsourceItems: [{ id: 'item-9', sequence: 2, name: '烫金款' }],
  });

  it('ADMIN 在生产中工单上看到缺口款式与补单入口', async () => {
    // 这条守的是「JSX 是不是死分支」：字段从 getOrderDetail 一路传到页面，
    // 中间任何一层丢掉它，tsc 都不会报（数组恒有 .length）。
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue(inProductionWithGap());

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('暂不能完工');
    expect(html).toContain('烫金款');
    expect(html).toContain('外协履约数量不足');
    expect(html).not.toContain('还没有任何未取消的外协单覆盖');
    expect(html).toContain('/foreman/outsource/new?orderId=order-1');
  });

  it('缺口为空时不出现横幅', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status: OrderStatus.IN_PRODUCTION,
      uncoveredOutsourceItems: [],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).not.toContain('暂不能完工');
  });

  it('非 ADMIN 看不到横幅（只有他们能建外协单）', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });
    getOrderDetailMock.mockResolvedValue(inProductionWithGap());

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).not.toContain('暂不能完工');
  });
});

function orderFixture() {
  const createdAt = new Date('2026-08-07T08:00:00.000Z');
  return {
    id: 'order-1',
    orderNo: 'GD-260807-001',
    submitterId: 'sales-1',
    status: OrderStatus.FINISHED,
    kind: OrderKind.NORMAL,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    isUrgent: false,
    isSfCollect: false,
    customName: '中秋礼盒',
    customerRef: '客户甲',
    receiverName: '李先生',
    receiverPhone: '13800000000',
    receiverAddress: '佛山市',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    processingAmount: '98753.43',
    totalAmount: '98765.43',
    revision: 1,
    promisedDate: null,
    createdAt,
    submitter: {
      id: 'sales-1',
      displayName: '销售甲',
      username: 'sales-1',
      role: Role.SALES,
    },
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        status: 'PLANNED',
        receiverName: '李先生',
        receiverPhone: '13800000000',
        receiverAddress: '佛山市',
        destinationProvince: '广东',
        quotedWeightKg: '2.000',
        weightKg: null,
        expressCode: null,
        trackingNo: null,
        lines: [],
      },
    ],
    customerCharges: [
      {
        id: 'charge-shipping-1',
        amount: '8.00',
        suggestedAmount: '8.00',
        quantity: '2.000',
        unit: 'kg',
        status: 'FINAL',
        description: '外部销售快递费',
        overrideReason: '物流人工改价秘密',
        category: { code: 'SHIPPING_FEE', name: '快递费' },
        shipment: { id: 'shipment-1', sequence: 1 },
        priceBook: {
          code: 'EXTERNAL_LOGISTICS',
          name: '对外物流',
          version: 1,
        },
      },
      {
        id: 'charge-packing-1',
        amount: '4.00',
        suggestedAmount: '4.00',
        quantity: '1000.000',
        unit: '个',
        status: 'ESTIMATED',
        description: '外部销售打包耗材费',
        overrideReason: null,
        category: { code: 'PACKING_MATERIAL', name: '打包耗材费' },
        shipment: { id: 'shipment-1', sequence: 1 },
        priceBook: {
          code: 'EXTERNAL_LOGISTICS',
          name: '对外物流',
          version: 1,
        },
      },
    ],
    sourceOrder: null,
    reworkOrders: [],
    outsourceOrders: [],
    // getOrderDetail 现在总会返回这个字段（款式级外协覆盖缺口，
    // 详情页「暂不能完工」横幅的数据源）。这张单是 FINISHED，
    // 横幅本来也只在 SCHEDULING / IN_PRODUCTION 才渲染。
    uncoveredOutsourceItems: [],
    changeRequests: [
      {
        id: 'change-1',
        status: OrderChangeRequestStatus.APPROVED,
        baseRevision: 1,
        reason: '客户调整数量',
        proposedChanges: { items: [] },
        reviewRemark: '沿用原价 87654.32',
        createdAt,
        requester: { displayName: '销售甲', role: Role.SALES },
      },
    ],
    logs: [
      {
        id: 'log-1',
        action: 'UPDATE',
        remark: '日志沿用原价 76543.21',
        createdAt,
        changedFields: {
          totalAmount: { before: '87654.32', after: '98765.43' },
        },
        operator: { displayName: '管理员', role: Role.ADMIN },
      },
    ],
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '礼盒款',
        specification: '大号',
        paperType: '艳红珠光纸',
        quantity: 1000,
        crafts: ['craft-1'],
        craftNames: ['局部烫金'],
        foilColors: ['哑金'],
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: '98.7654',
        fixedFee: '123.45',
        subtotal: '98888.85',
        suggestedPrice: '1.23',
        suggestedSubtotal: '98888.85',
        pricingSnapshot: {
          components: [
            {
              source: 'ADJUSTMENT',
              sourceId: 'external-sales-rule-1',
              name: '外部销售专属收费项',
              adjustmentType: 'PER_ORDER',
              rate: '888.0000',
              units: '1',
              amount: '888.00',
            },
          ],
        },
        priceOverrideReason: '协议改价机密说明',
        remark: null,
        designs: [],
        tasks: [
          {
            id: 'task-1',
            status: TaskStatus.IN_PROGRESS,
            craft: { id: 'craft-1', name: '局部烫金' },
            worker: { id: 'worker-1', displayName: '张师傅' },
          },
        ],
      },
    ],
    costEntries: [
      {
        id: 'cost-1',
        description: '内部材料成本秘密',
        amount: '999.00',
        createdBy: { displayName: '管理员' },
      },
    ],
  };
}
