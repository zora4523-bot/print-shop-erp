import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
  TaskStatus,
} from '../../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orderItem: {
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    orderShipmentLine: {
      upsert: vi.fn(),
      create: vi.fn(),
    },
    orderCustomerCharge: {
      aggregate: vi.fn(),
      update: vi.fn(),
    },
    productionTask: {
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    outsourceOrder: { update: vi.fn() },
    orderChangeRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    craft: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    priceTier: { findMany: vi.fn() },
    priceAdjustment: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
    csSalesEntry: {
      aggregate: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    salaryPeriod: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(
    async (callback: (tx: typeof mock) => unknown) => callback(mock),
  );
  return { dbMock: mock };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createOrderChangeRequest,
  OrderChangeRequestError,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
} from '../change-request';

const salesActor = { id: 'sales-1', role: Role.SALES };
const adminActor = { id: 'admin-1', role: Role.ADMIN };

const activeExternalPriceBook = {
  id: 'external-book-test',
  code: 'EXTERNAL_TEST',
  name: '外部销售测试价目簿',
  version: 1,
  sourceName: '测试报价表.xlsx',
  sourceSha256: 'b'.repeat(64),
};

function frozenLogisticsPriceBook() {
  const sourceSha256 = 'c'.repeat(64);
  const source = {
    sourceSheet: '中通',
    sourceRange: 'A3:D3',
    sourceName: '物流价目簿.xlsx',
    sourceSha256,
  };
  const packagingRule = (
    code: string,
    minQty: number,
    maxQty: number,
    amount: string,
  ) => ({
    id: `packing-${code}`,
    code,
    amount,
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty,
    maxQty,
    triggerCondition: null,
    ...source,
    sourceSheet: 'Sheet1',
    sourceRange: `A${minQty}:B${maxQty}`,
    blocksAutomaticQuote: true,
    category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
  });
  return {
    id: 'logistics-book-1',
    code: 'EXTERNAL_LOGISTICS_V1',
    name: '外部销售物流价目簿',
    version: 1,
    sourceName: '物流价目簿.xlsx',
    sourceSha256,
    rules: [
      {
        id: 'shipping-guangdong',
        code: 'ZTO_GUANGDONG',
        amount: '2.80',
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: '1.50',
        minQty: null,
        maxQty: null,
        triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
        ...source,
        blocksAutomaticQuote: false,
        category: { id: 'shipping-category', code: 'SHIPPING_FEE' },
      },
      packagingRule('CARTON_Q1_500', 1, 500, '1.00'),
      packagingRule('CARTON_Q501_1000', 501, 1_000, '3.00'),
      packagingRule('CARTON_Q1001_2000', 1_001, 2_000, '5.00'),
      packagingRule('CARTON_Q2001_3000', 2_001, 3_000, '7.00'),
      packagingRule('CARTON_Q3001_5000', 3_001, 5_000, '8.00'),
    ],
  };
}

function externalBaseRule({
  id = 'external-base-product-1',
  amount = '1.0000',
  productId = 'product-1',
  minQty = null,
  maxQty = null,
}: {
  id?: string;
  amount?: string;
  productId?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
} = {}) {
  return {
    id,
    code: id,
    name: `基础价 ${id}`,
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount,
    minQty,
    maxQty,
    triggerCondition: null,
    exclusiveGroup: null,
    priority: 100,
    blocksAutomaticQuote: false,
    sourceSheet: '测试基础价',
    sourceRange: 'A1',
    note: null,
    productId,
    category: { code: 'BASE', name: '基础加工费' },
  };
}

function externalAddOnRule({
  id,
  name,
  amount,
  triggerCondition,
}: {
  id: string;
  name: string;
  amount: string;
  triggerCondition: Record<string, unknown>;
}) {
  return {
    ...externalBaseRule({ id, amount, productId: null }),
    name,
    kind: 'ADD_ON',
    calculationType: 'PER_PIECE',
    triggerCondition,
    priority: 50,
    category: { code: 'ADD_ON', name: '附加加工费' },
  };
}

const updateInput = {
  orderId: 'order-1',
  reason: '客户要求把哑金改成浅金',
  items: [
    {
      operation: 'UPDATE' as const,
      itemId: 'item-1',
      name: '红包 A',
      quantity: 1200,
      specification: '大号',
      foilColors: ['浅金'],
    },
  ],
};

function baseReviewRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    orderId: 'order-1',
    requesterId: 'sales-1',
    baseRevision: 2,
    status: OrderChangeRequestStatus.PENDING,
    reason: '客户变更',
    proposedChanges: {
      items: [
        {
          operation: 'UPDATE',
          itemId: 'item-1',
          name: '红包 A（新版）',
          specification: '大号',
          foilColors: ['浅金', '红金'],
        },
      ],
    },
    requester: {
      id: 'sales-1',
      displayName: '销售小王',
      role: Role.SALES,
    },
    order: {
      id: 'order-1',
      submitterId: 'sales-1',
      submitterRole: Role.SALES,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      billingMode: OrderBillingMode.CHARGE,
      revision: 2,
      status: OrderStatus.IN_PRODUCTION,
      isSfCollect: false,
      processingAmount: '1000.00',
      totalAmount: '1000.00',
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '红包 A',
          quantity: 1000,
          unitPrice: '1.00',
          fixedFee: '0',
          subtotal: '1000.00',
          productId: 'product-1',
          specification: '中号',
          paperType: '艳红珠光纸',
          crafts: ['craft-1'],
          foilColors: ['哑金'],
          isDoubleSided: false,
          isDoubleColor: false,
          suggestedSubtotal: null,
          pricingSnapshot: { version: 1, marker: 'original' },
          priceOverrideReason: null,
          remark: null,
          tasks: [
            {
              craftId: 'craft-1',
              workerId: 'worker-1',
              workerType: 'MACHINE',
              machineType: 'WINDMILL',
              status: TaskStatus.PENDING,
            },
          ],
          shipmentLines: [
            {
              quantity: 1000,
              shipment: { id: 'shipment-1', sequence: 1 },
            },
          ],
        },
      ],
      outsourceOrders: [],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          destinationProvince: '广东',
          quotedWeightKg: '2',
          weightKg: null,
        },
      ],
      customerCharges: [
        {
          id: 'charge-shipping-1',
          shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:SHIPPING_FEE',
          priceBookId: 'logistics-book-1',
          amount: '4.30',
          overrideReason: null,
          category: { code: 'SHIPPING_FEE' },
        },
        {
          id: 'charge-packing-1',
          shipmentId: 'shipment-1',
          businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
          priceBookId: 'logistics-book-1',
          amount: '5.00',
          overrideReason: '创建工单时已确认耗材费',
          category: { code: 'PACKING_MATERIAL' },
        },
      ],
    },
    ...overrides,
  };
}

