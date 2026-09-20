import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderCustomerChargeStatus,
  OrderFoilTechnique,
  OrderItemQuoteDisposition,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
} from '../../../generated/prisma/enums';
import { buildTrustedAdminItemPricingSnapshot } from '../admin-pricing-snapshot';
import type { CreateOrderPriceSnapshot } from '../../price/create-order';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '../../price/__tests__/fixtures/create-order-golden-fixtures';

const mocks = vi.hoisted(() => ({
  appendRevision: vi.fn(),
  readPublishedSnapshot: vi.fn(),
  resolveLogistics: vi.fn(),
  productFindMany: vi.fn(),
  craftFindMany: vi.fn(),
  materialFindMany: vi.fn(),
  transaction: vi.fn(),
  PublishedCreateOrderPriceAdapterError: class extends Error {},
}));

vi.mock('@/lib/db', () => ({
  db: { $transaction: mocks.transaction },
}));

vi.mock('../pricing-revision', () => ({
  appendOrderPricingRevisionInTx: mocks.appendRevision,
}));

vi.mock('../create-order-published-rule-adapter', () => ({
  PublishedCreateOrderPriceAdapterError:
    mocks.PublishedCreateOrderPriceAdapterError,
  readPublishedCreateOrderPriceSnapshot: mocks.readPublishedSnapshot,
}));

vi.mock('../../price/order-charge-service', () => {
  class OrderCustomerChargeError extends Error {}
  return {
    OrderCustomerChargeError,
    resolveExternalOrderChargesForProvisionalCreation: mocks.resolveLogistics,
  };
});

import {
  ExternalOrderQuoteChangedError,
  finalizeExternalOrderQuoteInTx,
} from '../submit-external-order';
import { quoteExternalCreateOrder } from '../create-order-quote-service';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const PRICE_VERSION = CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    fig: 1,
    name: '款式 1',
    productId: 'product-stock-large-1',
    pricingRoute: 'STOCK_BLANK',
    productStructure: 'STANDARD_ENVELOPE',
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: 'LARGE',
    manualQuoteReason: null,
    specification: '大号封90×165',
    actualWidthMm: '90.00',
    actualHeightMm: '165.00',
    paperType: '160g珠光艳闪',
    paperWeightGsm: 160,
    quantity: 1_000,
    crafts: ['craft-partial'],
    foilColors: ['哑金'],
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'NONE',
    printColors: [],
    isDoubleSided: false,
    isDoubleColor: false,
    quoteDisposition: null,
    product: { paperMaterialId: 'paper-pearl-160' },
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
      productId: 'product-stock-large-2',
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
        lines: [
          { orderItemId: 'item-1', unitsPerBag: 8 },
          { orderItemId: 'item-2', unitsPerBag: 4 },
        ],
      },
    ],
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        receiverName: '收件人',
        receiverPhone: '13800138000',
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

function catalogProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-stock-large-1',
    code: 'EXT-STOCK-PEARL-FLASH-160-LARGE-1',
    category: 'BLANK_STOCK',
    specification: '大号封90×165',
    paperType: '160g珠光艳闪',
    paperMaterialId: 'paper-pearl-160',
    weight: 160,
    isActive: true,
    ...overrides,
  };
}

function catalogPaper(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-pearl-160',
    name: '160g珠光艳闪',
    specification: null,
    outOfStock: false,
    isActive: true,
    ...overrides,
  };
}

function resolvedCharge(args: {
  code: 'SHIPPING_FEE' | 'PACKING_MATERIAL';
  amount: string;
  requiresAdmin?: boolean;
  ruleCode?: string | null;
  waived?: boolean;
}) {
  const shipping = args.code === 'SHIPPING_FEE';
  const ruleCode =
    args.ruleCode === undefined
      ? shipping
        ? 'ZTO_STANDARD_3_5'
        : 'CARTON_1001_2000'
      : args.ruleCode;
  return {
    shipmentKey: '1',
    categoryCode: args.code,
    categoryId: shipping ? 'cat-shipping' : 'cat-packing',
    priceBookId: PRICE_VERSION.logistics.id,
    sourceRuleId: ruleCode ? `rule-${ruleCode}` : null,
    businessKey: `SHIPMENT:1:${args.code}`,
    status: args.waived
      ? OrderCustomerChargeStatus.WAIVED
      : OrderCustomerChargeStatus.ESTIMATED,
    description: shipping ? '快递费' : '纸箱耗材',
    quantity: shipping ? '12' : '1500',
    unit: shipping ? 'kg' : '个',
    suggestedAmount: args.requiresAdmin ? null : args.amount,
    amount: args.amount,
    pricingSnapshot: {
      version: 1,
      priceBook: {
        id: PRICE_VERSION.logistics.id,
        version: PRICE_VERSION.logistics.version,
        sourceSha256: PRICE_VERSION.logistics.sourceSha256,
        policy: CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.logisticsPolicy,
      },
      quote: { ruleCode },
      actual: {
        amount: args.amount,
        provisional: Boolean(args.requiresAdmin),
        requiresAdminConfirmation: Boolean(args.requiresAdmin),
      },
    },
    overrideReason: null,
  };
}

