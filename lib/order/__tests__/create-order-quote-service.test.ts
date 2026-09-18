import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderSettlementType,
} from '../../../generated/prisma/enums';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '../../price/__tests__/fixtures/create-order-golden-fixtures';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  readSnapshot: vi.fn(),
  productFindMany: vi.fn(),
  craftFindMany: vi.fn(),
  materialFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock('@/lib/order/create-order-published-rule-adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../create-order-published-rule-adapter')
  >('../create-order-published-rule-adapter');
  return {
    ...actual,
    readPublishedCreateOrderPriceSnapshot: mocks.readSnapshot,
  };
});

import { calculateWorkbenchItem } from '@/lib/workbench/service';
import { workbenchItemQuoteSchema } from '@/lib/workbench/item-quote';
import {
  quoteExternalCreateOrder,
  type CreateOrderQuoteInput,
} from '../create-order-quote-service';

const now = new Date('2026-08-28T05:00:00.000Z');
const tx = {
  product: { findMany: mocks.productFindMany },
  craft: { findMany: mocks.craftFindMany },
  material: { findMany: mocks.materialFindMany },
};

const item = {
  productId: 'product-stock-large',
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
  quantity: 2_000,
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
};

function input(overrides: Partial<CreateOrderQuoteInput> = {}): CreateOrderQuoteInput {
  return {
    factsKey: 'facts:item-count=1;shipping=shanghai',
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    items: [item],
    orderItemCount: 1,
    packagingGroups: [
      {
        groupKey: 'bag-1',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 20,
        itemUnitsPerBag: [100],
      },
    ],
    logistics: {
      isSfCollect: false,
      items: [
        {
          itemKey: 'forged-logistics-fact',
          quantity: 2_000,
          paperWeightGsm: 1,
          paperType: '伪造纸张',
          productStructure: OrderProductStructure.UNSPECIFIED,
        },
      ],
      shipments: [
        {
          shipmentKey: 'shipment-1',
          province: '上海',
          billableWeightKg: '999',
          itemQuantity: 2_000,
          itemQuantities: [2_000],
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (run) => run(tx));
  mocks.readSnapshot.mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  mocks.productFindMany.mockResolvedValue([
    {
      id: 'product-stock-large',
      code: 'EXT-STOCK-PEARL-FLASH-160-LARGE',
      category: 'BLANK_STOCK',
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
      paperMaterialId: null,
      weight: null,
      isActive: true,
    },
  ]);
  mocks.craftFindMany.mockResolvedValue([
    { id: 'craft-partial', code: 'FLAT_FOIL_PARTIAL', isActive: true },
  ]);
  mocks.materialFindMany.mockResolvedValue([
    {
      id: 'paper-pearl-flash-160',
      name: '160g珠光艳闪',
      specification: null,
      outOfStock: false,
      isActive: true,
    },
  ]);
});

describe('quoteExternalCreateOrder', () => {
  it('拒绝 120g 款式，且不进入事务', async () => {
    await expect(quoteExternalCreateOrder(input({
      items: [{ ...item, paperType: '120g珠光艳闪', paperWeightGsm: 120 }],
    }), now)).rejects.toThrow('120g 纸张已停用');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('在一个事务内读取双版本并只调用新纯引擎', async () => {
    const result = await quoteExternalCreateOrder(input(), now);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.readSnapshot).toHaveBeenCalledWith(tx, { now });
    expect(result.priceVersion).toEqual(CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion);
    expect(result.items[0]).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.1300',
      suggestedFixedFee: '80.00',
      suggestedSubtotal: '340.00',
    });
    expect(result).toMatchObject({
      total: result.knownTotal,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
      plateFee: null,
    });
    expect(result.quoteToken).toMatch(/^create-order-quote-v2:[a-f\d]{64}$/);
  });

  it('擦除浏览器重量与伪造 logistics items，使用目录款式估重', async () => {
    const result = await quoteExternalCreateOrder(input(), now);

    expect(result.logistics.shipments[0]?.shipping.basis).toMatchObject({
      weightSource: 'SERVER_ESTIMATE',
      netWeightGrams: '12000',
      billableWeightKg: '12',
    });
    expect(result.logistics.suggestedShippingTotal).toBe('41.30');
  });

  it('改尺寸款转人工但不清空物流等已知费用', async () => {
    const result = await quoteExternalCreateOrder(
      input({ items: [{ ...item, actualWidthMm: 91 }] }),
      now,
    );

    expect(result).toMatchObject({
      total: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
    });
    expect(result.items[0]).toMatchObject({
      complete: false,
      suggestedSubtotal: null,
    });
    expect(Number(result.knownTotal)).toBeGreaterThan(0);
  });

  it('相同服务端事实生成稳定 token，factsKey 和浏览器重量不参与', async () => {
    const first = await quoteExternalCreateOrder(input(), now);
    const second = await quoteExternalCreateOrder(
      input({
        factsKey: 'another-browser-request-key',
        logistics: {
          ...input().logistics,
          shipments: [
            {
              ...input().logistics.shipments[0]!,
              billableWeightKg: '1',
            },
          ],
        },
      }),
      now,
    );

    expect(second.quoteToken).toBe(first.quoteToken);
    expect(second.factsKey).toBe('another-browser-request-key');
  });

  it('已发布价目版本变化时生成新 token', async () => {
    const nextSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      priceVersion: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion,
        processing: {
          ...CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.processing,
          id: 'processing-v-next',
          version:
            CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.processing.version + 1,
          sourceSha256: 'f'.repeat(64),
        },
      },
    };
    mocks.readSnapshot
      .mockResolvedValueOnce(CREATE_ORDER_GOLDEN_SNAPSHOT)
      .mockResolvedValueOnce(nextSnapshot);

    const before = await quoteExternalCreateOrder(input(), now);
    const after = await quoteExternalCreateOrder(input(), now);

    expect(after.priceVersion.processing).toMatchObject({
      id: 'processing-v-next',
      version:
        CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion.processing.version + 1,
    });
    expect(after.quoteToken).not.toBe(before.quoteToken);
  });

  it('纯彩印无烫金时对外报价不携带制版费人工语义', async () => {
    mocks.productFindMany.mockResolvedValue([
      {
        id: 'product-print-large',
        code: 'PRINT-COATED-200-LARGE',
        category: 'COLOR_PRINT',
        specification: '大号封90×165',
        paperType: '200g铜版纸',
        paperMaterialId: 'paper-coated-200',
        weight: 200,
        isActive: true,
      },
    ]);
    mocks.craftFindMany.mockResolvedValue([
      { id: 'craft-print', code: 'COATED_COLOR_PRINT', isActive: true },
    ]);
    mocks.materialFindMany.mockResolvedValue([
      {
        id: 'paper-coated-200',
        name: '铜版纸',
        specification: '200g',
        outOfStock: false,
        isActive: true,
      },
    ]);
    const plainPrint = {
      ...item,
      productId: 'product-print-large',
      pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
      paperType: '200g铜版纸',
      paperWeightGsm: 200,
      quantity: 2_000,
      crafts: ['craft-print'],
      frontFoilColors: [],
      backFoilColors: [],
      foilColors: [],
      foilTechnique: OrderFoilTechnique.NONE,
      hasLocalFoil: false,
      lamination: OrderLamination.NONE,
      printColors: ['CMYK'],
    };

    const result = await quoteExternalCreateOrder(
      input({ items: [plainPrint] }),
      now,
    );

    expect(result).toMatchObject({
      plateFee: null,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
    });
    expect(result.total).toBe(result.knownTotal);
    const preview = await calculateWorkbenchItem(
      workbenchItemQuoteSchema.parse({item:plainPrint}).item,
      0,
    );
    expect(preview).toMatchObject({status:'success',quote:{baseAmount:result.items[0]!.suggestedSubtotal}});
  });

  it('彩印单色烫金命中含版费原子套餐时报价完整，不携带独立制版费', async () => {
    mocks.productFindMany.mockResolvedValue([
      {
        id: 'product-print-large',
        code: 'PRINT-COATED-200-LARGE',
        category: 'COLOR_PRINT',
        specification: '大号封90×165',
        paperType: '200g铜版纸',
        paperMaterialId: 'paper-coated-200',
        weight: 200,
        isActive: true,
      },
    ]);
    mocks.craftFindMany.mockResolvedValue([
      {
        id: 'craft-print-foil',
        code: 'COATED_COLOR_PRINT_FOIL',
        isActive: true,
      },
    ]);
    mocks.materialFindMany.mockResolvedValue([
      {
        id: 'paper-coated-200',
        name: '铜版纸',
        specification: '200g',
        outOfStock: false,
        isActive: true,
      },
    ]);
    const bundledPrint = {
      ...item,
      productId: 'product-print-large',
      pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
      paperType: '200g铜版纸',
      paperWeightGsm: 200,
      crafts: ['craft-print-foil'],
      frontFoilColors: ['哑金'],
      backFoilColors: [],
      foilColors: ['哑金'],
      foilTechnique: OrderFoilTechnique.FLAT,
      hasLocalFoil: true,
      lamination: OrderLamination.NONE,
      printColors: ['CMYK'],
    };

    const result = await quoteExternalCreateOrder(
      input({ items: [bundledPrint] }),
      now,
    );

    expect(result.items[0]).toMatchObject({
      complete: true,
      suggestedFixedFee: '700.00',
      suggestedSubtotal: '700.00',
    });
    const preview = await calculateWorkbenchItem(
      workbenchItemQuoteSchema.parse({item:bundledPrint}).item,
      0,
    );
    expect(preview).toMatchObject({status:'success',quote:{baseAmount:result.items[0]!.suggestedSubtotal}});
    expect(result.items[0]?.components.map((line) => line.ruleCode)).toEqual([
      'PRINT_PER_ORDER',
      'PRINT_FOIL_PER_ORDER',
    ]);
    expect(result).toMatchObject({
      plateFee: null,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
    });
  });
});


