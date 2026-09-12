import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrderPackagingMode,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  ReworkCause,
  Role,
} from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  orderMock,
  reworkMock,
  changeRequestMock,
  pricingReviewMock,
  commercialDetailsMock,
  revalidatePathMock,
  redirectMock,
  MockOrderInvariantError,
  MockOrderQuoteChangedError,
  MockInvalidOrderTransitionError,
  MockReworkOrderError,
  MockOrderChangeRequestError,
  MockOrderPricingReviewError,
  MockProductionOperationMaterializationError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  orderMock: {
    createOrder: vi.fn(),
    submitOrder: vi.fn(),
    cancelOrder: vi.fn(),
    updateOrderFields: vi.fn(),
    setOrderUrgent: vi.fn(),
    setOrderSfCollect: vi.fn(),
    shipOrder: vi.fn(),
    finishOrder: vi.fn(),
  },
  reworkMock: {
    createReworkOrder: vi.fn(),
  },
  changeRequestMock: {
    createOrderChangeRequest: vi.fn(),
    previewOrderChangeRequestPricing: vi.fn(),
    reviewOrderChangeRequest: vi.fn(),
  },
  pricingReviewMock: {
    previewOrderPricingReview: vi.fn(),
    finalizeOrderPricing: vi.fn(),
  },
  commercialDetailsMock: {
    saveOrderManualCharge: vi.fn(),
    deleteOrderManualCharge: vi.fn(),
    saveOrderPlateDetail: vi.fn(),
    deleteOrderPlateDetail: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockOrderInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OrderInvariantError';
    }
  },
  MockOrderQuoteChangedError: class extends Error {
    readonly quoteToken: string;
    readonly quotedFee: string;
    readonly quotedFeeCompleteness: OrderQuotedFeeCompleteness;
    constructor() {
      super('报价已变化，请再次复核');
      this.name = 'OrderQuoteChangedError';
      this.quoteToken = `create-order-quote-v2:${'a'.repeat(64)}`;
      this.quotedFee = '566.30';
      this.quotedFeeCompleteness = OrderQuotedFeeCompleteness.COMPLETE;
    }
  },
  MockInvalidOrderTransitionError: class extends Error {
    readonly from: OrderStatus;
    readonly to: OrderStatus;
    constructor(from: OrderStatus, to: OrderStatus) {
      super(`工单状态不能从 ${from} 直接切到 ${to}`);
      this.name = 'InvalidOrderTransitionError';
      this.from = from;
      this.to = to;
    }
  },
  MockReworkOrderError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ReworkOrderError';
    }
  },
  MockOrderChangeRequestError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OrderChangeRequestError';
    }
  },
  MockOrderPricingReviewError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OrderPricingReviewError';
    }
  },
  MockProductionOperationMaterializationError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly detail: unknown = null,
    ) {
      super(message);
      this.name = 'ProductionOperationMaterializationError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/order', () => ({
  createOrder: orderMock.createOrder,
  submitOrder: orderMock.submitOrder,
  cancelOrder: orderMock.cancelOrder,
  updateOrderFields: orderMock.updateOrderFields,
  setOrderUrgent: orderMock.setOrderUrgent,
  setOrderSfCollect: orderMock.setOrderSfCollect,
  shipOrder: orderMock.shipOrder,
  finishOrder: orderMock.finishOrder,
  OrderInvariantError: MockOrderInvariantError,
  OrderQuoteChangedError: MockOrderQuoteChangedError,
  InvalidOrderTransitionError: MockInvalidOrderTransitionError,
}));
vi.mock('@/lib/order/rework', () => ({
  createReworkOrder: reworkMock.createReworkOrder,
  ReworkOrderError: MockReworkOrderError,
}));
vi.mock('@/lib/order/change-request', () => ({
  createOrderChangeRequest: changeRequestMock.createOrderChangeRequest,
  previewOrderChangeRequestPricing:
    changeRequestMock.previewOrderChangeRequestPricing,
  reviewOrderChangeRequest: changeRequestMock.reviewOrderChangeRequest,
  OrderChangeRequestError: MockOrderChangeRequestError,
}));
vi.mock('@/lib/order/pricing-review', () => ({
  previewOrderPricingReview: pricingReviewMock.previewOrderPricingReview,
  finalizeOrderPricing: pricingReviewMock.finalizeOrderPricing,
  OrderPricingReviewError: MockOrderPricingReviewError,
}));
vi.mock('@/lib/production/operation-materialization-service', () => ({
  ProductionOperationMaterializationError: MockProductionOperationMaterializationError,
}));
vi.mock('@/lib/order/commercial-details', () => ({
  ...commercialDetailsMock,
  OrderCommercialDetailsError: class extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createOrderAction,
  createReworkOrderAction,
  submitOrderAction,
  cancelOrderAction,
  updateOrderAction,
  setOrderUrgentAction,
  setOrderSfCollectAction,
  shipOrderAction,
  finishOrderAction,
  previewOrderChangeRequestPricingAction,
  reviewOrderChangeRequestAction,
  previewOrderPricingReviewAction,
  finalizeOrderPricingAction,
  saveOrderManualChargeAction,
  deleteOrderManualChargeAction,
  saveOrderPlateDetailAction,
  deleteOrderPlateDetailAction,
} from '../order';

const salesActor = {
  id: 'sales-1',
  username: 'sal',
  displayName: '销售小王',
  role: Role.SALES,
  workerType: null,
  machineType: null,
};

const internalSalesActor = {
  ...salesActor,
  id: 'internal-sales-1',
  role: Role.CUSTOMER_SERVICE,
};

function baseOrderInput(over: Record<string, unknown> = {}) {
  return {
    customerRef: '苹果福',
    receiverName: null,
    receiverPhone: null,
    receiverAddress: '佛山市南海区测试路 1 号',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    isUrgent: false,
    isSfCollect: false,
    packagingGroups: [
      {
        name: '单款装',
        mode: 'SINGLE_STYLE',
        actualBagCount: 1,
        itemUnitsPerBag: [1000],
      },
    ],
    items: [
      {
        name: '烫金款 A',
        productId: 'product-1',
        pricingRoute: 'COLOR_PRINT',
        productStructure: 'STANDARD_ENVELOPE',
        manualQuoteReason: null,
        specification: null,
        paperType: '艳红珠光纸',
        quantity: 1000,
        crafts: ['craft-1'],
        foilColors: [],
        foilTechnique: 'NONE',
        hasLocalFoil: false,
        printColors: ['C', 'M', 'Y', 'K'],
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: '0.5',
        suggestedSubtotal: null,
        remark: null,
      },
    ],
    ...over,
  };
}

function externalOrderInput(over: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: '7f26a5c0-21b7-4eef-8f11-0ae59d2c2339',
    nextItemFig: 8,
    customName: '王总中秋信封',
    customerPartyId: null,
    customerRef: '王总',
    receiverName: '王先生',
    receiverPhone: '13800138000',
    receiverAddress: '上海市浦东新区测试路 1 号',
    destinationProvince: '上海',
    expressCode: null,
    packageRequirement: '客户原话：每包 1000 个',
    remark: null,
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    additionalShipments: [],
    packagingGroups: [
      {
        name: '第 7 款单款装',
        mode: 'SINGLE_STYLE',
        actualBagCount: 1,
        itemUnitsPerBag: [1000],
      },
    ],
    items: [
      {
        fig: 7,
        name: '第 7 款',
        productId: 'product-1',
        pricingRoute: 'STOCK_BLANK',
        productStructure: 'STANDARD_ENVELOPE',
        specification: '西封中号',
        actualWidthMm: 110,
        actualHeightMm: 220,
        paperType: '艳红珠光纸',
        paperWeightGsm: 160,
        quantity: 1000,
        pack: 1000,
        crafts: ['craft-1'],
        frontFoilColors: ['亚金'],
        backFoilColors: [],
        foilColors: ['亚金'],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
        lamination: 'NONE',
        printColors: [],
        isDoubleSided: false,
        isDoubleColor: false,
        remark: null,
      },
    ],
    ...over,
  };
}

const fd = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

const ORDER_EDIT_TOKEN = '7';
const editFd = (data: Record<string, string>) =>
  fd({ expectedEditVersion: ORDER_EDIT_TOKEN, ...data });

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  orderMock.createOrder.mockReset();
  orderMock.submitOrder.mockReset();
  orderMock.cancelOrder.mockReset();
  orderMock.updateOrderFields.mockReset();
  orderMock.setOrderUrgent.mockReset();
  orderMock.setOrderSfCollect.mockReset();
  orderMock.shipOrder.mockReset();
  orderMock.finishOrder.mockReset();
  reworkMock.createReworkOrder.mockReset();
  changeRequestMock.createOrderChangeRequest.mockReset();
  changeRequestMock.previewOrderChangeRequestPricing.mockReset();
  changeRequestMock.reviewOrderChangeRequest.mockReset();
  pricingReviewMock.previewOrderPricingReview.mockReset();
  pricingReviewMock.finalizeOrderPricing.mockReset();
  commercialDetailsMock.saveOrderManualCharge.mockReset();
  commercialDetailsMock.deleteOrderManualCharge.mockReset();
  commercialDetailsMock.saveOrderPlateDetail.mockReset();
  commercialDetailsMock.deleteOrderPlateDetail.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createOrderAction', () => {
  it("first-line requirePermission('order:create')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createOrderAction(null, baseOrderInput())).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:create');
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('权限失败时不读取或解析原始 payload', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    const raw = Object.defineProperty({}, 'items', {
      enumerable: true,
      get() {
        throw new Error('payload 不应被读取');
      },
    });

    await expect(createOrderAction(null, raw)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('外部销售显式提交 null 价格也被拒绝', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const input = externalOrderInput();
    const result = await createOrderAction(null, {
      ...input,
      quotedFee: null,
      items: [{ ...input.items[0], unitPrice: null }],
    });

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        quotedFee: [expect.stringContaining('服务端生成')],
        'items.0.unitPrice': [expect.stringContaining('服务端生成')],
      },
    });
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('外部 FULL 反面错误定位到款式字段', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const input = externalOrderInput();
    const result = await createOrderAction(null, {
      ...input,
      items: [
        {
          ...input.items[0],
          pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
          frontFoilColors: ['亚金'],
          backFoilColors: ['红色'],
          foilColors: ['亚金', '红色'],
          hasLocalFoil: false,
        },
      ],
    });

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        'items.0.backFoilColors': ['专版烫金只允许正面'],
      },
    });
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('内部销售保持原 schema，兼容现有价格字段', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    orderMock.createOrder.mockResolvedValue({
      id: 'order-internal',
      orderNo: '20260423-0002',
      itemIds: ['item-1'],
      pricingStatus: 'AUTO_CONFIRMED',
    });

    const result = await createOrderAction(
      null,
      baseOrderInput({ shippingFee: '12.30' }),
    );

    expect(result.status).toBe('success');
    expect(orderMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingFee: '12.30',
        items: [expect.objectContaining({ unitPrice: '0.5' })],
      }),
      internalSalesActor,
    );
  });

  it('short-circuits on schema failure (empty items)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    const result = await createOrderAction(null, baseOrderInput({ items: [] }));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.items).toBeDefined();
    }
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['空字符串', ''],
    ['纯空格', '   '],
    ['缺失', undefined],
  ])('主收货地址为%s时不进入领域创建', async (_label, receiverAddress) => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);

    const result = await createOrderAction(
      null,
      baseOrderInput({ receiverAddress }),
    );

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.receiverAddress).toContain('请填写收货地址');
    }
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('flattens nested error paths (items.0.quantity) into dotted keys', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    const input = baseOrderInput();
    // Tamper: quantity = 0, which fails min(1) inside an item.
    const badItems = input.items.map((it) => ({ ...it, quantity: 0 }));
    const result = await createOrderAction(null, { ...input, items: badItems });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(Object.keys(result.fieldErrors).some((k) => k.startsWith('items.0'))).toBe(
        true,
      );
    }
  });

  it('trims a custom name and rejects names longer than 100 characters', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    orderMock.createOrder.mockResolvedValue({
      id: 'order-new',
      orderNo: '20260423-0001',
      itemIds: ['item-1'],
      pricingStatus: 'AUTO_CONFIRMED',
    });

    await createOrderAction(
      null,
      baseOrderInput({ customName: '  王总中秋礼盒首批  ' }),
    );
    expect(orderMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customName: '王总中秋礼盒首批' }),
      internalSalesActor,
    );

    orderMock.createOrder.mockClear();
    const invalid = await createOrderAction(
      null,
      baseOrderInput({ customName: '名'.repeat(101) }),
    );
    expect(invalid.status).toBe('invalid');
    expect(orderMock.createOrder).not.toHaveBeenCalled();
  });

  it('maps OrderInvariantError → error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    orderMock.createOrder.mockRejectedValueOnce(
      new MockOrderInvariantError('工艺不存在：craft-X'),
    );
    const result = await createOrderAction(null, baseOrderInput());
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('工艺不存在');
    }
  });

  it('返回外部销售包装覆盖的服务边界错误', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.createOrder.mockRejectedValueOnce(
      new MockOrderInvariantError(
        '外部销售工单必须为每个款式设置一个包装组',
      ),
    );

    const result = await createOrderAction(
      null,
      externalOrderInput({ packagingGroups: [] }),
    );

    expect(orderMock.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ packagingGroups: [] }),
      salesActor,
    );
    expect(result).toEqual({
      status: 'error',
      message: '外部销售工单必须为每个款式设置一个包装组',
    });
  });

  it('returns a catalog-route invariant as a create error instead of an unhandled failure', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    orderMock.createOrder.mockRejectedValueOnce(
      new MockOrderInvariantError(
        '建单产品“EXT-CUSTOM”的分类与计价路线“局部烫金（通版现货）”不一致',
      ),
    );

    await expect(
      createOrderAction(null, baseOrderInput()),
    ).resolves.toEqual({
      status: 'error',
      message:
        '建单产品“EXT-CUSTOM”的分类与计价路线“局部烫金（通版现货）”不一致',
    });
  });

  it('revalidates and returns ordered item ids for post-create design uploads', async () => {
    permissionsMock.requirePermission.mockResolvedValue(internalSalesActor);
    orderMock.createOrder.mockResolvedValue({
      id: 'order-new',
      orderNo: '20260423-0001',
      itemIds: ['item-1'],
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
    });

    const result = await createOrderAction(null, baseOrderInput());

    expect(result).toEqual({
      status: 'success',
      orderId: 'order-new',
      orderNo: '20260423-0001',
      itemIds: ['item-1'],
      pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('passes the actor through to lib.createOrder (submitter + createdBy attribution)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.createOrder.mockResolvedValue({
      id: 'order-new',
      orderNo: '20260423-0001',
      itemIds: ['item-1'],
      pricingStatus: 'AUTO_CONFIRMED',
    });

    await createOrderAction(null, externalOrderInput());
    expect(orderMock.createOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'sales-1', role: Role.SALES }),
    );
  });
});

