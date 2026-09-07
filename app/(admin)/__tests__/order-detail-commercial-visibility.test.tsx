import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderKind,
  OrderChangeRequestStatus,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderPackagingMode,
  PieceworkOperationType,
  PieceworkRateUnit,
  ProductionOperationStatus,
  OrderProductStructure,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '@/generated/prisma/enums';

const {
  getOrderDetailMock,
  getSalesOrderDetailByIdMock,
  requireSessionMock,
  estimateMaterialUsageMock,
  sfCollectTogglePropsMock,
  fulfillmentPricingPropsMock,
  pieceworkSummaryMock,
  taskDisputesMock,
  reworkCraftOptionsMock,
  productionOperationsMock,
  productionProgressStepsMock,
  commercialDetailsPropsMock,
  listExternalCreateOrderProductOptionsMock,
  listExternalCreateOrderPaperOptionsMock,
} = vi.hoisted(() => ({
  getOrderDetailMock: vi.fn(),
  getSalesOrderDetailByIdMock: vi.fn(),
  requireSessionMock: vi.fn(),
  estimateMaterialUsageMock: vi.fn(),
  sfCollectTogglePropsMock: vi.fn(),
  fulfillmentPricingPropsMock: vi.fn(),
  pieceworkSummaryMock: vi.fn(),
  taskDisputesMock: vi.fn(),
  reworkCraftOptionsMock: vi.fn(),
  productionOperationsMock: vi.fn(),
  productionProgressStepsMock: vi.fn(),
  commercialDetailsPropsMock: vi.fn(),
  listExternalCreateOrderProductOptionsMock: vi.fn(),
  listExternalCreateOrderPaperOptionsMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: requireSessionMock,
  getSession: vi.fn(),
}));
vi.mock('@/lib/order', () => ({
  getOrderDetail: getOrderDetailMock,
}));
vi.mock('@/lib/order/sales-detail-query', () => ({
  getSalesOrderDetailById: getSalesOrderDetailByIdMock,
}));
vi.mock('@/lib/product', () => ({
  listExternalCreateOrderProductOptions:
    listExternalCreateOrderProductOptionsMock,
}));
vi.mock('@/lib/material', () => ({
  listExternalCreateOrderPaperOptions: listExternalCreateOrderPaperOptionsMock,
}));
// 标题取数模块直连 Prisma；不 mock 的话 import 链会拉起 lib/db，
// 在没有 DATABASE_URL 的 node 测试环境里模块加载即抛。
vi.mock('@/lib/page-title/refs', () => ({
  getOrderTitleRef: vi.fn(),
}));
vi.mock('@/lib/bom', () => ({
  estimateMaterialUsageForOrderItems: estimateMaterialUsageMock,
}));
vi.mock('@/lib/dashboard/format', () => ({
  formatMoney: (value: string | number) => `¥ ${Number(value).toFixed(2)}`,
}));
vi.mock('@/components/business/bom/OrderMaterialUsageEstimate', () => ({
  OrderMaterialUsageEstimate: () => null,
}));
vi.mock('@/components/business/order/DesignUploadPanel', () => ({
  DesignUploadPanel: () => null,
}));
vi.mock('@/components/business/order/PromisedDateBadge', () => ({
  PromisedDateBadge: () => null,
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
vi.mock('@/components/business/order/FulfillmentPricingReviewForm', () => ({
  FulfillmentPricingReviewForm: (props: unknown) => {
    fulfillmentPricingPropsMock(props);
    return <div>fulfillment-pricing-review</div>;
  },
}));
vi.mock('@/components/business/production/TaskDisputeAdminPanel', () => ({
  TaskDisputeAdminPanel: () => null,
}));
vi.mock('@/components/business/order/ReworkOrderForm', () => ({
  ReworkOrderForm: () => null,
}));
vi.mock('@/components/business/order/OrderChangeRequestForm', () => ({
  OrderChangeRequestForm: () => null,
}));
vi.mock('@/components/business/order/OrderCancellationRequestForm', () => ({
  OrderCancellationRequestForm: () => null,
}));
vi.mock('@/components/business/order/OrderChangeWithdrawButton', () => ({
  OrderChangeWithdrawButton: () => null,
}));
vi.mock('@/components/business/order/OrderChangeReviewForm', () => ({
  OrderChangeReviewForm: () => null,
}));
vi.mock('@/components/business/order/OrderPricingReviewForm', () => ({
  OrderPricingReviewForm: () => <div>factory-pricing-review</div>,
}));
vi.mock('@/components/business/order/OrderCommercialDetailsManager', () => ({
  OrderCommercialDetailsManager: (props: unknown) => {
    commercialDetailsPropsMock(props);
    return <div>commercial-details-manager</div>;
  },
}));
vi.mock('@/components/business/bill/OrderCostEntryForm', () => ({
  OrderCostEntryForm: () => null,
}));
vi.mock('@/lib/salary/daily', () => ({
  getOrderPieceworkSummary: pieceworkSummaryMock,
}));
vi.mock('@/lib/production/task-dispute', () => ({
  listOrderTaskDisputes: taskDisputesMock,
}));
vi.mock('@/lib/production/operation-order-view', () => ({
  listOrderProductionOperations: productionOperationsMock,
  listOrderProductionProgressSteps: productionProgressStepsMock,
}));
vi.mock('@/lib/order/rework', () => ({
  getReworkCraftOptions: reworkCraftOptionsMock,
  reworkItemRequiresUnitsPerBagInput: (
    membershipCount: number,
    pack: number | null | undefined,
  ) =>
    membershipCount === 0 &&
    (!Number.isSafeInteger(pack) || (pack ?? 0) <= 0),
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
  getSalesOrderDetailByIdMock.mockReset();
  requireSessionMock.mockReset();
  estimateMaterialUsageMock.mockReset().mockResolvedValue(null);
  sfCollectTogglePropsMock.mockReset();
  fulfillmentPricingPropsMock.mockReset();
  pieceworkSummaryMock.mockReset().mockResolvedValue(null);
  taskDisputesMock.mockReset().mockResolvedValue([]);
  reworkCraftOptionsMock.mockReset().mockResolvedValue([]);
  productionOperationsMock.mockReset().mockResolvedValue([]);
  productionProgressStepsMock.mockReset().mockResolvedValue([]);
  commercialDetailsPropsMock.mockReset();
  listExternalCreateOrderProductOptionsMock.mockReset().mockResolvedValue([]);
  listExternalCreateOrderPaperOptionsMock.mockReset().mockResolvedValue([]);
});

describe('order detail commercial visibility', () => {
  it.each([
    OrderSettlementType.EXTERNAL_SALES,
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
  ])('管理员可为收费结算路径 %s 进入工厂核价', async (settlementType) => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status: OrderStatus.PENDING_FACTORY,
      settlementType,
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 2,
      pricingRevisions: [],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('工单价格状态');
    expect(html).toContain('factory-pricing-review');
  });

  it('兼容态 SUBMITTED 仍显示工厂核价表单', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status: OrderStatus.SUBMITTED,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 2,
      pricingRevisions: [],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('factory-pricing-review');
    expect(html).toContain('commercial-details-manager');
    expect(commercialDetailsPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowPlateDetailMaintenance: false }),
    );
  });

  it.each([
    OrderStatus.DRAFT,
    OrderStatus.REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.ON_HOLD,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.SCHEDULING,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.COMPLETED,
    OrderStatus.SHIPPED,
    OrderStatus.SETTLED,
    OrderStatus.FINISHED,
    OrderStatus.CANCELLED,
  ])('工单状态 %s 不显示工厂核价表单', async (status) => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 2,
      pricingRevisions: [],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('工单价格状态');
    expect(html).not.toContain('factory-pricing-review');
    if (
      status === OrderStatus.SETTLED ||
      status === OrderStatus.FINISHED ||
      status === OrderStatus.CANCELLED
    ) {
      expect(html).not.toContain('commercial-details-manager');
    } else {
      expect(html).toContain('commercial-details-manager');
    }
  });

  it.each(['AUTO_CONFIRMED', 'ADMIN_CONFIRMED', 'LEGACY_CONFIRMED'])(
    '已确认状态 %s 不再渲染可提交核价表单',
    async (pricingStatus) => {
      requireSessionMock.mockResolvedValue({
        user: { id: 'admin-1', role: Role.ADMIN },
      });
      getOrderDetailMock.mockResolvedValue({
        ...orderFixture(),
        status: OrderStatus.IN_PRODUCTION,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        pricingStatus,
        priceRevision: 2,
        pricingRevisions: [],
      });

      const html = renderToStaticMarkup(
        await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
      );

      expect(html).toContain('工单价格状态');
      expect(html).not.toContain('factory-pricing-review');
      expect(html).toContain('commercial-details-manager');
      expect(commercialDetailsPropsMock).toHaveBeenCalledWith(
        expect.objectContaining({ allowPlateDetailMaintenance: true }),
      );
    },
  );

  it('免费工单不显示工厂核价入口', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status: OrderStatus.PENDING_FACTORY,
      settlementType: OrderSettlementType.NO_CHARGE,
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 2,
      pricingRevisions: [],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).not.toContain('factory-pricing-review');
    expect(html).not.toContain('工单价格状态');
  });

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
    expect(html).not.toContain('款式加工费');
    expect(html).not.toContain('入袋费');
    expect(html).not.toContain('加工费合计');
    expect(html).not.toContain('入袋单价');
    expect(html).not.toContain('入袋小计');
    expect(html).not.toContain('入袋费改价说明');
    expect(html).not.toContain('包装协议改价机密');
    expect(html).not.toContain('入袋计价明细');
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
    expect(html).not.toContain('客户要求非标准工艺人工核价');
    expect(html).not.toContain('内部材料成本秘密');
    expect(html).not.toContain('沿用原价 87654.32');
    expect(html).not.toContain('日志沿用原价 76543.21');
    expect(html).toContain('历史生产记录');
    expect(html).toContain('张师傅');
    expect(html).toContain('top:var(--admin-header-offset)');
    expect(html).toContain('z-[9]');
  });

  it('routes SALES through the narrow detail contract without exposing factory data', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });
    getSalesOrderDetailByIdMock.mockResolvedValue(salesDetailFixture());

    const html = renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(getSalesOrderDetailByIdMock).toHaveBeenCalledWith(
      { id: 'sales-1', role: Role.SALES },
      'order-1',
    );
    expect(getOrderDetailMock).not.toHaveBeenCalled();
    expect(html).toContain('款式加工费');
    expect(html).toContain('入袋加工费');
    expect(html).toContain('外部销售快递费');
    expect(html).toContain('外部销售打包耗材费');
    expect(html).toContain('制烫金版费');
    expect(html).toContain('待定');
    expect(html).toContain('已知合计（不含待定）');
    expect(html).not.toContain('¥ 待定');
    expect(html).toContain('申请修改工单');
    expect(html).toContain('返回工单列表');
    expect(html.match(/>估<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('师傅');
    expect(html).not.toContain('生产安排');
    expect(html).not.toContain('修改日志');
    expect(html).not.toContain('制版明细');
    expect(html).not.toContain('系统建议小计');
    expect(html).not.toContain('人工改价说明');
    expect(html).not.toContain('协议改价机密说明');
    expect(html).not.toContain('日志沿用原价 76543.21');
    expect(html).not.toContain('内部材料成本秘密');
  });

  it('清晰展示结构化款式事实与包装组组成', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.CUSTOMER_SERVICE },
    });
    getOrderDetailMock.mockResolvedValue(orderFixture());

    const html = renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(html).toContain('计价路线');
    expect(html).toContain('待管理员终价');
    expect(html).not.toContain('历史兼容');
    expect(html).toContain('万元封');
    expect(html).toContain('229.00 × 162.00 mm');
    expect(html).toContain('200 g/㎡');
    expect(html).toContain('客户确认版 V3');
    expect(html).toContain('PLATE-GROUP-7');
    expect(html).toContain('万元封-大号');
    expect(html).toContain('浮雕');
    expect(html).toContain('哑金（1 色）');
    expect(html).toContain('青、品红（2 色）');
    expect(html).toContain('人工报价原因');
    expect(html).toContain('客户要求非标准工艺人工核价');
    expect(html).toContain('包装组（1）');
    expect(html).toContain('单款装');
    expect(html).toContain('礼盒单款装');
    expect(html).toContain('每袋 8 个 · 全组 1,000 个');
    expect(html).toContain('入袋单价');
    expect(html).toContain('¥ 0.2000 / 袋');
    expect(html).toContain('入袋小计');
    expect(html).toContain('¥ 25.00');
    expect(html).toContain('基于业务第 1 版');
    expect(html).toContain('基于生产版本 历史未记录');
    expect(html).toContain('批准后生产版本 v2');
    expect(html).toContain('系统建议小计');
    expect(html).toContain('入袋费改价说明');
    expect(html).toContain('包装协议改价机密');
    expect(html).toContain('入袋计价明细（1）');
  });

  it('价格状态和来源不回显未知内部标识', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.CUSTOMER_SERVICE },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      pricingStatus: 'RAW_PRICING_STATUS',
      priceRevision: 2,
      pricingRevisions: [{ source: 'RAW_PRICING_SOURCE' }],
    });

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('未识别状态');
    expect(html).toContain('未识别来源');
    expect(html).not.toContain('RAW_PRICING_STATUS');
    expect(html).not.toContain('RAW_PRICING_SOURCE');
  });

  it('不向外部销售开放已发货工单的顺丰收费更正', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });
    getSalesOrderDetailByIdMock.mockResolvedValue({
      ...salesDetailFixture(),
      status: OrderStatus.SHIPPED,
      isSfCollect: true,
    });

    renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(sfCollectTogglePropsMock).not.toHaveBeenCalled();
    expect(fulfillmentPricingPropsMock).not.toHaveBeenCalled();
  });

  it('仅向管理员传递承运商实际重量，不回退创建时报价重量', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    const order = {
      ...orderFixture(),
      status: OrderStatus.SHIPPED,
      isSfCollect: true,
      pricingStatus: 'ADMIN_CONFIRMED',
      priceRevision: 1,
      pricingRevisions: [],
    };
    getOrderDetailMock.mockResolvedValue(order);

    renderToStaticMarkup(
      await OrderDetailPage({
        params: Promise.resolve({ id: 'order-1' }),
      }),
    );

    expect(sfCollectTogglePropsMock).not.toHaveBeenCalled();
    expect(fulfillmentPricingPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        currentValue: true,
        shipments: [
          expect.objectContaining({
            id: 'shipment-1',
            sequence: 1,
            destinationProvince: '广东',
            weightKg: null,
          }),
        ],
      }),
    );
  });

  it.each([
    OrderStatus.CONFIRMED, OrderStatus.ON_HOLD, OrderStatus.RELEASED,
    OrderStatus.FOILING, OrderStatus.PACKING, OrderStatus.SCHEDULING,
    OrderStatus.IN_PRODUCTION, OrderStatus.COMPLETED, OrderStatus.SHIPPED,
  ])('履约状态 %s 的待确认单进入物流复核，而非工厂全单重算', async (status) => {
    requireSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: Role.ADMIN } });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(), status, pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
      priceRevision: 1, pricingRevisions: [],
    });
    const html = renderToStaticMarkup(await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }));
    expect(html).toContain('fulfillment-pricing-review');
    expect(html).not.toContain('factory-pricing-review');
    expect(html).toContain('物流费用待管理员核对');
    expect(html).toContain('href="#fulfillment-pricing"');
    expect(sfCollectTogglePropsMock).not.toHaveBeenCalled();
    expect(fulfillmentPricingPropsMock).toHaveBeenCalledWith(expect.objectContaining({ isPricingPending: true }));
  });

  it('管理员工单详情只读展示无计件进度及完成数', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    getOrderDetailMock.mockResolvedValue({
      ...orderFixture(),
      status: OrderStatus.IN_PRODUCTION,
    });
    productionOperationsMock.mockResolvedValue([
      {
        id: 'operation-1',
        operationType: PieceworkOperationType.PARTIAL,
        unit: PieceworkRateUnit.PER_PASS,
        status: ProductionOperationStatus.IN_PROGRESS,
        plannedQty: '100',
        sources: [
          {
            orderItemId: 'item-1',
            packagingGroupId: null,
            sourceQty: '100',
          },
        ],
      },
    ]);
    productionProgressStepsMock.mockResolvedValue([
      {
        id: 'progress-1',
        craftCode: 'CLEANING',
        craftName: '清废',
        status: ProductionOperationStatus.IN_PROGRESS,
        plannedQty: '100',
        orderItemId: 'item-1',
        orderItem: { sequence: 1, name: '礼盒款' },
        reports: [
          { completedQty: '40', defectQty: '2', reworkQty: '1' },
        ],
      },
    ]);

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).toContain('无计件生产进度');
    expect(html).toContain('无计件进度（不计薪）');
    expect(html).toContain('清废：进行中（40/100）');
    expect(html).not.toContain('提交扫码报工');
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
      user: { id: 'sales-1', role: Role.CUSTOMER_SERVICE },
    });
    getOrderDetailMock.mockResolvedValue(inProductionWithGap());

    const html = renderToStaticMarkup(
      await OrderDetailPage({ params: Promise.resolve({ id: 'order-1' }) }),
    );

    expect(html).not.toContain('暂不能完工');
  });
});