function resolvedLogistics(
  charges = [
    resolvedCharge({ code: 'SHIPPING_FEE', amount: '41.30' }),
    resolvedCharge({ code: 'PACKING_MATERIAL', amount: '5.00' }),
  ],
  overrides: Record<string, unknown> = {},
) {
  return {
    priceBook: {
      id: PRICE_VERSION.logistics.id,
      code: PRICE_VERSION.logistics.code,
      name: '外部销售物流',
      version: PRICE_VERSION.logistics.version,
      sourceName: 'logistics.xlsx',
      sourceSha256: PRICE_VERSION.logistics.sourceSha256,
      policy: CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.logisticsPolicy,
    },
    charges,
    totalAmount: charges
      .reduce((sum, charge) => sum + Number(charge.amount), 0)
      .toFixed(2),
    requiresAdminConfirmation: charges.some(
      (charge) =>
        charge.pricingSnapshot.actual.requiresAdminConfirmation === true,
    ),
    ...overrides,
  };
}

function availabilityRows(order: ReturnType<typeof draftOrder>) {
  return order.items.map((orderItem) => ({
    id: orderItem.product?.paperMaterialId ?? `fallback-${orderItem.id}`,
    name: orderItem.paperType ?? '未知纸张',
    normalizedName: String(
      orderItem.paperType ?? '未知纸张',
    ).toLocaleLowerCase('zh-CN'),
    specification: null,
    isActive: true,
    outOfStock: false,
  }));
}