function reviewOrderItems(count: number) {
  const template = baseReviewRequest().order.items[0];
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `item-${index + 1}`,
    sequence: index + 1,
    name: `红包 ${index + 1}`,
  }));
}

beforeEach(() => {
  for (const value of Object.values(dbMock)) {
    if (typeof value === 'object' && value !== null) {
      for (const method of Object.values(value)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof vi.fn>).mockReset();
        }
      }
    }
  }
  dbMock.$executeRaw.mockReset().mockResolvedValue(undefined);
  dbMock.csSalesEntry.aggregate.mockResolvedValue({
    _sum: { amount: '1000.00' },
  });
  dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
    _sum: { amount: null },
  });
  dbMock.product.findMany.mockResolvedValue([
    {
      id: 'product-1',
      code: 'PRODUCT_1',
      isActive: true,
      baseUnitPrice: '1.0000',
    },
  ]);
  dbMock.craft.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({
        id,
        code: `CRAFT_${id}`,
        isActive: true,
      })),
  );
  dbMock.priceTier.findMany.mockResolvedValue([]);
  dbMock.priceAdjustment.findMany.mockResolvedValue([]);
  dbMock.customerPriceBook.findMany.mockImplementation(
    async ({ where }: { where: { purpose?: string } }) =>
      where.purpose === 'LOGISTICS'
        ? [frozenLogisticsPriceBook()]
        : [activeExternalPriceBook],
  );
  dbMock.customerPriceRule.findMany.mockResolvedValue([
    externalBaseRule(),
  ]);
  dbMock.$transaction.mockReset().mockImplementation(
    async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock),
  );
});