describe('createReworkOrderAction', () => {
  const input = {
    sourceOrderId: 'source-1',
    cause: ReworkCause.QUALITY,
    reason: '烫金位置偏移',
    items: [
      {
        sourceOrderItemId: 'item-1',
        quantity: 100,
        craftIds: ['craft-1'],
      },
    ],
  };

  it("first-line requirePermission('order:change:review')", async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      createReworkOrderAction(null, input),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:change:review',
    );
    expect(reworkMock.createReworkOrder).not.toHaveBeenCalled();
  });

  it('validates nested item data before calling the domain layer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const result = await createReworkOrderAction(null, {
      ...input,
      items: [{ ...input.items[0], quantity: 0 }],
    });
    expect(result.status).toBe('invalid');
    expect(reworkMock.createReworkOrder).not.toHaveBeenCalled();
  });

  it('passes explicit legacy packaging evidence through to the domain layer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    reworkMock.createReworkOrder.mockResolvedValueOnce({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
    });

    await createReworkOrderAction(null, {
      ...input,
      cause: ReworkCause.LOGISTICS_DAMAGE,
      items: [
        {
          ...input.items[0],
          craftIds: [],
          unitsPerBag: '40',
        },
      ],
    });

    expect(reworkMock.createReworkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ craftIds: [], unitsPerBag: 40 }),
        ],
      }),
      salesActor,
    );
  });

  it('maps domain errors and revalidates the source and order list views', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    reworkMock.createReworkOrder.mockRejectedValueOnce(
      new MockReworkOrderError('只有已发货或已完成工单可以发起重做'),
    );
    const failed = await createReworkOrderAction(null, input);
    expect(failed).toEqual({
      status: 'error',
      message: '只有已发货或已完成工单可以发起重做',
    });

    reworkMock.createReworkOrder.mockResolvedValueOnce({
      id: 'rework-1',
      orderNo: 'GD-260731-001',
    });
    const success = await createReworkOrderAction(null, input);
    expect(success).toEqual({ status: 'success', orderId: 'rework-1' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/source-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/rework-1');
  });
});

