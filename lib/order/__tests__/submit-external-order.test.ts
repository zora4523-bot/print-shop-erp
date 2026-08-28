import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderItemQuoteDisposition,
  OrderPackagingMode,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
} from '../../../generated/prisma/enums';

const {
  appendRevisionMock,
  priceSnapshotMock,
  quoteItemsMock,
  quoteLogisticsMock,
  quotePackagingMock,
  resolveLogisticsMock,
} = vi.hoisted(() => ({
  appendRevisionMock: vi.fn(),
  priceSnapshotMock: vi.fn(),
  quoteItemsMock: vi.fn(),
  quoteLogisticsMock: vi.fn(),
  quotePackagingMock: vi.fn(),
  resolveLogisticsMock: vi.fn(),
}));

vi.mock('../pricing-revision', () => ({
  appendOrderPricingRevisionInTx: appendRevisionMock,
}));

vi.mock('../create-order-price-snapshot', () => ({
  readExternalCreateOrderPriceSnapshot: priceSnapshotMock,
}));

vi.mock('../../price/quote-service', () => {
  class QuoteCatalogInvariantError extends Error {}
  return { QuoteCatalogInvariantError, quoteOrderItems: quoteItemsMock };
});

vi.mock('../../price/order-packaging-quote', () => ({
  quoteOrderPackagingGroups: quotePackagingMock,
}));

vi.mock('../../price/order-charge-service', () => {
  class OrderCustomerChargeError extends Error {}
  return {
    OrderCustomerChargeError,
    quoteExternalOrderChargesInTransaction: quoteLogisticsMock,
    resolveExternalOrderChargesForProvisionalCreation: resolveLogisticsMock,
  };
});

import {
  ExternalOrderQuoteChangedError,
  finalizeExternalOrderQuoteInTx,
} from '../submit-external-order';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const PROCESSING_SHA = 'a'.repeat(64);
const LOGISTICS_SHA = 'b'.repeat(64);

const priceSnapshot = {
  processing: {
    purpose: CustomerPriceBookPurpose.PROCESSING,
    id: 'processing-v7',
    code: 'EXTERNAL_PROCESSING',
    name: '外部销售加工费',
    version: 7,
    sourceSha256: PROCESSING_SHA,
  },
  logistics: {
    purpose: CustomerPriceBookPurpose.LOGISTICS,
    id: 'logistics-v3',
    code: 'EXTERNAL_LOGISTICS',
    name: '外部销售物流',
    version: 3,
    sourceSha256: LOGISTICS_SHA,
  },
} as const;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    fig: 1,
    name: '款式 1',
    productId: 'product-1',
    pricingRoute: 'STOCK_BLANK',
    productStructure: 'STANDARD',
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: 'MID',
    manualQuoteReason: null,
    specification: '中号',
    actualWidthMm: '170.00',
    actualHeightMm: '90.00',
    paperType: '珠光纸',
    paperWeightGsm: 160,
    quantity: 1_000,
    crafts: ['craft-local-foil'],
    foilColors: ['金'],
    frontFoilColors: ['金'],
    backFoilColors: [],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'NONE',
    printColors: [],
    isDoubleSided: false,
    isDoubleColor: false,
    quoteDisposition: null,
    product: {
      paperMaterialId: 'paper-1',
    },
    ...overrides,
  };
}

function draftOrder(overrides: Record<string, unknown> = {}) {
  const items = [
    item(),
    item({
      id: 'item-2',
      sequence: 2,
      fig: 2,
      name: '款式 2',
      productId: 'product-2',
      quantity: 500,
    }),
  ];
  return {
    id: 'order-1',
    orderNo: 'GD-260828-001',
    status: OrderStatus.DRAFT,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    isSfCollect: false,
    priceRevision: 1,
    processingAmount: '0.00',
    packagingAmount: '0.00',
    totalAmount: '0.00',
    quotedFee: null,
    quotedFeeCompleteness: null,
    quotedPricingRevisionId: null,
    quotedPricingRevision: null,
    items,
    packagingGroups: [
      {
        id: 'pack-1',
        sequence: 1,
        name: '混装',
        mode: OrderPackagingMode.MIXED_STYLE,
        actualBagCount: 125,
      },
    ],
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        destinationProvince: '上海',
        weightKg: '12.000',
        lines: [
          { orderItemId: 'item-1', quantity: 1_000 },
          { orderItemId: 'item-2', quantity: 500 },
        ],
      },
    ],
    customerCharges: [],
    ...overrides,
  };
}