function salesDetailFixture() {
  return {
    id: 'order-1',
    orderNo: 'GD-260807-001',
    customName: '中秋礼盒',
    customerRef: '客户甲',
    status: OrderStatus.IN_PRODUCTION,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    isUrgent: false,
    isSfCollect: false,
    revision: 2,
    workOrderVersion: 3,
    pricingStatus: 'AUTO_CONFIRMED',
    totalAmount: '98765.43',
    promisedDate: '2026-08-30',
    expressCode: null,
    packageRequirement: '注意防潮',
    remark: '客户等待收货',
    receiver: {
      name: '李先生',
      phone: '13800000000',
      address: '佛山市',
    },
    feeLines: [
      {
        id: 'processing',
        label: '款式加工费',
        amount: '98728.43',
        estimated: false,
      },
      {
        id: 'packaging',
        label: '入袋加工费',
        amount: '25.00',
        estimated: false,
      },
      {
        id: 'shipping',
        label: '外部销售快递费',
        amount: '8.00',
        estimated: false,
      },
      {
        id: 'packing-material',
        label: '外部销售打包耗材费',
        amount: '4.00',
        estimated: true,
      },
      {
        id: 'plate',
        label: '制烫金版费',
        amount: null,
        estimated: false,
      },
    ],
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '礼盒款',
        quantity: 1000,
        specification: '大号',
        paper: '艳红珠光纸 200g',
        frontFoilColors: ['哑金'],
        backFoilColors: [],
        foilColors: ['哑金'],
        isDoubleSided: false,
        remark: null,
        designs: [],
      },
    ],
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        status: 'PLANNED',
        receiverName: '李先生',
        receiverPhone: '13800000000',
        receiverAddress: '佛山市',
        expressCode: null,
        destinationProvince: '广东',
        trackingNo: null,
        lines: [
          {
            id: 'shipment-line-1',
            itemSequence: 1,
            itemName: '礼盒款',
            quantity: 1000,
          },
        ],
      },
    ],
    changeRequests: [],
  };
}

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
    packagingAmount: '25.00',
    totalAmount: '98765.43',
    revision: 1,
    workOrderVersion: 2,
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
    packagingGroups: [
      {
        id: 'packaging-1',
        sequence: 1,
        name: '礼盒单款装',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 125,
        unitPrice: '0.2000',
        subtotal: '25.00',
        suggestedSubtotal: '25.00',
        priceOverrideReason: '包装协议改价机密',
        pricingSnapshot: {
          components: [
            {
              source: 'BASE',
              sourceId: 'packing-single',
              name: '单款入袋费',
              adjustmentType: 'PER_ITEM',
              rate: '0.2000',
              units: '125',
              amount: '25.00',
            },
          ],
        },
        lines: [
          {
            id: 'packaging-line-1',
            unitsPerBag: 8,
            orderItem: { id: 'item-1', sequence: 1, name: '礼盒款' },
          },
        ],
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
        baseWorkOrderVersion: null,
        workOrderVersionAfter: 2,
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
        pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
        productStructure: OrderProductStructure.TEN_THOUSAND_ENVELOPE,
        artworkVersion: '客户确认版 V3',
        plateGroupId: 'PLATE-GROUP-7',
        pricingGroup: '万元封-大号',
        manualQuoteReason: '客户要求非标准工艺人工核价',
        specification: '大号',
        actualWidthMm: '229.00',
        actualHeightMm: '162.00',
        paperType: '艳红珠光纸',
        paperWeightGsm: 200,
        quantity: 1000,
        crafts: ['craft-1'],
        craftNames: ['局部烫金'],
        foilColors: ['哑金'],
        foilTechnique: OrderFoilTechnique.RELIEF,
        hasLocalFoil: true,
        printColors: ['青', '品红'],
        printColorsKnown: true,
        isDoubleSided: true,
        isDoubleColor: true,
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