describe('submitOrderAction', () => {
  it('requires order:create', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(submitOrderAction('o1')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps InvalidOrderTransitionError → error (client-facing message)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockRejectedValueOnce(
      new MockInvalidOrderTransitionError(OrderStatus.IN_PRODUCTION, OrderStatus.SUBMITTED),
    );
    const r = await submitOrderAction('o1');
    expect(r.status).toBe('error');
  });

  it('propagates the lib-level ownership guard (non-owner SALES submitting another SALES\'s draft)', async () => {
    // The guard actually lives in lib/order.submitOrder's authz callback
    // (round 27). Action layer just surfaces the OrderInvariantError it
    // throws. Belt-and-suspenders test: a direct POST that bypasses the
    // UI still returns an error instead of letting the transition through.
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockRejectedValueOnce(
      new MockOrderInvariantError('只能提交自己创建的工单'),
    );
    const r = await submitOrderAction('o1');
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.message).toBe('只能提交自己创建的工单');
    }
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:create');
  });

  it('revalidates both routes on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.PENDING_FACTORY,
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
    const token = `create-order-quote-v2:${'b'.repeat(64)}`;
    const r = await submitOrderAction('o1', token);
    expect(r).toEqual({
      status: 'success',
      readyForProduction: false,
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
    expect(orderMock.submitOrder).toHaveBeenCalledWith(
      'o1',
      salesActor,
      expect.any(Date),
      token,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
  });

  it.each([
    [OrderStatus.CONFIRMED, true],
    [OrderStatus.SUBMITTED, false],
    [OrderStatus.PENDING_FACTORY, false],
  ])('reports production readiness from the committed status %s', async (status, readyForProduction) => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockResolvedValueOnce({
      id: 'o1', status, quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
    await expect(submitOrderAction('o1')).resolves.toEqual({
      status: 'success', readyForProduction, quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
  });

  it('报价变化时返回稳定 QUOTE_CHANGED 结果且不刷新路由', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.submitOrder.mockRejectedValueOnce(
      new MockOrderQuoteChangedError(),
    );

    const r = await submitOrderAction('o1', null);

    expect(r).toMatchObject({
      status: 'quote_changed',
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('在进入提交事务前拒绝非法报价 token', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);

    const r = await submitOrderAction('o1', 'forged');

    expect(r).toEqual({
      status: 'invalid',
      fieldErrors: { quoteToken: ['报价确认标识格式非法'] },
    });
    expect(orderMock.submitOrder).not.toHaveBeenCalled();
  });
});

describe('cancelOrderAction', () => {
  it("first-line requirePermission('order:cancel') — cancellation is ADMIN-only", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      cancelOrderAction('o1', null, fd({ reason: '' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:cancel');
  });

  it('rejects an empty cancellation reason before the destructive write', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    const r = await cancelOrderAction('o1', null, fd({ reason: '' }));
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      expect(r.fieldErrors.reason?.[0]).toMatch(/取消原因/);
    }
    expect(orderMock.cancelOrder).not.toHaveBeenCalled();
  });

  it('forwards a trimmed reason', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrderAction('o1', null, fd({ reason: '  客户临时取消  ' }));
    expect(orderMock.cancelOrder).toHaveBeenCalledWith(
      'o1',
      expect.anything(),
      '客户临时取消',
    );
  });

  it('rejects a non-string reason (e.g., File upload) as invalid (Codex round 27 / P2)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const f = new FormData();
    f.set('reason', new Blob(['malicious'], { type: 'text/plain' }), 'reason.txt');
    const result = await cancelOrderAction('o1', null, f);
    expect(result.status).toBe('invalid');
    expect(orderMock.cancelOrder).not.toHaveBeenCalled();
  });

  it('maps InvalidOrderTransitionError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockRejectedValueOnce(
      new MockInvalidOrderTransitionError(OrderStatus.FINISHED, OrderStatus.CANCELLED),
    );
    const r = await cancelOrderAction(
      'o1',
      null,
      fd({ reason: '客户取消' }),
    );
    expect(r.status).toBe('error');
  });

  it('revalidates both routes on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.cancelOrder.mockResolvedValue({ id: 'o1', status: OrderStatus.CANCELLED });
    await cancelOrderAction('o1', null, fd({ reason: '客户取消' }));
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
  });
});