function itemQuote(amount: string, overrides: Record<string, unknown> = {}) {
  return {
    complete: true,
    errors: [],
    suggestedUnitPrice: '0.1000',
    suggestedFixedFee: '0.00',
    suggestedSubtotal: amount,
    components: [],
    snapshot: {
      version: 1,
      priceBook: {
        id: priceSnapshot.processing.id,
        code: priceSnapshot.processing.code,
        name: priceSnapshot.processing.name,
        version: priceSnapshot.processing.version,
        sourceName: 'processing.xlsx',
        sourceSha256: PROCESSING_SHA,
      },
      input: {},
      base: {},
      appliedAdjustments: [],
      components: [],
      suggestedUnitPrice: '0.1000',
      suggestedFixedFee: '0.00',
      suggestedSubtotal: amount,
      complete: true,
      errors: [],
    },
    ...overrides,
  };
}

function packagingQuote(overrides: Record<string, unknown> = {}) {
  return {
    priceBook: {
      id: priceSnapshot.processing.id,
      code: priceSnapshot.processing.code,
      name: priceSnapshot.processing.name,
      version: priceSnapshot.processing.version,
      sourceName: 'processing.xlsx',
      sourceSha256: PROCESSING_SHA,
    },
    groups: [
      {
        groupKey: 'pack-1',
        complete: true,
        errors: [],
        suggestedUnitPrice: '0.2000',
        suggestedSubtotal: '25.00',
        snapshot: { version: 1, complete: true, errors: [] },
      },
    ],
    suggestedTotal: '25.00',
    requiresAdminConfirmation: false,
    errors: [],
    ...overrides,
  };
}

function resolvedCharge(args: {
  code: 'SHIPPING_FEE' | 'PACKING_MATERIAL';
  amount: string;
  requiresAdmin?: boolean;
}) {
  const shipping = args.code === 'SHIPPING_FEE';
  return {
    shipmentKey: '1',
    categoryCode: args.code,
    categoryId: shipping ? 'cat-shipping' : 'cat-packing',
    priceBookId: priceSnapshot.logistics.id,
    sourceRuleId: shipping ? 'rule-shipping' : 'rule-packing',
    businessKey: `SHIPMENT:1:${args.code}`,
    status: 'ESTIMATED',
    description: shipping ? '快递费' : '纸箱耗材',
    quantity: shipping ? '12.000' : '1500',
    unit: shipping ? 'kg' : '个',
    suggestedAmount: args.requiresAdmin ? null : args.amount,
    amount: args.amount,
    pricingSnapshot: {
      version: 1,
      actual: {
        amount: args.amount,
        provisional: Boolean(args.requiresAdmin),
        requiresAdminConfirmation: Boolean(args.requiresAdmin),
      },
    },
    overrideReason: null,
  };
}

function logisticsQuote(
  charges = [
    resolvedCharge({ code: 'SHIPPING_FEE', amount: '21.30' }),
    resolvedCharge({ code: 'PACKING_MATERIAL', amount: '20.00' }),
  ],
) {
  return {
    priceBook: {
      ...priceSnapshot.logistics,
      sourceName: 'logistics.xlsx',
      policy: {
        ruleVersion: 'v3',
        billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
        weightResolutionOrder: [
          'ACTUAL_FULFILLMENT_WEIGHT',
          'SERVER_ESTIMATE',
        ],
        maxOrderQuantity: 50_000,
        billableWeightRounding: 'CEIL_KG',
        minimumBillableWeightKg: '1',
        gramsPerItemByPaperWeightGsm: { '160': '8' },
        tenThousandEnvelopeGramsPerItem: '12',
      },
    },
    charges,
    totalAmount: charges
      .reduce((sum, charge) => sum + Number(charge.amount), 0)
      .toFixed(2),
    requiresAdminConfirmation: charges.some(
      (charge) =>
        charge.pricingSnapshot.actual.requiresAdminConfirmation === true,
    ),
  };
}