describe('workbench and order-entry price parity', () => {
  it.each([
    1, 499, 500, 999, 1000, 1999, 2000, 2999, 3000, 3999, 4000, 4999, 5000,
    9999, 10000, 19999, 20000, 29999, 30000, 49999, 50000,
  ])('matches the dedicated-foil item at quantity %s', async (quantity) => {
    mocks.productFindMany.mockResolvedValue([
      {
        id: 'product-custom',
        code: 'CUSTOM-LARGE',
        category: 'CUSTOM_FLAT_FOIL',
        specification: '大号封90×165',
        paperType: null,
        paperMaterialId: null,
        weight: null,
        isActive: true,
      },
    ]);
    mocks.craftFindMany.mockResolvedValue([
      { id: 'craft-single', code: 'FLAT_FOIL_SINGLE', isActive: true },
    ]);
    const facts = {
      ...item,
      productId: 'product-custom',
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      quantity,
      crafts: ['craft-single'],
      hasLocalFoil: false,
    };
    const order = await quoteExternalCreateOrder(
      input({
        items: [facts],
        packagingGroups: [],
        logistics: {
          ...input().logistics,
          shipments: [
            { ...input().logistics.shipments[0]!, itemQuantities: [quantity] },
          ],
        },
      }),
      now,
    );
    const workbench = await calculateWorkbenchItem(
      workbenchItemQuoteSchema.parse({ item: facts }).item,
      0,
    );
    expect(workbench.status).toBe('success');
    if (workbench.status === 'success') {
      expect(workbench.quote.baseAmount).toBe(
        order.items[0]!.suggestedSubtotal,
      );
      expect(workbench.quote.needsPricing).toBe(!order.items[0]!.complete);
      expect(workbench.quote.processingVersion).toBe(
        order.priceVersion.processing.version,
      );
    }
  });
});