describe('shipOrderAction', () => {
  function appendShipCommandSnapshot(formData: FormData): void {
    formData.set('expectedRevision', '4');
    formData.set('expectedEditVersion', '8');
    formData.set('expectedWorkOrderVersion', '2');
    formData.set('expectedPriceRevision', '3');
    formData.set(
      'idempotencyKey',
      '00000000-0000-4000-8000-000000000101',
    );
  }

  it('fails closed when the command snapshot or request identity is absent', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const formData = new FormData();
    formData.append('shipmentId', 'shipment-1');
    formData.append('shipmentTrackingNo', 'SF001');

    const result = await shipOrderAction('order-1', null, formData);

    expect(result).toMatchObject({
      status: 'invalid',
      fieldErrors: {
        expectedRevision: expect.any(Array),
        expectedEditVersion: expect.any(Array),
        expectedWorkOrderVersion: expect.any(Array),
        expectedPriceRevision: expect.any(Array),
        idempotencyKey: expect.any(Array),
      },
    });
    expect(orderMock.shipOrder).not.toHaveBeenCalled();
  });

  it('passes every address id and its own trimmed tracking number', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.shipOrder.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });
    const formData = new FormData();
    appendShipCommandSnapshot(formData);
    formData.append('shipmentId', 'shipment-1');
    formData.append('shipmentTrackingNo', ' SF001 ');
    formData.append('shipmentId', 'shipment-2');
    formData.append('shipmentTrackingNo', 'SF002');

    const result = await shipOrderAction('order-1', null, formData);

    expect(result).toEqual({ status: 'success' });
    expect(orderMock.shipOrder).toHaveBeenCalledWith(
      'order-1',
      salesActor,
      {
        expectedRevision: 4,
        expectedEditVersion: 8,
        expectedWorkOrderVersion: 2,
        expectedPriceRevision: 3,
        idempotencyKey: '00000000-0000-4000-8000-000000000101',
        trackingNo: null,
        shipments: [
          {
            shipmentId: 'shipment-1',
            trackingNo: 'SF001',
            destinationProvince: null,
            shippingFee: null,
            packingMaterialFee: null,
            customerChargeOverrideReason: null,
          },
          {
            shipmentId: 'shipment-2',
            trackingNo: 'SF002',
            destinationProvince: null,
            shippingFee: null,
            packingMaterialFee: null,
            customerChargeOverrideReason: null,
          },
        ],
      },
    );
  });

  it('keeps each address charge inputs aligned with its shipment id', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.shipOrder.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.SHIPPED,
    });
    const formData = new FormData();
    appendShipCommandSnapshot(formData);
    for (const [id, province, shipping, packing, reason] of [
      ['shipment-1', '广东', '2.80', '1.00', '首票确认'],
      ['shipment-2', '新疆', '17.30', '3.00', '第二票确认'],
    ]) {
      formData.append('shipmentId', id);
      formData.append('shipmentTrackingNo', '');
      formData.append('shipmentDestinationProvince', province);
      formData.append('shipmentShippingFee', shipping);
      formData.append('shipmentPackingMaterialFee', packing);
      formData.append('shipmentChargeOverrideReason', reason);
    }

    await shipOrderAction('order-1', null, formData);

    expect(orderMock.shipOrder).toHaveBeenCalledWith(
      'order-1',
      salesActor,
      {
        expectedRevision: 4,
        expectedEditVersion: 8,
        expectedWorkOrderVersion: 2,
        expectedPriceRevision: 3,
        idempotencyKey: '00000000-0000-4000-8000-000000000101',
        trackingNo: null,
        shipments: [
          expect.objectContaining({
            shipmentId: 'shipment-1',
            destinationProvince: '广东',
            shippingFee: '2.80',
            packingMaterialFee: '1.00',
            customerChargeOverrideReason: '首票确认',
          }),
          expect.objectContaining({
            shipmentId: 'shipment-2',
            destinationProvince: '新疆',
            shippingFee: '17.30',
            packingMaterialFee: '3.00',
            customerChargeOverrideReason: '第二票确认',
          }),
        ],
      },
    );
  });

  it('rejects mismatched shipment and tracking fields before the domain call', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const formData = new FormData();
    appendShipCommandSnapshot(formData);
    formData.append('shipmentId', 'shipment-1');
    const result = await shipOrderAction('order-1', null, formData);
    expect(result.status).toBe('invalid');
    expect(orderMock.shipOrder).not.toHaveBeenCalled();
  });
});