function logisticsPreview(overrides: Record<string, unknown> = {}) {
  const shipping = {
    code: 'SHIPPING_FEE',
    ruleCode: 'ZTO',
    categoryCode: 'SHIPPING',
    categoryName: '快递费',
    shipmentKey: '1',
    name: '快递费',
    amount: '21.30',
    complete: true,
    advisory: false,
    waived: false,
    basis: { billableWeightKg: '12' },
    source: null,
    errors: [],
  } as const;
  const packaging = {
    code: 'PACKING_MATERIAL',
    ruleCode: 'CARTON',
    categoryCode: 'PACKAGING',
    categoryName: '纸箱耗材',
    shipmentKey: '1',
    name: '纸箱耗材',
    amount: '20.00',
    complete: true,
    advisory: false,
    waived: false,
    basis: { itemQuantity: 1_500 },
    source: null,
    errors: [],
  } as const;
  const quote = {
    complete: true,
    suggestedShippingTotal: '21.30',
    suggestedPackagingTotal: '20.00',
    suggestedTotal: '41.30',
    shipments: [{ shipmentKey: '1', shipping, packaging }],
    components: [shipping, packaging],
    errors: [],
    snapshot: {
      version: 2 as const,
      policy: {
        ruleVersion: 'v3',
        billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE' as const,
        weightResolutionOrder: [
          'ACTUAL_FULFILLMENT_WEIGHT',
          'SERVER_ESTIMATE',
        ],
        maxOrderQuantity: 50_000,
        billableWeightRounding: 'CEIL_KG' as const,
      },
      input: {
        isSfCollect: false,
        shipments: [],
      },
      suggestedShippingTotal: '21.30',
      suggestedPackagingTotal: '20.00',
      suggestedTotal: '41.30',
      components: [shipping, packaging],
      complete: true,
      errors: [],
    },
    ...overrides,
  };
  return {
    priceBook: {
      ...priceSnapshot.logistics,
      sourceName: 'logistics.xlsx',
    },
    quote,
  };
}

function txFor(
  order = draftOrder(),
  paperRows?: Array<{
    id: string;
    name: string;
    normalizedName: string;
    isActive: boolean;
    outOfStock: boolean;
  }>,
) {
  const defaultPaperRows = order.items.map((orderItem) => ({
    id: orderItem.product?.paperMaterialId ?? `fallback-${orderItem.id}`,
    name: orderItem.paperType ?? '未知纸张',
    normalizedName: String(orderItem.paperType ?? '未知纸张').toLocaleLowerCase(
      'zh-CN',
    ),
    isActive: true,
    outOfStock: false,
  }));
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(paperRows ?? defaultPaperRows),
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({ id: order.id }),
    },
    orderItem: { update: vi.fn().mockResolvedValue({ id: 'item' }) },
    orderPackagingGroup: {
      update: vi.fn().mockResolvedValue({ id: 'pack-1' }),
    },
    orderCustomerCharge: {
      upsert: vi.fn().mockResolvedValue({ id: 'charge' }),
    },
    orderPriceVersionLock: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  priceSnapshotMock.mockResolvedValue(priceSnapshot);
  quoteItemsMock.mockResolvedValue([
    itemQuote('400.00'),
    itemQuote('100.00'),
  ]);
  quotePackagingMock.mockResolvedValue(packagingQuote());
  quoteLogisticsMock.mockResolvedValue(logisticsPreview());
  resolveLogisticsMock.mockResolvedValue(logisticsQuote());
  appendRevisionMock.mockResolvedValue({
    pricingRevisionId: 'revision-2',
    priceRevision: 2,
    orderRevision: 1,
    snapshot: {},
  });
});

async function currentQuoteToken(order = draftOrder()): Promise<string> {
  const tx = txFor(order);
  try {
    await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'sales-1',
      NOW,
      null,
    );
  } catch (error) {
    if (error instanceof ExternalOrderQuoteChangedError) {
      for (const mock of [
        priceSnapshotMock,
        quoteItemsMock,
        quotePackagingMock,
        quoteLogisticsMock,
        resolveLogisticsMock,
      ]) {
        mock.mockClear();
      }
      return error.quoteToken;
    }
    throw error;
  }
  throw new Error('预期未携带 token 时返回 QUOTE_CHANGED');
}