function txFor(
  order = draftOrder(),
  paperRows = availabilityRows(order),
) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(paperRows),
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
    customerChargeCategory: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'cat-plate',
        isActive: true,
      }),
    },
    orderPriceVersionLock: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    product: { findMany: mocks.productFindMany },
    craft: { findMany: mocks.craftFindMany },
    material: { findMany: mocks.materialFindMany },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readPublishedSnapshot.mockResolvedValue(
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
  mocks.resolveLogistics.mockResolvedValue(resolvedLogistics());
  mocks.productFindMany.mockResolvedValue([
    catalogProduct(),
    catalogProduct({
      id: 'product-stock-large-2',
      code: 'EXT-STOCK-PEARL-FLASH-160-LARGE-2',
    }),
  ]);
  mocks.craftFindMany.mockResolvedValue([
    { id: 'craft-partial', code: 'FLAT_FOIL_PARTIAL', isActive: true },
  ]);
  mocks.materialFindMany.mockResolvedValue([catalogPaper()]);
  mocks.appendRevision.mockResolvedValue({
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
        mocks.readPublishedSnapshot,
        mocks.resolveLogistics,
        mocks.productFindMany,
        mocks.craftFindMany,
        mocks.materialFindMany,
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
  it('预览与提交使用同一组 canonical 事实时 token 可直接验证', async () => {
    const order = draftOrder({
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          receiverName: '收件人',
          receiverPhone: '13800138000',
          destinationProvince: '上海',
          // A newly-created draft has no trusted fulfilment weight. Browser
          // quotedWeightKg is not persisted into this field.
          weightKg: null,
          lines: [
            { orderItemId: 'item-1', quantity: 1_000 },
            { orderItemId: 'item-2', quantity: 500 },
          ],
        },
      ],
    });
    const previewTx = txFor(order);
    mocks.transaction.mockImplementation(async (run) => run(previewTx));
    mocks.resolveLogistics.mockResolvedValue(
      resolvedLogistics([
        resolvedCharge({ code: 'SHIPPING_FEE', amount: '30.80' }),
        resolvedCharge({ code: 'PACKING_MATERIAL', amount: '5.00' }),
      ]),
    );
    const preview = await quoteExternalCreateOrder(
      {
        factsKey: 'browser-facts-key',
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        items: [
          {
            productId: 'product-stock-large-1',
            pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
            productStructure: OrderProductStructure.STANDARD_ENVELOPE,
            artworkVersion: null,
            plateGroupId: null,
            pricingGroup: 'LARGE',
            specification: '大号封90×165',
            actualWidthMm: 90,
            actualHeightMm: 165,
            paperType: '160g珠光艳闪',
            paperWeightGsm: 160,
            quantity: 1_000,
            crafts: ['craft-partial'],
            frontFoilColors: ['哑金'],
            backFoilColors: [],
            foilColors: ['哑金'],
            foilTechnique: OrderFoilTechnique.FLAT,
            hasLocalFoil: true,
            lamination: OrderLamination.NONE,
            printColors: [],
            isDoubleSided: false,
            isDoubleColor: false,
          },
          {
            productId: 'product-stock-large-2',
            pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
            productStructure: OrderProductStructure.STANDARD_ENVELOPE,
            artworkVersion: null,
            plateGroupId: null,
            pricingGroup: 'LARGE',
            specification: '大号封90×165',
            actualWidthMm: 90,
            actualHeightMm: 165,
            paperType: '160g珠光艳闪',
            paperWeightGsm: 160,
            quantity: 500,
            crafts: ['craft-partial'],
            frontFoilColors: ['哑金'],
            backFoilColors: [],
            foilColors: ['哑金'],
            foilTechnique: OrderFoilTechnique.FLAT,
            hasLocalFoil: true,
            lamination: OrderLamination.NONE,
            printColors: [],
            isDoubleSided: false,
            isDoubleColor: false,
          },
        ],
        orderItemCount: 2,
        packagingGroups: [
          {
            groupKey: '1',
            mode: OrderPackagingMode.MIXED_STYLE,
            actualBagCount: 125,
            itemUnitsPerBag: [8, 4],
          },
        ],
        logistics: {
          isSfCollect: false,
          items: [],
          shipments: [
            {
              shipmentKey: '1',
              province: '上海',
              billableWeightKg: '999',
              itemQuantity: 1_500,
              itemQuantities: [1_000, 500],
            },
          ],
        },
      },
      NOW,
    );
    const submitTx = txFor(order);

    const result = await finalizeExternalOrderQuoteInTx(
      submitTx as unknown as Prisma.TransactionClient,
      order.id,
      'sales-1',
      NOW,
      preview.quoteToken,
    );

    expect(result).toMatchObject({
      quotedFee: '335.80',
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.COMPLETE,
      reused: false,
    });
  });

  it('报价 token 缺失或过期时返回纯引擎最新摘要且不写财务事实', async () => {
    const tx = txFor();

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        'create-order-quote-v2:'.concat('0'.repeat(64)),
      ),
    ).rejects.toMatchObject({
      quotedFee: '346.30',
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.COMPLETE,
    });

    expect(mocks.resolveLogistics).not.toHaveBeenCalled();
    expect(tx.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
    expect(tx.orderPriceVersionLock.createMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('只从持久化事实重算，写入 v2 明细并同时锁定双价目版本', async () => {
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
      quotedFee: '346.30',
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.COMPLETE,
      processingAmount: '300.00',
      packagingAmount: '25.00',
      logisticsAmount: '46.30',
      totalAmount: '346.30',
      manualItemIds: [],
      reused: false,
    });
    expect(mocks.readPublishedSnapshot).toHaveBeenCalledWith(tx, {
      now: NOW,
      snapshotLockHeld: true,
    });
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.resolveLogistics).toHaveBeenCalledWith(
      tx,
      {
        isSfCollect: false,
        shipments: [
          expect.objectContaining({
            shipmentKey: '1',
            province: '上海',
            billableWeightKg: '12',
            itemQuantity: 1_500,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
            weightItems: [
              expect.objectContaining({ itemKey: '1', quantity: 1_000 }),
              expect.objectContaining({ itemKey: '2', quantity: 500 }),
            ],
          }),
        ],
      },
      NOW,
      { snapshotLockHeld: true },
    );
    expect(tx.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          packagingGroups: expect.objectContaining({
            select: expect.objectContaining({
              lines: expect.objectContaining({
                select: { orderItemId: true, unitsPerBag: true },
              }),
            }),
          }),
        }),
      }),
    );
    expect(tx.orderItem.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          quotedAmount: '170.00',
          pricingSnapshot: expect.objectContaining({
            version: 1,
            schemaVersion: 2,
            engineVersion: 'CREATE_ORDER_PURE_V1',
            source: 'EXTERNAL_SUBMIT_QUOTE',
          }),
        }),
      }),
    );
    expect(tx.orderPackagingGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: '25.00',
          pricingSnapshot: expect.objectContaining({
            schemaVersion: 2,
            engineVersion: 'CREATE_ORDER_PURE_V1',
            bagCount: 125,
          }),
        }),
      }),
    );
    expect(tx.orderCustomerCharge.upsert).toHaveBeenCalledTimes(2);
    expect(tx.orderPriceVersionLock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          purpose: CustomerPriceBookPurpose.PROCESSING,
          priceBookId: PRICE_VERSION.processing.id,
          priceBookVersion: PRICE_VERSION.processing.version,
          sourceSha256: PRICE_VERSION.processing.sourceSha256,
        }),
        expect.objectContaining({
          purpose: CustomerPriceBookPurpose.LOGISTICS,
          priceBookId: PRICE_VERSION.logistics.id,
          priceBookVersion: PRICE_VERSION.logistics.version,
          sourceSha256: PRICE_VERSION.logistics.sourceSha256,
        }),
      ],
    });
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        orderFeeSnapshot: {
          quotedFee: '346.30',
          confirmedFee: null,
          settledFee: null,
        },
        metadata: expect.objectContaining({
          engineVersion: 'CREATE_ORDER_PURE_V1',
          priceBooks: PRICE_VERSION,
        }),
      }),
    );
    expect(tx.order.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'order-1' },
      data: {
        quotedFee: '346.30',
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.COMPLETE,
        quotedPricingRevisionId: 'revision-2',
        confirmedFee: null,
        settledFee: null,
      },
      select: { id: true },
    });
  });

  it('纯彩印无烫金提交时不查不写制版费且自动确认完整报价', async () => {
    const order = draftOrder({
      items: [
        item({
          id: 'item-print',
          productId: 'product-print-large',
          pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
          paperType: '200g铜版纸',
          paperWeightGsm: 200,
          quantity: 2_000,
          crafts: ['craft-print'],
          foilColors: [],
          frontFoilColors: [],
          backFoilColors: [],
          foilTechnique: OrderFoilTechnique.NONE,
          hasLocalFoil: false,
          printColors: ['CMYK'],
          product: { paperMaterialId: 'paper-coated-200' },
        }),
      ],
      packagingGroups: [
        {
          id: 'pack-1',
          sequence: 1,
          name: '单装',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 200,
          lines: [{ orderItemId: 'item-print', unitsPerBag: 10 }],
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          receiverName: '收件人',
          receiverPhone: '13800138000',
          destinationProvince: '上海',
          weightKg: '12.000',
          lines: [{ orderItemId: 'item-print', quantity: 2_000 }],
        },
      ],
    });
    mocks.productFindMany.mockResolvedValue([
      catalogProduct({
        id: 'product-print-large',
        code: 'PRINT-COATED-200-LARGE',
        category: 'COLOR_PRINT',
        paperType: '200g铜版纸',
        paperMaterialId: 'paper-coated-200',
        weight: 200,
      }),
    ]);
    mocks.craftFindMany.mockResolvedValue([
      { id: 'craft-print', code: 'COATED_COLOR_PRINT', isActive: true },
    ]);
    mocks.materialFindMany.mockResolvedValue([
      catalogPaper({
        id: 'paper-coated-200',
        name: '铜版纸',
        specification: '200g',
      }),
    ]);

    const expectedQuoteToken = await currentQuoteToken(order);
    const tx = txFor(order);
    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      order.id,
      'sales-1',
      NOW,
      expectedQuoteToken,
    );

    expect(result).toMatchObject({
      quotedFee: '516.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      processingAmount: '470.00',
      logisticsAmount: '46.30',
      totalAmount: '516.30',
      manualItemIds: [],
    });
    expect(tx.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).toHaveBeenCalledTimes(2);
    expect(tx.orderCustomerCharge.upsert.mock.calls).not.toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            where: {
              orderId_businessKey: {
                orderId: order.id,
                businessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
              },
            },
          }),
        ],
      ]),
    );
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        orderFeeSnapshot: {
          quotedFee: '516.30',
          confirmedFee: null,
          settledFee: null,
        },
        metadata: expect.objectContaining({
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
          pureQuote: expect.objectContaining({
            pendingLineCodes: [],
            pendingReasons: [],
          }),
        }),
      }),
    );
  });

  it('彩印单色烫金以含版费原子套餐提交，不再写独立制版费', async () => {
    const order = draftOrder({
      items: [
        item({
          id: 'item-print-foil',
          productId: 'product-print-large',
          pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
          paperType: '200g铜版纸',
          paperWeightGsm: 200,
          quantity: 2_000,
          crafts: ['craft-print-foil'],
          foilColors: ['哑金'],
          frontFoilColors: ['哑金'],
          backFoilColors: [],
          foilTechnique: OrderFoilTechnique.FLAT,
          hasLocalFoil: true,
          printColors: ['CMYK'],
          product: { paperMaterialId: 'paper-coated-200' },
        }),
      ],
      packagingGroups: [
        {
          id: 'pack-1',
          sequence: 1,
          name: '单装',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 200,
          lines: [{ orderItemId: 'item-print-foil', unitsPerBag: 10 }],
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          receiverName: '收件人',
          receiverPhone: '13800138000',
          destinationProvince: '上海',
          weightKg: '12.000',
          lines: [{ orderItemId: 'item-print-foil', quantity: 2_000 }],
        },
      ],
    });
    mocks.productFindMany.mockResolvedValue([
      catalogProduct({
        id: 'product-print-large',
        code: 'PRINT-COATED-200-LARGE',
        category: 'COLOR_PRINT',
        paperType: '200g铜版纸',
        paperMaterialId: 'paper-coated-200',
        weight: 200,
      }),
    ]);
    mocks.craftFindMany.mockResolvedValue([
      {
        id: 'craft-print-foil',
        code: 'COATED_COLOR_PRINT_FOIL',
        isActive: true,
      },
    ]);
    mocks.materialFindMany.mockResolvedValue([
      catalogPaper({
        id: 'paper-coated-200',
        name: '铜版纸',
        specification: '200g',
      }),
    ]);

    const expectedQuoteToken = await currentQuoteToken(order);
    const tx = txFor(order);
    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      order.id,
      'sales-1',
      NOW,
      expectedQuoteToken,
    );

    expect(result).toMatchObject({
      quotedFee: '766.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      processingAmount: '720.00',
      logisticsAmount: '46.30',
      totalAmount: '766.30',
      manualItemIds: [],
    });
    expect(tx.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).toHaveBeenCalledTimes(2);
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-print-foil' },
        data: expect.objectContaining({
          quotedAmount: '700.00',
          quoteDisposition: OrderItemQuoteDisposition.PRICED,
        }),
      }),
    );
    expect(mocks.appendRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        status: 'AUTO_CONFIRMED',
        metadata: expect.objectContaining({
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
          pureQuote: expect.objectContaining({
            pendingLineCodes: [],
            manualReasons: [],
          }),
        }),
      }),
    );
  });

  it('空白封缺价时拒绝首次提交且不写入任何金额', async () => {
    const order = draftOrder({
      items: [
        item(),
        item({
          id: 'item-2',
          sequence: 2,
          fig: 2,
          name: '款式 2',
          productId: 'product-red-large',
          paperType: '180g红卡',
          paperWeightGsm: 180,
          quantity: 500,
          product: { paperMaterialId: 'paper-red-180' },
        }),
      ],
    });
    const manualSnapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices:
          CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map((row) =>
            row.paperType === '红卡' ? { ...row, unitPrice: null } : row,
          ),
      },
      orderCharges: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges,
        rules: CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.rules.filter(
          (rule) => rule.kind !== 'PACKAGING',
        ),
      },
    };
    mocks.readPublishedSnapshot.mockResolvedValue(manualSnapshot);
    mocks.productFindMany.mockResolvedValue([
      catalogProduct(),
      catalogProduct({
        id: 'product-red-large',
        code: 'EXT-STOCK-RED-180-LARGE',
        paperType: '180g红卡',
        paperMaterialId: 'paper-red-180',
        weight: 180,
      }),
    ]);
    mocks.materialFindMany.mockResolvedValue([
      catalogPaper(),
      catalogPaper({
        id: 'paper-red-180',
        name: '180g红卡',
      }),
    ]);
    mocks.resolveLogistics.mockResolvedValue(
      resolvedLogistics([
        resolvedCharge({ code: 'SHIPPING_FEE', amount: '41.30' }),
        resolvedCharge({
          code: 'PACKING_MATERIAL',
          amount: '0.00',
          requiresAdmin: true,
          ruleCode: null,
        }),
      ]),
    );

    const tx = txFor(order);
    await expect(finalizeExternalOrderQuoteInTx(tx as unknown as Prisma.TransactionClient,
      'order-1', 'sales-1', NOW, null)).rejects.toThrow('未启用');
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
    expect(mocks.appendRevision).not.toHaveBeenCalled();
  });

  it('顺丰到付与默认零版费仍可完整自动报价', async () => {
    const order = draftOrder({ isSfCollect: true });
    mocks.resolveLogistics.mockResolvedValue(
      resolvedLogistics([
        resolvedCharge({
          code: 'SHIPPING_FEE',
          amount: '0.00',
          ruleCode: null,
          waived: true,
        }),
        resolvedCharge({ code: 'PACKING_MATERIAL', amount: '5.00' }),
      ]),
    );
    const token = await currentQuoteToken(order);
    const tx = txFor(order);

    const result = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      order.id,
      'sales-1',
      NOW,
      token,
    );

    expect(result).toMatchObject({
      quotedFee: '305.00',
      quotedFeeCompleteness:
        OrderQuotedFeeCompleteness.COMPLETE,
    });
    expect(tx.orderCustomerCharge.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          status: OrderCustomerChargeStatus.WAIVED,
          amount: '0.00',
        }),
      }),
    );
    expect(tx.orderCustomerCharge.upsert).toHaveBeenCalledTimes(2);
  });

  it('物流持久化金额与纯引擎不一致时拒绝任何财务写入', async () => {
    const token = await currentQuoteToken();
    mocks.resolveLogistics.mockResolvedValue(
      resolvedLogistics([
        resolvedCharge({ code: 'SHIPPING_FEE', amount: '40.00' }),
        resolvedCharge({ code: 'PACKING_MATERIAL', amount: '5.00' }),
      ]),
    );
    const tx = txFor();

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        token,
      ),
    ).rejects.toThrow('物流持久化金额与纯引擎结果不一致');
    expect(tx.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('物流持久化规则版本与纯引擎不一致时拒绝写入', async () => {
    const token = await currentQuoteToken();
    mocks.resolveLogistics.mockResolvedValue(
      resolvedLogistics(undefined, {
        priceBook: {
          ...resolvedLogistics().priceBook,
          policy: {
            ...CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.logisticsPolicy,
            ruleVersion: 'forged-rule-version',
          },
        },
      }),
    );
    const tx = txFor();

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        token,
      ),
    ).rejects.toThrow('物流持久化的计费规则版本与纯引擎不一致');
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('默认零版费无需收费类目，不在提交端创建或改配置', async () => {
    const token = await currentQuoteToken();
    const tx = txFor();
    tx.customerChargeCategory.findUnique.mockResolvedValue(null);

    await expect(
      finalizeExternalOrderQuoteInTx(
        tx as unknown as Prisma.TransactionClient,
        'order-1',
        'sales-1',
        NOW,
        token,
      ),
    ).resolves.toMatchObject({ quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE });
    expect(tx.customerChargeCategory.findUnique).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).toHaveBeenCalledTimes(2);
  });

  it('拒绝停用前保存的 120g 草稿，即使纸张仍为启用状态', async () => {
    const order = draftOrder({ items: [item({
      product: { paperMaterialId: 'paper-120' },
      paperType: '120g珠光艳闪', paperWeightGsm: 120,
    })] });
    const tx = txFor(order, [{ id: 'paper-120', name: '120g珠光艳闪',
      normalizedName: '120g珠光艳闪', specification: null, isActive: true, outOfStock: false }]);
    await expect(finalizeExternalOrderQuoteInTx(tx as unknown as Prisma.TransactionClient,
      'order-1', 'sales-1', NOW)).rejects.toThrow('已缺货或停用');
    expect(mocks.readPublishedSnapshot).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('内销空白封不能通过配置外说明绕过纸张规格准入', async () => {
    const order = draftOrder({
      settlementType: OrderSettlementType.INTERNAL_SALES,
      items: [
        item({
          productId: null,
          product: null,
          paperType: null,
          paperWeightGsm: null,
          specification: null,
          crafts: [],
          manualQuoteReason: '客供纸与特殊工艺',
        }),
      ],
      packagingGroups: [
        {
          id: 'pack-1',
          sequence: 1,
          name: '单款',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 125,
          lines: [{ orderItemId: 'item-1', unitsPerBag: 8 }],
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          receiverName: '收件人',
          receiverPhone: null,
          destinationProvince: '上海',
          weightKg: null,
          lines: [{ orderItemId: 'item-1', quantity: 1_000 }],
        },
      ],
    });
    const tx = txFor(order, []);
    const outcome = await finalizeExternalOrderQuoteInTx(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'cs-1',
      NOW,
    ).catch((error: unknown) => error);
    if (outcome instanceof Error) {
      expect(outcome.message).toMatch(/空白封纸张、克重和标准规格/);
    }
    expect(outcome).toBeInstanceOf(Error);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.readPublishedSnapshot).toHaveBeenCalled();
  });

  it('纸张缺货时在读价目前拒绝提交', async () => {
    const order = draftOrder({
      items: [
        item({
          product: { paperMaterialId: 'paper-out-of-stock' },
          paperType: '160g珠光艳闪',
        }),
      ],
      packagingGroups: [
        {
          id: 'pack-1',
          sequence: 1,
          name: '单款',
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 125,
          lines: [{ orderItemId: 'item-1', unitsPerBag: 8 }],
        },
      ],
      shipments: [
        {
          id: 'shipment-1',
          sequence: 1,
          receiverName: '收件人',
          receiverPhone: '13800138000',
          destinationProvince: '上海',
          weightKg: null,
          lines: [{ orderItemId: 'item-1', quantity: 1_000 }],
        },
      ],
    });
    const tx = txFor(order, [
      {
        id: 'paper-out-of-stock',
        name: '160g珠光艳闪',
        normalizedName: '160g珠光艳闪',
        specification: null,
        isActive: true,
        outOfStock: true,
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
      '第 1 款纸张“160g珠光艳闪”已缺货或停用，请重新选择纸张后再提交',
    );
    expect(mocks.readPublishedSnapshot).not.toHaveBeenCalled();
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('通用 CUSTOM 产品按别名与克重唯一解析纸张，停用后失败关闭', async () => {
    const order = draftOrder({
      items: [
        item({
          fig: 7,
          product: { paperMaterialId: null },
          paperType: '莱尼纹',
          paperWeightGsm: 150,
        }),
      ],
    });
    const tx = txFor(order, [
      {
        id: 'legacy-paper',
        name: '150g莱尼纹 / 莱尼纹',
        normalizedName: '150g莱尼纹 / 莱尼纹',
        specification: null,
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
    ).rejects.toThrow('第 7 款纸张“150g莱尼纹 / 莱尼纹”已缺货或停用');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const paperReadSql = (
      tx.$queryRaw.mock.calls[0]![0] as TemplateStringsArray
    ).join('?');
    expect(paperReadSql).not.toMatch(/\bFOR\s+(?:KEY\s+)?(?:SHARE|UPDATE)\b/iu);
    expect(tx.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]!,
    );
    expect(mocks.readPublishedSnapshot).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('草稿改单留下的旧报价不能绕过纸张停用复核', async () => {
    const order = draftOrder({
      processingAmount: '300.00',
      packagingAmount: '25.00',
      totalAmount: '346.30',
      quotedFee: '346.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      quotedPricingRevisionId: 'revision-from-change-request',
      quotedPricingRevision: {
        id: 'revision-from-change-request',
        revision: 2,
        priceVersionLocks: [
          {
            purpose: CustomerPriceBookPurpose.PROCESSING,
            priceBookId: PRICE_VERSION.processing.id,
            priceBookVersion: PRICE_VERSION.processing.version,
            sourceSha256: PRICE_VERSION.processing.sourceSha256,
          },
          {
            purpose: CustomerPriceBookPurpose.LOGISTICS,
            priceBookId: PRICE_VERSION.logistics.id,
            priceBookVersion: PRICE_VERSION.logistics.version,
            sourceSha256: PRICE_VERSION.logistics.sourceSha256,
          },
        ],
      },
      customerCharges: [
        { amount: '41.30', category: { code: 'SHIPPING_FEE' } },
        { amount: '5.00', category: { code: 'PACKING_MATERIAL' } },
      ],
    });
    const tx = txFor(order, [
      {
        id: 'paper-pearl-160',
        name: '160g珠光艳闪',
        normalizedName: '160g珠光艳闪',
        specification: null,
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
      ),
    ).rejects.toThrow(/第 1 款纸张.*已缺货或停用/);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.readPublishedSnapshot).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });

  it('历史已报价工单只读不可变快照，不重跑任何引擎', async () => {
    const order = draftOrder({
      status: OrderStatus.PENDING_FACTORY,
      processingAmount: '300.00',
      packagingAmount: '25.00',
      totalAmount: '346.30',
      quotedFee: '346.30',
      quotedFeeCompleteness: OrderQuotedFeeCompleteness.COMPLETE,
      quotedPricingRevisionId: 'revision-2',
      quotedPricingRevision: {
        id: 'revision-2',
        revision: 2,
        priceVersionLocks: [
          {
            purpose: CustomerPriceBookPurpose.PROCESSING,
            priceBookId: PRICE_VERSION.processing.id,
            priceBookVersion: PRICE_VERSION.processing.version,
            sourceSha256: PRICE_VERSION.processing.sourceSha256,
          },
          {
            purpose: CustomerPriceBookPurpose.LOGISTICS,
            priceBookId: PRICE_VERSION.logistics.id,
            priceBookVersion: PRICE_VERSION.logistics.version,
            sourceSha256: PRICE_VERSION.logistics.sourceSha256,
          },
        ],
      },
      customerCharges: [
        { amount: '41.30', category: { code: 'SHIPPING_FEE' } },
        { amount: '5.00', category: { code: 'PACKING_MATERIAL' } },
        { amount: null, category: { code: 'PLATE_MAKING_FEE' } },
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
      quotedFee: '346.30',
      logisticsAmount: '46.30',
      reused: true,
    });
    expect(mocks.readPublishedSnapshot).not.toHaveBeenCalled();
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.resolveLogistics).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderPriceVersionLock.createMany).not.toHaveBeenCalled();
  });
});

it.each(['receiverName', 'receiverPhone'])('旧草稿提交前重新验证额外地址 %s', async (field) => {
  const source = draftOrder();
  const order = draftOrder({ shipments: [source.shipments[0], { ...source.shipments[0], id: 'shipment-2', sequence: 2, [field]: null }] });
  const tx = txFor(order);
  await expect(finalizeExternalOrderQuoteInTx(tx as unknown as Prisma.TransactionClient, order.id, 'admin', NOW, null)).rejects.toThrow('地址 2：请填写');
  expect(mocks.appendRevision).not.toHaveBeenCalled();
  expect(tx.order.update).not.toHaveBeenCalled();
});

it('一次性预览 token 只对从未报价的草稿放行，驳回重提必须确认当前管理员价', async () => {
  // The create preview cannot include persisted admin-price snapshots, so its
  // token omits them; the finalizer accepts it on the first submit of a DRAFT.
  // A REJECTED re-submit must not wave through an admin price that changed
  // after the preview was taken.
  const adminItem = item({ orderId: 'order-1', pack: 8, printColorsKnown: true, unitPrice: '0.2000', fixedFee: '0.00', subtotal: '200.00', priceOverrideReason: null, craft: null });
  const singleItemOrder = (extra: Record<string, unknown> = {}, priced = true) => draftOrder({
    items: [priced
      ? { ...adminItem, pricingSnapshot: buildTrustedAdminItemPricingSnapshot({
          previous: null, now: NOW, actorId: 'owner-1', previousPriceRevision: 0,
          item: { ...adminItem, orderId: 'order-1' } as never,
        }) }
      : adminItem],
    packagingGroups: [{ id: 'pack-1', sequence: 1, name: '单款', mode: OrderPackagingMode.SINGLE_STYLE, actualBagCount: 125, lines: [{ orderItemId: 'item-1', unitsPerBag: 8 }] }],
    shipments: [{ id: 'shipment-1', sequence: 1, receiverName: '收件人', receiverPhone: '13800138000', destinationProvince: '上海', weightKg: null, lines: [{ orderItemId: 'item-1', quantity: 1_000 }] }],
    ...extra,
  });

  // Identical pure facts, no admin price: its token is exactly the shape the
  // create preview produces for the admin-priced order.
  const previewShapedToken = await currentQuoteToken(singleItemOrder({}, false));
  expect(previewShapedToken).toBeTruthy();

  const draftOutcome = await finalizeExternalOrderQuoteInTx(
    txFor(singleItemOrder()) as unknown as Prisma.TransactionClient, 'order-1', 'sales-1', NOW, previewShapedToken,
  ).catch((error: unknown) => error);
  expect(draftOutcome).not.toBeInstanceOf(ExternalOrderQuoteChangedError);

  const rejected = singleItemOrder({ status: OrderStatus.REJECTED, quotedPricingRevisionId: 'old-revision' });
  await expect(
    finalizeExternalOrderQuoteInTx(txFor(rejected) as unknown as Prisma.TransactionClient, 'order-1', 'sales-1', NOW, previewShapedToken),
  ).rejects.toBeInstanceOf(ExternalOrderQuoteChangedError);
});

it('rejected orders with a previous quote reprice instead of reusing it', async () => {
  const order = draftOrder({ status: OrderStatus.REJECTED, quotedPricingRevisionId: 'old-revision' });
  const token = await currentQuoteToken(order);
  expect(token).toBeTruthy();
  const tx = txFor(order);
  const result = await finalizeExternalOrderQuoteInTx(tx as unknown as Prisma.TransactionClient, order.id, 'sales-1', NOW, token);
  expect(result.reused).toBe(false);
});