describe('finishOrderAction', () => {
  it('fails closed without calling the legacy SHIPPED to FINISHED writer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);

    await expect(finishOrderAction('order-1')).resolves.toEqual({
      status: 'error',
      message: '旧版完结入口已停用，请使用管理端“结算”操作',
    });

    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:ship');
    expect(orderMock.finishOrder).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe('updateOrderAction', () => {
  it('forwards the external sales account separately from customer master data', async () => {
    permissionsMock.requirePermission.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
    await expect(updateOrderAction('o1', null, editFd({ externalSalesUserId: ' sales-2 ' }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(orderMock.updateOrderFields).toHaveBeenCalledWith('o1', {
      expectedEditVersion: 7, externalSalesUserId: 'sales-2',
    }, expect.objectContaining({ role: Role.ADMIN }));
  });

  it('rejects an empty external sales account instead of clearing ownership', async () => {
    const result = await updateOrderAction('o1', null, editFd({ externalSalesUserId: '' }));
    expect(result).toMatchObject({ status: 'invalid', fieldErrors: { externalSalesUserId: expect.any(Array) } });
    expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
  });

  it('shows domain authorization failures for attempted account reassignment', async () => {
    orderMock.updateOrderFields.mockRejectedValue(new MockOrderInvariantError('只有管理员可以更换关联外部销售'));
    const result = await updateOrderAction('o1', null, editFd({ externalSalesUserId: 'sales-2' }));
    expect(result).toEqual({ status: 'error', message: '只有管理员可以更换关联外部销售' });
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("first-line requirePermission('order:create')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      updateOrderAction('o1', null, fd({ remark: 'x' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:create');
    expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
  });

  it('rejects malformed shipment JSON before invoking the domain', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const result = await updateOrderAction(
      'o1',
      null,
      editFd({ shipments: '{invalid' }),
    );
    expect(result).toMatchObject({
      status: 'invalid',
      fieldErrors: { shipments: ['配送信息格式非法'] },
    });
    expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
  });


  it('forwards parsed text fields to updateOrderFields', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['remark'],
    });
    await expect(
      updateOrderAction(
        'o1',
        null,
        editFd({ remark: '新备注', receiverName: '张三' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const args = orderMock.updateOrderFields.mock.calls[0];
    expect(args[0]).toBe('o1');
    expect(args[1]).toMatchObject({
      expectedEditVersion: 7,
      remark: '新备注',
      receiverName: '张三',
    });
  });

  it('parses isUrgent="on" (HTML checkbox) as true', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['isUrgent'],
    });
    await expect(
      updateOrderAction('o1', null, editFd({ isUrgent: 'on' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(orderMock.updateOrderFields).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ isUrgent: true }),
      expect.anything(),
    );
  });

  it('普通编辑不再解析或下传专用的 isSfCollect 字段', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      changed: false,
      changedFields: [],
    });
    await expect(
      updateOrderAction('o1', null, editFd({ isSfCollect: 'false' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const payload = orderMock.updateOrderFields.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('isSfCollect');
  });

  it.each([[''], ['   ']])(
    '收货地址为空时在 action schema 层拒绝',
    async (receiverAddress) => {
      permissionsMock.requirePermission.mockResolvedValue(salesActor);
      const result = await updateOrderAction(
        'o1',
        null,
        editFd({ receiverAddress }),
      );
      expect(result).toEqual({
        status: 'invalid',
        fieldErrors: expect.objectContaining({
          receiverAddress: expect.arrayContaining(['请填写收货地址']),
        }),
      });
      expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
    },
  );

  it('有效收货地址修剪后下传领域层', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['receiverAddress'],
    });
    await expect(
      updateOrderAction(
        'o1',
        null,
        editFd({ receiverAddress: '  佛山市南海区  ' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(orderMock.updateOrderFields).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ receiverAddress: '佛山市南海区' }),
      salesActor,
    );
  });

  it('omits isUrgent from the payload when the form did not submit it (partial update)', async () => {
    // The SHIPPING_ONLY edit form won't include the 急单 checkbox; a
    // missing field must stay missing so updateOrderFields leaves the
    // flag alone instead of flipping it to false.
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.IN_PRODUCTION,
      changed: true,
      changedFields: ['receiverName'],
    });
    await expect(
      updateOrderAction('o1', null, editFd({ receiverName: '新收货人' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const parsed = orderMock.updateOrderFields.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect('isUrgent' in parsed).toBe(false);
  });

  it('rejects a File upload in a text field as invalid', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    const f = new FormData();
    f.set('expectedEditVersion', ORDER_EDIT_TOKEN);
    f.set('remark', new Blob(['x'], { type: 'text/plain' }), 'r.txt');
    const result = await updateOrderAction('o1', null, f);
    expect(result.status).toBe('invalid');
    expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
  });

  it('maps OrderInvariantError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockRejectedValueOnce(
      new MockOrderInvariantError('当前状态不可编辑'),
    );
    const result = await updateOrderAction('o1', null, editFd({ remark: 'x' }));
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('当前状态不可编辑');
    }
  });

  it('revalidates + redirects to detail on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.updateOrderFields.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['remark'],
    });
    await expect(
      updateOrderAction('o1', null, editFd({ remark: 'x' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
    expect(redirectMock).toHaveBeenCalledWith('/orders/o1');
  });

  it.each([undefined, '', 'not-a-version', '1.5', '-1'])(
    '缺失或非法的编辑版本令牌友好拒绝 %#',
    async (expectedEditVersion) => {
      permissionsMock.requirePermission.mockResolvedValue(salesActor);
      const formData = fd({ remark: 'x' });
      if (expectedEditVersion !== undefined) {
        formData.set('expectedEditVersion', expectedEditVersion);
      }

      const result = await updateOrderAction('o1', null, formData);

      expect(result).toEqual({
        status: 'error',
        message: '编辑页面已过期，请刷新后重试',
      });
      expect(orderMock.updateOrderFields).not.toHaveBeenCalled();
    },
  );
});

describe('setOrderUrgentAction', () => {
  it("first-line requirePermission('order:create')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setOrderUrgentAction('o1', null, fd({ isUrgent: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(orderMock.setOrderUrgent).not.toHaveBeenCalled();
  });

  it('forwards the boolean through to setOrderUrgent (true path)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderUrgent.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['isUrgent'],
    });
    const r = await setOrderUrgentAction('o1', null, fd({ isUrgent: 'true' }));
    expect(r.status).toBe('success');
    expect(orderMock.setOrderUrgent).toHaveBeenCalledWith(
      'o1',
      true,
      expect.anything(),
    );
  });

  it('forwards the boolean through to setOrderUrgent (false path)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderUrgent.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.DRAFT,
      changed: true,
      changedFields: ['isUrgent'],
    });
    await setOrderUrgentAction('o1', null, fd({ isUrgent: 'false' }));
    expect(orderMock.setOrderUrgent).toHaveBeenCalledWith(
      'o1',
      false,
      expect.anything(),
    );
  });

  it('maps OrderInvariantError → error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderUrgent.mockRejectedValueOnce(
      new MockOrderInvariantError('当前状态不可编辑'),
    );
    const r = await setOrderUrgentAction('o1', null, fd({ isUrgent: 'true' }));
    expect(r.status).toBe('error');
  });
});