describe('finalizeExternalOrderQuoteInTx', () => {
  it('报价 token 缺失或过期时返回最新摘要且不写任何财务事实', async () => {
    const tx = txFor();

    let changed: ExternalOrderQuoteChangedError | null = null;
    try {
      await finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        'create-order-quote-v2:'.concat('0'.repeat(64)),
      );
    } catch (error) {
      if (error instanceof ExternalOrderQuoteChangedError) changed = error;
      else throw error;
    }

    expect(changed).toMatchObject({
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
    });
    expect(changed?.quoteToken).toMatch(
      /^create-order-quote-v2:[a-f\d]{64}$/u,
    );
    expect(resolveLogisticsMock).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(appendRevisionMock).not.toHaveBeenCalled();
    expect(tx.orderPriceVersionLock.createMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('re-quotes only from persisted facts and atomically locks both price versions', async () => {
    const expectedQuoteToken = await currentQuoteToken();
    const tx = txFor();

    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'sales-1',
      NOW,
      expectedQuoteToken,
    );

    expect(result).toMatchObject({
      pricingRevisionId: 'revision-2',
      priceRevision: 2,
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      processingAmount: '525.00',
      packagingAmount: '25.00',
      logisticsAmount: '41.30',
      totalAmount: '566.30',
      manualItemIds: [],
      reused: false,
    });
    expect(quoteItemsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ productId: 'product-1', quantity: 1_000 }),
      ]),
      OrderSettlementType.EXTERNAL_SALES,
      NOW,
      tx,
      { orderItemCount: 2 },
    );
    expect(resolveLogisticsMock).toHaveBeenCalledWith(
      tx,
      {
        isSfCollect: false,
        shipments: [
          expect.objectContaining({
            shipmentKey: '1',
            province: '上海',
            billableWeightKg: '12.000',
            itemQuantity: 1_500,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          }),
        ],
      },
      NOW,
      { snapshotLockHeld: true },
    );
    expect(tx.orderPriceVersionLock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          purpose: CustomerPriceBookPurpose.PROCESSING,
          priceBookId: 'processing-v7',
          priceBookVersion: 7,
          sourceSha256: PROCESSING_SHA,
        }),
        expect.objectContaining({
          purpose: CustomerPriceBookPurpose.LOGISTICS,
          priceBookId: 'logistics-v3',
          priceBookVersion: 3,
          sourceSha256: LOGISTICS_SHA,
        }),
      ],
    });
    expect(tx.order.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'order-1' },
      data: {
        quotedFee: '566.30',
        quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
        quotedPricingRevisionId: 'revision-2',
      },
      select: { id: true },
    });
  });

  it('marks missing item, packaging and logistics prices as manual and excludes them from the known total', async () => {
    const tx = txFor();
    quoteItemsMock.mockResolvedValue([
      itemQuote('100.00'),
      itemQuote('0.00', {
        complete: false,
        errors: ['价表未覆盖'],
        suggestedUnitPrice: null,
        suggestedFixedFee: null,
        suggestedSubtotal: null,
        snapshot: {
          ...itemQuote('0.00').snapshot,
          complete: false,
          errors: ['价表未覆盖'],
          suggestedUnitPrice: null,
          suggestedFixedFee: null,
          suggestedSubtotal: null,
        },
      }),
    ]);
    quotePackagingMock.mockResolvedValue(
      packagingQuote({
        groups: [
          {
            groupKey: 'pack-1',
            complete: false,
            errors: ['包装模式缺价'],
            suggestedUnitPrice: null,
            suggestedSubtotal: null,
            snapshot: { version: 1, complete: false },
          },
        ],
        suggestedTotal: null,
        requiresAdminConfirmation: true,
      }),
    );
    resolveLogisticsMock.mockResolvedValue(
      logisticsQuote([
        resolvedCharge({ code: 'SHIPPING_FEE', amount: '41.30' }),
        resolvedCharge({
          code: 'PACKING_MATERIAL',
          amount: '0.00',
          requiresAdmin: true,
        }),
      ]),
    );
    quoteLogisticsMock.mockResolvedValue(
      logisticsPreview({
        complete: false,
        suggestedPackagingTotal: null,
        suggestedTotal: null,
        components: [
          logisticsPreview().quote.components[0],
          {
            ...logisticsPreview().quote.components[1],
            amount: null,
            complete: false,
            errors: ['纸箱耗材需要人工确认'],
          },
        ],
        errors: ['纸箱耗材需要人工确认'],
      }),
    );

    const expectedQuoteToken = await currentQuoteToken();
    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'sales-1',
      NOW,
      expectedQuoteToken,
    );

    expect(result).toMatchObject({
      quotedFee: '141.30',
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
      processingAmount: '100.00',
      packagingAmount: '0.00',
      logisticsAmount: '41.30',
      manualItemIds: ['item-2'],
    });
    expect(tx.orderItem.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'item-2' },
        data: expect.objectContaining({
          quoteDisposition:
            OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
          quotedAmount: null,
        }),
      }),
    );
    const manualItemWrite = tx.orderItem.update.mock.calls[1]?.[0].data;
    expect(manualItemWrite).not.toHaveProperty('subtotal');
    expect(tx.orderCustomerCharge.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'PENDING_AMOUNT',
          amount: null,
        }),
        update: expect.objectContaining({
          status: 'PENDING_AMOUNT',
          amount: null,
        }),
      }),
    );
    expect(appendRevisionMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: 'PENDING_ADMIN_CONFIRMATION',
        expectedPriceRevision: 1,
      }),
    );
  });

  it('rejects an out-of-stock selected paper before writing fees, versions or quote state', async () => {
    const order = draftOrder({
      items: [
        item({
          product: {
            paperMaterialId: 'paper-out-of-stock',
          },
          paperType: '160g珠光纸',
        }),
        item({
          id: 'item-2',
          sequence: 2,
          fig: 2,
          name: '款式 2',
          productId: 'product-2',
          quantity: 500,
        }),
      ],
    });
    const tx = txFor(order, [
      {
        id: 'paper-out-of-stock',
        name: '160g珠光纸',
        normalizedName: '160g珠光纸',
        isActive: true,
        outOfStock: true,
      },
      {
        id: 'paper-1',
        name: '珠光纸',
        normalizedName: '珠光纸',
        isActive: true,
        outOfStock: false,
      },
    ]);

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
      ),
    ).rejects.toThrow(
      '第 1 款纸张“160g珠光纸”已缺货或停用，请重新选择纸张后再提交',
    );

    expect(tx.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({
            select: expect.objectContaining({
              product: {
                select: {
                  paperMaterialId: true,
                },
              },
            }),
          }),
        }),
      }),
    );
    expect(priceSnapshotMock).not.toHaveBeenCalled();
    expect(quoteItemsMock).not.toHaveBeenCalled();
    expect(quotePackagingMock).not.toHaveBeenCalled();
    expect(resolveLogisticsMock).not.toHaveBeenCalled();
    expect(quoteLogisticsMock).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(appendRevisionMock).not.toHaveBeenCalled();
    expect(tx.orderPriceVersionLock.createMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('兼容未回填 paperMaterialId 的旧产品，按规范化纸名复核停用态', async () => {
    const order = draftOrder({
      items: [
        item({
          fig: 7,
          product: { paperMaterialId: null },
          paperType: '  珠光纸  ',
        }),
      ],
    });
    const tx = txFor(order, [
      {
        id: 'legacy-paper',
        name: '珠光纸',
        normalizedName: '珠光纸',
        isActive: false,
        outOfStock: false,
      },
    ]);

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        null,
      ),
    ).rejects.toThrow('第 7 款纸张“珠光纸”已缺货或停用');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(priceSnapshotMock).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('returns the existing immutable quote without re-running any calculator', async () => {
    const order = draftOrder({
      status: OrderStatus.PENDING_FACTORY,
      processingAmount: '525.00',
      packagingAmount: '25.00',
      totalAmount: '566.30',
      quotedFee: '566.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      quotedPricingRevisionId: 'revision-2',
      quotedPricingRevision: {
        id: 'revision-2',
        revision: 2,
        priceVersionLocks: [
          {
            purpose: CustomerPriceBookPurpose.PROCESSING,
            priceBookId: 'processing-v7',
            priceBookVersion: 7,
            sourceSha256: PROCESSING_SHA,
          },
          {
            purpose: CustomerPriceBookPurpose.LOGISTICS,
            priceBookId: 'logistics-v3',
            priceBookVersion: 3,
            sourceSha256: LOGISTICS_SHA,
          },
        ],
      },
      customerCharges: [
        { amount: '21.30', category: { code: 'SHIPPING_FEE' } },
        { amount: '20.00', category: { code: 'PACKING_MATERIAL' } },
      ],
    });
    const tx = txFor(order);

    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'sales-1',
      NOW,
    );

    expect(result).toMatchObject({
      pricingRevisionId: 'revision-2',
      quotedFee: '566.30',
      logisticsAmount: '41.30',
      reused: true,
    });
    expect(priceSnapshotMock).not.toHaveBeenCalled();
    expect(quoteItemsMock).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderPriceVersionLock.createMany).not.toHaveBeenCalled();
  });
});