describe('createOrderChangeRequest', () => {
  it('snapshots the current revision without mutating the live order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.IN_PRODUCTION,
      revision: 2,
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '红包 A',
          quantity: 1000,
          specification: '中号',
          foilColors: ['哑金'],
        },
      ],
      changeRequests: [],
    });
    dbMock.orderChangeRequest.create.mockResolvedValue({ id: 'request-1' });

    await expect(
      createOrderChangeRequest(updateInput, salesActor),
    ).resolves.toEqual({ id: 'request-1' });

    expect(dbMock.orderChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          requesterId: 'sales-1',
          baseRevision: 2,
          proposedChanges: { items: updateInput.items },
        }),
      }),
    );
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects changes to another salesperson’s order', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-2',
      status: OrderStatus.SUBMITTED,
      revision: 1,
      items: [{ id: 'item-1' }],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(updateInput, salesActor),
    ).rejects.toThrow(/只能修改自己提交/);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate UPDATE entries for the same item before persisting', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 1,
      items: [{ id: 'item-1' }],
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          ...updateInput,
          items: [
            updateInput.items[0],
            { ...updateInput.items[0], quantity: 1300 },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/同一款式不能重复/);
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects an addition that would exceed 50 live items while holding the order lock', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: '20260731-0001',
      submitterId: 'sales-1',
      status: OrderStatus.SUBMITTED,
      revision: 2,
      items: reviewOrderItems(50),
      changeRequests: [],
    });

    await expect(
      createOrderChangeRequest(
        {
          orderId: 'order-1',
          reason: '新增一个款式',
          items: [
            {
              operation: 'ADD',
              templateItemId: 'item-1',
              name: '红包 51',
              quantity: 1_000,
              specification: '大号',
              foilColors: ['哑金'],
            },
          ],
        },
        salesActor,
      ),
    ).rejects.toThrow(/单工单款式不超过 50 项.*当前 50 项.*新增 1 项/);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      dbMock.order.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(dbMock.orderChangeRequest.create).not.toHaveBeenCalled();
  });
});

