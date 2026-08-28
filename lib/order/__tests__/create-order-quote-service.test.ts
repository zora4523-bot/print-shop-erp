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
});