describe('setOrderSfCollectAction', () => {
  it('returns unexpected persistence failures to the form without leaking database details', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderSfCollect.mockRejectedValueOnce(new Error('private database constraint detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await setOrderSfCollectAction('o1', null, fd({ isSfCollect: 'true' }));
      expect(result).toEqual({ status: 'error', message: '配送方式更新失败，请刷新后重试' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private database constraint detail');
      expect(revalidatePathMock).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  const fulfillmentGuardFormFields = {
    expectedOrderRevision: '4',
    expectedEditVersion: '2',
    expectedWorkOrderVersion: '3',
    expectedPriceRevision: '5',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };

  it("requires order:create before changing the flag", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setOrderSfCollectAction('o1', null, fd({ isSfCollect: 'true' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(orderMock.setOrderSfCollect).not.toHaveBeenCalled();
  });

  it('rejects a missing target value instead of silently clearing the flag', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);

    const result = await setOrderSfCollectAction('o1', null, fd({}));

    expect(result.status).toBe('invalid');
    expect(orderMock.setOrderSfCollect).not.toHaveBeenCalled();
  });

  it('keeps the legacy four-argument call when every fulfillment guard field is absent', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderSfCollect.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
      changed: true,
      changedFields: ['isSfCollect'],
    });

    const result = await setOrderSfCollectAction(
      'o1',
      null,
      fd({ isSfCollect: 'true' }),
    );

    expect(result.status).toBe('success');
    expect(orderMock.setOrderSfCollect).toHaveBeenCalledWith(
      'o1',
      true,
      expect.anything(),
      [],
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/o1');
  });

  it('parses and forwards the complete fulfillment pricing guard', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderSfCollect.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SUBMITTED,
      changed: true,
      changedFields: ['isSfCollect'],
    });

    const result = await setOrderSfCollectAction(
      'o1',
      null,
      fd({ isSfCollect: 'true', ...fulfillmentGuardFormFields }),
    );

    expect(result).toEqual({ status: 'success' });
    expect(orderMock.setOrderSfCollect).toHaveBeenCalledWith(
      'o1',
      true,
      expect.anything(),
      [],
      {
        expectedOrderRevision: 4,
        expectedEditVersion: 2,
        expectedWorkOrderVersion: 3,
        expectedPriceRevision: 5,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      },
    );
  });

  it.each([
    ['partial', { expectedOrderRevision: '4' }],
    [
      'invalid',
      {
        ...fulfillmentGuardFormFields,
        expectedPriceRevision: '5.5',
      },
    ],
  ])(
    'rejects a %s fulfillment guard instead of treating it as missing',
    async (_case, guardFields) => {
      permissionsMock.requirePermission.mockResolvedValue(salesActor);

      const result = await setOrderSfCollectAction(
        'o1',
        null,
        fd({ isSfCollect: 'true', ...guardFields }),
      );

      expect(result.status).toBe('invalid');
      expect(orderMock.setOrderSfCollect).not.toHaveBeenCalled();
    },
  );

  it('maps the business terminal-state error to the form', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderSfCollect.mockRejectedValueOnce(
      new MockOrderInvariantError('已完成或已取消的工单不能修改顺丰到付标识'),
    );
    const result = await setOrderSfCollectAction(
      'o1',
      null,
      fd({ isSfCollect: 'false' }),
    );
    expect(result).toEqual({
      status: 'error',
      message: '已完成或已取消的工单不能修改顺丰到付标识',
    });
  });

  it('按顺序构造已发货取消到付的逐票收费更正', async () => {
    permissionsMock.requirePermission.mockResolvedValue({
      ...salesActor,
      role: Role.ADMIN,
    });
    orderMock.setOrderSfCollect.mockResolvedValue({
      id: 'o1',
      status: OrderStatus.SHIPPED,
      changed: true,
      changedFields: ['isSfCollect'],
    });
    const formData = new FormData();
    formData.set('isSfCollect', 'false');
    for (const shipment of [
      {
        id: 'shipment-1',
        province: '浙江',
        weight: '12.5',
        fee: '',
        reason: '',
      },
      {
        id: 'shipment-2',
        province: '广东',
        weight: '8',
        fee: '18.50',
        reason: '承运商实际报价',
      },
    ]) {
      formData.append('sfShipmentId', shipment.id);
      formData.append('sfShipmentDestinationProvince', shipment.province);
      formData.append('sfShipmentWeightKg', shipment.weight);
      formData.append('sfShipmentShippingFee', shipment.fee);
      formData.append('sfShipmentChargeOverrideReason', shipment.reason);
    }

    const result = await setOrderSfCollectAction('o1', null, formData);

    expect(result).toEqual({ status: 'success' });
    expect(orderMock.setOrderSfCollect).toHaveBeenCalledWith(
      'o1',
      false,
      expect.objectContaining({ role: Role.ADMIN }),
      [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '浙江',
          weightKg: '12.5',
          shippingFee: null,
          customerChargeOverrideReason: null,
        },
        {
          shipmentId: 'shipment-2',
          destinationProvince: '广东',
          weightKg: '8',
          shippingFee: '18.50',
          customerChargeOverrideReason: '承运商实际报价',
        },
      ],
    );
  });

  it('在逐票重复字段数量错位时拒绝调用 domain', async () => {
    permissionsMock.requirePermission.mockResolvedValue({
      ...salesActor,
      role: Role.ADMIN,
    });
    const formData = new FormData();
    formData.set('isSfCollect', 'false');
    formData.append('sfShipmentId', 'shipment-1');
    formData.append('sfShipmentDestinationProvince', '浙江');
    formData.append('sfShipmentWeightKg', '1');
    formData.append('sfShipmentShippingFee', '8.00');

    const result = await setOrderSfCollectAction('o1', null, formData);

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { shipments: ['发货收费字段数量不一致'] },
    });
    expect(orderMock.setOrderSfCollect).not.toHaveBeenCalled();
  });

  it('将外部销售已发货工单的 domain 权限拒绝返回给销售表单', async () => {
    permissionsMock.requirePermission.mockResolvedValue(salesActor);
    orderMock.setOrderSfCollect.mockRejectedValueOnce(
      new MockOrderInvariantError(
        '已发货外部销售工单的顺丰到付只能由管理员更正',
      ),
    );

    const result = await setOrderSfCollectAction(
      'o1',
      null,
      fd({ isSfCollect: 'true' }),
    );

    expect(result).toEqual({
      status: 'error',
      message: '已发货外部销售工单的顺丰到付只能由管理员更正',
    });
    expect(orderMock.setOrderSfCollect).toHaveBeenCalledWith(
      'o1',
      true,
      expect.objectContaining({ role: Role.SALES }),
      [],
    );
  });
});