describe('previewOrderChangeRequestPricing', () => {
  it('shows authoritative old/new totals, delta and each quoted style without writing', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );

    expect(preview).toMatchObject({
      requestId: 'request-1',
      orderId: 'order-1',
      baseRevision: 2,
      complete: true,
      requiresReviewRemark: false,
      oldTotal: '1000.00',
      newTotal: '960.00',
      delta: '-40.00',
      items: [
        expect.objectContaining({
          operation: 'UPDATE',
          name: '红包 A',
          quantity: 1200,
          priceImpact: 'QUOTED',
          oldSubtotal: '1000.00',
          newSubtotal: '960.00',
          suggestedUnitPrice: '0.8000',
          suggestedFixedFee: '0.00',
          errors: [],
        }),
      ],
    });
    expect(preview.quotedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderChangeRequest.update).not.toHaveBeenCalled();
  });

  it('withholds the new total and explains every incomplete quote instead of implying a carried price', async () => {
    const request = baseReviewRequest({
      order: {
        ...baseReviewRequest().order,
        items: [
          {
            ...baseReviewRequest().order.items[0],
            productId: null,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );

    expect(preview).toMatchObject({
      complete: false,
      requiresReviewRemark: true,
      oldTotal: '1000.00',
      newTotal: null,
      delta: null,
      items: [
        expect.objectContaining({
          priceImpact: 'INCOMPLETE',
          oldSubtotal: '1000.00',
          newSubtotal: null,
          suggestedUnitPrice: null,
          errors: expect.arrayContaining([
            expect.stringMatching(/报价单未覆盖当前产品/),
          ]),
        }),
      ],
    });
  });

  it('does not trust a preview price when approval observes a newer rule', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'preview-tier',
          amount: '0.8000',
          minQty: 1200,
        }),
      ])
      .mockResolvedValueOnce([
        externalBaseRule({
          id: 'approval-tier',
          amount: '0.7000',
          minQty: 1200,
        }),
      ]);

    const preview = await previewOrderChangeRequestPricing(
      'request-1',
      adminActor,
    );
    expect(preview.newTotal).toBe('960.00');

    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '840.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        unitPrice: '0.7000',
        subtotal: '840.00',
        pricingSnapshot: expect.objectContaining({
          base: expect.objectContaining({ sourceId: 'approval-tier' }),
        }),
      }),
    });
  });
});

describe('reviewOrderChangeRequest', () => {
  it('marks a request stale when the live order revision has changed', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(
        baseReviewRequest({
          order: {
            ...baseReviewRequest().order,
            revision: 3,
          },
        }),
      );
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.STALE,
    });

    const result = await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(result.status).toBe(OrderChangeRequestStatus.STALE);
    expect(dbMock.orderChangeRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: OrderChangeRequestStatus.STALE,
        reviewedById: 'admin-1',
      }),
    });
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('rejects a legacy pending addition when the live order already has 50 items', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 51',
            quantity: 1_000,
            specification: '大号',
            foilColors: ['哑金'],
          },
        ],
      },
      order: {
        ...base.order,
        items: reviewOrderItems(50),
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/单工单款式不超过 50 项.*当前 50 项.*新增 1 项/);

    expect(dbMock.product.findMany).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.create).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('blocks quantity changes after that style has started production', async () => {
    const request = baseReviewRequest();
    request.proposedChanges = { items: updateInput.items };
    (
      request.order.items[0].tasks[0] as { status: TaskStatus }
    ).status = TaskStatus.IN_PROGRESS;
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(OrderChangeRequestError);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it('re-quotes an approved specification/foil change and increments the revision', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    const result = await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '已与车间确认',
      },
      adminActor,
    );

    expect(result.status).toBe(OrderChangeRequestStatus.APPROVED);
    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        name: '红包 A（新版）',
        quantity: undefined,
        specification: '大号',
        foilColors: ['浅金', '红金'],
        subtotal: '1000.00',
        unitPrice: '1.0000',
        fixedFee: '0.00',
        suggestedSubtotal: '1000.00',
        pricingSnapshot: expect.objectContaining({
          source: 'CHANGE_REQUEST_REQUOTE',
          requestId: 'request-1',
          actual: expect.objectContaining({
            quantity: 1000,
            unitPrice: '1.0000',
            fixedFee: '0.00',
            subtotal: '1000.00',
            overrideReason: null,
          }),
        }),
        priceOverrideReason: null,
      }),
    });
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        processingAmount: '1000.00',
        totalAmount: '1000.00',
      },
    });
    expect(dbMock.orderLog.create).toHaveBeenCalledTimes(1);
  });

  it('re-quotes a quantity change across a price tier using one transaction timestamp', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    const bookQuery = dbMock.customerPriceBook.findMany.mock.calls[0]?.[0];
    expect(bookQuery.where.effectiveFrom.lte).toBeInstanceOf(Date);
    expect(bookQuery.where.OR[1].effectiveTo.gt).toBe(
      bookQuery.where.effectiveFrom.lte,
    );
    expect(
      dbMock.customerPriceBook.findMany.mock.calls[1]?.[0].where,
    ).toMatchObject({
      id: 'logistics-book-1',
      purpose: 'LOGISTICS',
    });
    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        quantity: 1200,
        unitPrice: '0.8000',
        fixedFee: '0.00',
        subtotal: '960.00',
        suggestedSubtotal: '960.00',
        priceOverrideReason: null,
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_REQUOTE',
          base: expect.objectContaining({ sourceId: 'tier-1200' }),
        }),
      }),
    });
  });

  it('requires an audit remark before retaining a confirmed logistics amount that differs after re-tiering', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
      order: {
        ...base.order,
        customerCharges: base.order.customerCharges.map((charge) =>
          charge.category.code === 'PACKING_MATERIAL'
            ? { ...charge, amount: '3.00', overrideReason: null }
            : charge,
        ),
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/3\.00 元.*5\.00 元.*请填写审核备注/);

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.orderChangeRequest.update).not.toHaveBeenCalled();
  });

  it('refreshes every frozen logistics snapshot while preserving actual and unrelated charges', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            quantity: 1200,
          },
        ],
      },
      order: {
        ...base.order,
        totalAmount: '1107.30',
        customerCharges: [
          ...base.order.customerCharges.map((charge) =>
            charge.category.code === 'PACKING_MATERIAL'
              ? { ...charge, amount: '3.00', overrideReason: null }
              : charge,
          ),
          {
            id: 'charge-other-1',
            shipmentId: null,
            businessKey: 'ORDER:OTHER:1',
            priceBookId: null,
            amount: '100.00',
            overrideReason: '管理员确认其他收费',
            category: { code: 'OTHER' },
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '960.00' }]);
    dbMock.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: '107.30' },
    });
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '耗材数量跨档，保留已与客户确认的收费',
      },
      adminActor,
    );

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledTimes(2);
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-shipping-1' },
      data: expect.objectContaining({
        sourceRuleId: 'shipping-guangdong',
        quantity: '2',
        unit: 'kg',
        suggestedAmount: '4.30',
        overrideReason: null,
        pricingSnapshot: expect.objectContaining({
          priceBook: expect.objectContaining({ id: 'logistics-book-1' }),
          actual: expect.objectContaining({
            amount: '4.30',
            overrideReason: null,
          }),
          changeRequestRefresh: expect.objectContaining({
            requestId: 'request-1',
          }),
        }),
      }),
    });
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'charge-packing-1' },
      data: expect.objectContaining({
        sourceRuleId: 'packing-CARTON_Q1001_2000',
        quantity: '1200',
        unit: '个',
        suggestedAmount: '5.00',
        overrideReason: '耗材数量跨档，保留已与客户确认的收费',
        pricingSnapshot: expect.objectContaining({
          priceBook: expect.objectContaining({ id: 'logistics-book-1' }),
          actual: expect.objectContaining({
            amount: '3.00',
            overrideReason:
              '耗材数量跨档，保留已与客户确认的收费',
          }),
          changeRequestRefresh: expect.objectContaining({
            requestId: 'request-1',
          }),
        }),
      }),
    });
    for (const call of dbMock.orderCustomerCharge.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('amount');
      expect(call[0].data).not.toHaveProperty('status');
    }
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'charge-other-1' } }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        revision: 3,
        processingAmount: '960.00',
        totalAmount: '1067.30',
      },
    });
  });

  it('re-quotes a foil-color change with the per-color multiplier', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule(),
      externalAddOnRule({
        id: 'foil-per-color',
        name: '每色烫金费',
        amount: '0.1000',
        triggerCondition: { perFoilColor: true },
      }),
    ]);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        foilColors: ['浅金', '红金'],
        unitPrice: '1.2000',
        subtotal: '1200.00',
        pricingSnapshot: expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              sourceId: 'foil-per-color',
              units: '2000',
              amount: '200.00',
            }),
          ]),
        }),
      }),
    });
  });

  it('quotes and approves the 50th style from its complete merged business facts', async () => {
    const base = baseReviewRequest();
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 1200,
            specification: '大号',
            foilColors: ['浅金'],
          },
        ],
      },
      order: {
        ...base.order,
        items: reviewOrderItems(49),
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({
        id: 'tier-1200',
        amount: '0.8000',
        minQty: 1200,
      }),
    ]);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '960.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        sequence: 50,
        name: '红包 B',
        productId: 'product-1',
        specification: '大号',
        paperType: '艳红珠光纸',
        quantity: 1200,
        crafts: ['craft-1'],
        foilColors: ['浅金'],
        unitPrice: '0.8000',
        fixedFee: '0.00',
        subtotal: '960.00',
        suggestedSubtotal: '960.00',
        priceOverrideReason: null,
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_REQUOTE',
          input: expect.objectContaining({ orderItemCount: 50 }),
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.orderShipmentLine.create).toHaveBeenCalledWith({
      data: {
        shipmentId: 'shipment-1',
        orderItemId: 'item-2',
        quantity: 1200,
      },
    });
  });

  it('quotes all affected updates and additions in one batched rule read', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            specification: '大号',
          },
          {
            operation: 'ADD',
            templateItemId: 'item-1',
            name: '红包 B',
            quantity: 500,
            specification: '中号',
            foilColors: ['哑金'],
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.create.mockResolvedValue({ id: 'item-2' });
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '1000.00' },
      { subtotal: '500.00' },
    ]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.product.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.craft.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderItem.create).toHaveBeenCalledTimes(1);
  });

  it('does not re-quote a name-only change or replace its immutable price snapshot', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            operation: 'UPDATE',
            itemId: 'item-1',
            name: '只改名称',
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.product.findMany).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceBook.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    const updateData = dbMock.orderItem.update.mock.calls[0]?.[0].data;
    expect(updateData).toMatchObject({ name: '只改名称' });
    expect(updateData).not.toHaveProperty('unitPrice');
    expect(updateData).not.toHaveProperty('fixedFee');
    expect(updateData).not.toHaveProperty('subtotal');
    expect(updateData).not.toHaveProperty('suggestedSubtotal');
    expect(updateData).not.toHaveProperty('suggestedPrice');
    expect(updateData).not.toHaveProperty('pricingSnapshot');
    expect(updateData).not.toHaveProperty('priceOverrideReason');
  });

  it('blocks an incomplete re-quote until the reviewer explicitly explains carrying the old price', async () => {
    const request = baseReviewRequest({
      order: {
        ...baseReviewRequest().order,
        items: [
          {
            ...baseReviewRequest().order.items[0],
            productId: null,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/无法按当前规则报价.*请填写审核备注/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('carries the old price on an incomplete quote only with the explicit review remark', async () => {
    const request = baseReviewRequest({
      order: {
        ...baseReviewRequest().order,
        items: [
          {
            ...baseReviewRequest().order.items[0],
            productId: null,
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1000.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      {
        requestId: 'request-1',
        decision: 'APPROVE',
        reviewRemark: '客户已确认沿用原成交价',
      },
      adminActor,
    );

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        unitPrice: '1.00',
        fixedFee: '0',
        subtotal: '1000.00',
        suggestedSubtotal: null,
        priceOverrideReason: '客户已确认沿用原成交价',
        pricingSnapshot: expect.objectContaining({
          requestId: 'request-1',
          source: 'CHANGE_REQUEST_PRICE_CARRY_FORWARD',
          complete: false,
          previousSnapshot: { version: 1, marker: 'original' },
          actual: expect.objectContaining({
            overrideReason: '客户已确认沿用原成交价',
          }),
        }),
      }),
    });
  });

  it('attributes an approved amount change to the order submitter snapshot even if the requester role changed', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'cs-original',
        displayName: '原客服',
        role: Role.SALES,
      },
      order: {
        ...baseReviewRequest().order,
        submitterId: 'cs-original',
        submitterRole: Role.CUSTOMER_SERVICE,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    dbMock.csSalesEntry.findUnique.mockResolvedValue(null);
    dbMock.salaryPeriod.findFirst.mockResolvedValue({
      id: 'period-1',
      totalSales: '1000.00',
      initialSales: '0.00',
    });
    dbMock.csSalesEntry.create.mockResolvedValue({ id: 'sales-entry-1' });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        csUserId: 'cs-original',
        amount: '200.00',
        type: 'ORDER_CHANGED',
      }),
      select: { id: true },
    });
  });

  it('blocks a legacy CS order change when order-level sales history cannot be reconciled', async () => {
    const request = baseReviewRequest({
      order: {
        ...baseReviewRequest().order,
        submitterId: 'cs-original',
        submitterRole: Role.CUSTOMER_SERVICE,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });
    dbMock.csSalesEntry.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/未与当前金额对平.*历史财务校准/);
    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
  });

  it('does not credit a sales-owned order when its requester later becomes customer service', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'sales-1',
        displayName: '原销售',
        role: Role.CUSTOMER_SERVICE,
      },
      order: {
        ...baseReviewRequest().order,
        submitterId: 'sales-1',
        submitterRole: Role.SALES,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('does not credit a draft change before the order submission records the full sale', async () => {
    const request = baseReviewRequest({
      requester: {
        id: 'cs-1',
        displayName: '客服',
        role: Role.CUSTOMER_SERVICE,
      },
      order: {
        ...baseReviewRequest().order,
        status: OrderStatus.DRAFT,
        submitterId: 'cs-1',
        submitterRole: Role.CUSTOMER_SERVICE,
        settlementType: OrderSettlementType.INTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
      },
      proposedChanges: { items: updateInput.items },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.orderItem.findMany.mockResolvedValue([{ subtotal: '1200.00' }]);
    dbMock.orderChangeRequest.update.mockResolvedValue({
      id: 'request-1',
      orderId: 'order-1',
      status: OrderChangeRequestStatus.APPROVED,
    });

    await reviewOrderChangeRequest(
      { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
      adminActor,
    );

    expect(dbMock.csSalesEntry.create).not.toHaveBeenCalled();
    expect(dbMock.salaryPeriod.update).not.toHaveBeenCalled();
  });

  it('rejects a re-quote that would overflow Decimal(12,2)', async () => {
    const request = baseReviewRequest({
      proposedChanges: {
        items: [
          {
            ...updateInput.items[0],
            quantity: 9_999_999,
          },
        ],
      },
      order: {
        ...baseReviewRequest().order,
        items: [
          {
            ...baseReviewRequest().order.items[0],
            unitPrice: '2000.00',
          },
        ],
      },
    });
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(request);
    dbMock.product.findMany.mockResolvedValue([
      { id: 'product-1', baseUnitPrice: '2000.0000' },
    ]);
    dbMock.customerPriceRule.findMany.mockResolvedValue([
      externalBaseRule({ amount: '2000.0000' }),
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/无法按当前规则报价.*建议金额超过系统上限/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects a combined order total that would overflow Decimal(12,2)', async () => {
    dbMock.orderChangeRequest.findUnique
      .mockResolvedValueOnce({ orderId: 'order-1' })
      .mockResolvedValueOnce(baseReviewRequest());
    dbMock.orderItem.findMany.mockResolvedValue([
      { subtotal: '6000000000.00' },
      { subtotal: '6000000000.00' },
    ]);

    await expect(
      reviewOrderChangeRequest(
        { requestId: 'request-1', decision: 'APPROVE', reviewRemark: null },
        adminActor,
      ),
    ).rejects.toThrow(/工单总额超过可保存上限/);
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });
});