describe('previewOrderChangeRequestPricingAction', () => {
  it("checks order:change:review before parsing or reading quote data", async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    await expect(
      previewOrderChangeRequestPricingAction(null, { requestId: 'bad id' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:change:review',
    );
    expect(
      changeRequestMock.previewOrderChangeRequestPricing,
    ).not.toHaveBeenCalled();
  });

  it('returns the read-only authoritative preview without revalidating pages', async () => {
    const adminActor = { ...salesActor, role: Role.ADMIN };
    const preview = {
      requestId: 'request-1',
      orderId: 'order-1',
      baseRevision: 2,
      quotedAt: '2026-08-07T08:00:00.000Z',
      complete: true,
      requiresReviewRemark: false,
      oldTotal: '1000.00',
      newTotal: '960.00',
      delta: '-40.00',
      items: [],
    };
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    changeRequestMock.previewOrderChangeRequestPricing.mockResolvedValue(
      preview,
    );

    const result = await previewOrderChangeRequestPricingAction(null, {
      requestId: 'request-1',
    });

    expect(result).toEqual({ status: 'success', preview });
    expect(
      changeRequestMock.previewOrderChangeRequestPricing,
    ).toHaveBeenCalledWith('request-1', adminActor, {
      expectedPriceRevision: undefined,
      pendingChargeResolutions: [],
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('parses and forwards the price revision and manual shipment charge resolutions', async () => {
    const adminActor = { ...salesActor, role: Role.ADMIN };
    const preview = {
      requestId: 'request-1',
      orderId: 'order-1',
      baseRevision: 2,
      quotedAt: '2026-08-07T08:00:00.000Z',
      complete: true,
      requiresReviewRemark: false,
      oldTotal: '1000.00',
      newTotal: '980.00',
      delta: '-20.00',
      items: [],
    };
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    changeRequestMock.previewOrderChangeRequestPricing.mockResolvedValue(
      preview,
    );

    const result = await previewOrderChangeRequestPricingAction(null, {
      requestId: 'request-1',
      expectedPriceRevision: '7',
      pendingChargeResolutions: [
        {
          businessKey: ' shipment:shipment-1:shipping ',
          shipmentId: ' shipment-1 ',
          expectedSequence: '2',
          expectedProjectedQuantity: '1200',
          expectedDestinationProvince: ' 广东 ',
          amount: ' 18.50 ',
          reason: ' 承运商实际报价 ',
        },
      ],
    });

    expect(result).toEqual({ status: 'success', preview });
    expect(
      changeRequestMock.previewOrderChangeRequestPricing,
    ).toHaveBeenCalledWith('request-1', adminActor, {
      expectedPriceRevision: 7,
      pendingChargeResolutions: [
        {
          businessKey: 'SHIPMENT:SHIPMENT-1:SHIPPING',
          shipmentId: 'shipment-1',
          expectedSequence: 2,
          expectedProjectedQuantity: 1200,
          expectedDestinationProvince: '广东',
          amount: '18.50',
          reason: '承运商实际报价',
        },
      ],
    });
  });

  it('maps preview business failures without returning stale amounts', async () => {
    permissionsMock.requirePermission.mockResolvedValue({
      ...salesActor,
      role: Role.ADMIN,
    });
    changeRequestMock.previewOrderChangeRequestPricing.mockRejectedValue(
      new MockOrderChangeRequestError('工单版本已过期'),
    );

    await expect(
      previewOrderChangeRequestPricingAction(null, {
        requestId: 'request-1',
      }),
    ).resolves.toEqual({ status: 'error', message: '工单版本已过期' });
  });
});

describe('reviewOrderChangeRequestAction', () => {
  it('parses and forwards optimistic price and shipment charge evidence', async () => {
    const adminActor = { ...salesActor, role: Role.ADMIN };
    const expectedQuoteToken = `order-change-approval-v1:${'a'.repeat(64)}`;
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    changeRequestMock.reviewOrderChangeRequest.mockResolvedValue({
      orderId: 'order-1',
      status: 'APPROVED',
    });

    const result = await reviewOrderChangeRequestAction(null, {
      requestId: 'request-1',
      expectedPriceRevision: '7',
      expectedQuoteToken: ` ${expectedQuoteToken} `,
      pendingChargeResolutions: [
        {
          businessKey: ' shipment:shipment-1:shipping ',
          shipmentId: ' shipment-1 ',
          expectedSequence: '2',
          expectedProjectedQuantity: '1200',
          expectedDestinationProvince: ' 广东 ',
          amount: ' 18.50 ',
          reason: ' 承运商实际报价 ',
        },
      ],
      decision: 'APPROVE',
      reviewRemark: ' 已复核物流报价 ',
    });

    expect(changeRequestMock.reviewOrderChangeRequest).toHaveBeenCalledWith(
      {
        requestId: 'request-1',
        expectedPriceRevision: 7,
        expectedQuoteToken,
        pendingChargeResolutions: [
          {
            businessKey: 'SHIPMENT:SHIPMENT-1:SHIPPING',
            shipmentId: 'shipment-1',
            expectedSequence: 2,
            expectedProjectedQuantity: 1200,
            expectedDestinationProvince: '广东',
            amount: '18.50',
            reason: '承运商实际报价',
          },
        ],
        decision: 'APPROVE',
        reviewRemark: '已复核物流报价',
      },
      adminActor,
    );
    expect(result).toEqual({
      status: 'success',
      requestStatus: 'APPROVED',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/order-changes');
  });

  it('rejects an invalid manual charge resolution before entering the domain', async () => {
    permissionsMock.requirePermission.mockResolvedValue({
      ...salesActor,
      role: Role.ADMIN,
    });

    const result = await reviewOrderChangeRequestAction(null, {
      requestId: 'request-1',
      expectedPriceRevision: '7',
      pendingChargeResolutions: [
        {
          businessKey: 'shipment:shipment-1:shipping',
          shipmentId: 'shipment-1',
          expectedSequence: '2',
          expectedProjectedQuantity: '1200',
          expectedDestinationProvince: '广东',
          amount: '18.505',
          reason: '承运商实际报价',
        },
      ],
      decision: 'APPROVE',
      reviewRemark: null,
    });

    expect(result.status).toBe('invalid');
    expect(changeRequestMock.reviewOrderChangeRequest).not.toHaveBeenCalled();
  });
});

describe('order pricing review actions', () => {
  const adminActor = { ...salesActor, role: Role.ADMIN };

  it('checks order:price:confirm before parsing a preview request', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    await expect(
      previewOrderPricingReviewAction(null, { orderId: 'bad id' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:price:confirm',
    );
    expect(pricingReviewMock.previewOrderPricingReview).not.toHaveBeenCalled();
  });

  it('checks order:price:confirm before parsing a finalize request', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    await expect(
      finalizeOrderPricingAction(null, { orderId: 'bad id' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:price:confirm',
    );
    expect(pricingReviewMock.finalizeOrderPricing).not.toHaveBeenCalled();
  });

  it('rejects invalid finalize input without entering the pricing domain', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);

    const result = await finalizeOrderPricingAction(null, {
      orderId: 'order-1',
      expectedOrderRevision: 0,
      expectedPriceRevision: 0,
      items: [],
      packagingGroups: [],
      shipments: [],
    });

    expect(result.status).toBe('invalid');
    expect(pricingReviewMock.finalizeOrderPricing).not.toHaveBeenCalled();
  });

  it('maps pricing domain errors without revalidating stale pages', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    pricingReviewMock.finalizeOrderPricing.mockRejectedValue(
      new MockOrderPricingReviewError('工单价格已被其他人更新'),
    );

    await expect(
      finalizeOrderPricingAction(null, {
        orderId: 'order-1',
        expectedOrderRevision: 2,
        expectedPriceRevision: 1,
        items: [],
        packagingGroups: [
          {
            packagingGroupId: 'packaging-group-1',
            expectedMode: OrderPackagingMode.MIXED_STYLE,
            expectedActualBagCount: 200,
            unitPrice: '0.20',
            reason: '混装入袋人工终价',
          },
        ],
        shipments: [
          {
            shipmentId: 'shipment-1',
            expectedDestinationProvince: '广东',
            expectedBillableWeightKg: '2',
            shippingFee: '4.30',
            packingMaterialFee: '2.00',
            reason: null,
          },
        ],
        remark: null,
      }),
    ).resolves.toEqual({
      status: 'error',
      message: '工单价格已被其他人更新',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('returns an actionable pricing error for incomplete production facts without exposing internal details', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    pricingReviewMock.finalizeOrderPricing.mockRejectedValueOnce(
      new MockProductionOperationMaterializationError(
        'CANONICAL_FACTS_INCOMPLETE',
        '工单生产事实不完整，不能自动生成工序',
        [{ code: 'NO_ITEMS', path: 'items', internalOrderId: 'private-order-id' }],
      ),
    );

    const result = await finalizeOrderPricingAction(null, {
      orderId: 'order-1',
      expectedOrderRevision: 1,
      expectedPriceRevision: 1,
      items: [],
      packagingGroups: [],
      shipments: [],
      remark: null,
    });

    expect(result).toEqual({
      status: 'error',
      message: '工单款式或生产信息不完整，无法完成核价。请先核对款式、数量及包装信息。',
    });
    expect(JSON.stringify(result)).not.toContain('NO_ITEMS');
    expect(JSON.stringify(result)).not.toContain('private-order-id');
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('returns other expected production activation failures as local errors without revalidation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    pricingReviewMock.finalizeOrderPricing.mockRejectedValueOnce(
      new MockProductionOperationMaterializationError(
        'PRICING_NOT_CONFIRMED',
        '工单价格尚未确认，不能投产',
        { internalVersion: 'private-version' },
      ),
    );

    await expect(finalizeOrderPricingAction(null, {
      orderId: 'order-1',
      expectedOrderRevision: 1,
      expectedPriceRevision: 1,
      items: [],
      packagingGroups: [],
      shipments: [],
      remark: null,
    })).resolves.toEqual({
      status: 'error',
      message: '工单价格尚未确认，不能投产',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('does not conceal unexpected pricing failures as recoverable business errors', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    const failure = new Error('unexpected database failure');
    pricingReviewMock.finalizeOrderPricing.mockRejectedValueOnce(failure);

    await expect(finalizeOrderPricingAction(null, {
      orderId: 'order-1',
      expectedOrderRevision: 1,
      expectedPriceRevision: 1,
      items: [],
      packagingGroups: [],
      shipments: [],
      remark: null,
    })).rejects.toBe(failure);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('passes structured packaging-group facts and returns the packaging total', async () => {
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    pricingReviewMock.finalizeOrderPricing.mockResolvedValue({
      orderId: 'order-1',
      priceRevision: 4,
      packagingAmount: '40.00',
      processingAmount: '590.00',
      totalAmount: '645.00',
      confirmedFee: '645.00',
    });

    const result = await finalizeOrderPricingAction(null, {
      orderId: 'order-1',
      expectedOrderRevision: 2,
      expectedPriceRevision: 3,
      items: [],
      packagingGroups: [
        {
          packagingGroupId: 'packaging-group-1',
          expectedMode: OrderPackagingMode.MIXED_STYLE,
          expectedActualBagCount: '200',
          unitPrice: '0.20',
          reason: '混装入袋人工终价',
        },
      ],
      shipments: [
        {
          shipmentId: 'shipment-1',
          expectedDestinationProvince: '广东',
          expectedBillableWeightKg: '2',
          shippingFee: '4.30',
          packingMaterialFee: '10.70',
          reason: null,
        },
      ],
      remark: '确认包装组终价',
    });

    expect(pricingReviewMock.finalizeOrderPricing).toHaveBeenCalledWith(
      expect.objectContaining({
        packagingGroups: [
          {
            packagingGroupId: 'packaging-group-1',
            expectedMode: OrderPackagingMode.MIXED_STYLE,
            expectedActualBagCount: 200,
            unitPrice: '0.20',
            reason: '混装入袋人工终价',
          },
        ],
      }),
      adminActor,
    );
    expect(result).toEqual({
      status: 'success',
      orderId: 'order-1',
      priceRevision: 4,
      packagingAmount: '40.00',
      processingAmount: '590.00',
      totalAmount: '645.00',
      confirmedFee: '645.00',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });
});

describe('structured order commercial detail actions', () => {
  it('authorizes, validates, mutates, and revalidates an approved adjustment', async () => {
    const adminActor = { ...salesActor, role: Role.ADMIN };
    permissionsMock.requirePermission.mockResolvedValue(adminActor);
    commercialDetailsMock.saveOrderManualCharge.mockResolvedValue({
      chargeId: 'charge-1',
      priceRevision: 5,
      totalAmount: '980.00',
    });

    const result = await saveOrderManualChargeAction(null, {
      orderId: 'order-1',
      chargeId: null,
      expectedPriceRevision: 4,
      categoryCode: 'APPROVED_ADJUSTMENT',
      description: '售后折让',
      amount: '-20.00',
      reason: '交期延误',
      approvalReference: '审批单 AP-1',
    });

    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:price:confirm',
    );
    expect(commercialDetailsMock.saveOrderManualCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryCode: 'APPROVED_ADJUSTMENT',
        amount: '-20.00',
        approvalReference: '审批单 AP-1',
      }),
      adminActor,
    );
    expect(result).toEqual({
      status: 'success',
      entityId: 'charge-1',
      priceRevision: 5,
      totalAmount: '980.00',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/bills');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1/edit');
  });

  it.each([
    {
      label: 'removes a manual charge',
      action: deleteOrderManualChargeAction,
      mutate: commercialDetailsMock.deleteOrderManualCharge,
      raw: { chargeId: 'charge-1', reason: '移除重复收费' },
      saved: { chargeId: 'charge-1' },
    },
    {
      label: 'saves a plate detail',
      action: saveOrderPlateDetailAction,
      mutate: commercialDetailsMock.saveOrderPlateDetail,
      raw: { orderItemId: 'item-1', name: '正面版', quantity: 1, unitPrice: '25.00' },
      saved: { plateDetailId: 'plate-1' },
    },
    {
      label: 'removes a plate detail',
      action: deleteOrderPlateDetailAction,
      mutate: commercialDetailsMock.deleteOrderPlateDetail,
      raw: { orderItemId: 'item-1', plateDetailId: 'plate-1', reason: '无需额外制版' },
      saved: { plateDetailId: 'plate-1' },
    },
  ])('$label and refreshes the embedded editor’s amounts and version', async ({ action, mutate, raw, saved }) => {
    const actor = { ...salesActor, role: Role.ADMIN };
    permissionsMock.requirePermission.mockResolvedValue(actor);
    mutate.mockResolvedValue({ ...saved, priceRevision: 5, totalAmount: '980.00' });

    const result = await action(null, { orderId: 'order-1', expectedPriceRevision: 4, ...raw });

    expect(result).toMatchObject({ status: 'success', priceRevision: 5 });
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('order:price:confirm');
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining(raw), actor);
    expect(revalidatePathMock.mock.calls).toEqual([
      ['/orders'], ['/orders/order-1'], ['/orders/order-1/edit'], ['/owner/bills'],
    ]);
  });
});
