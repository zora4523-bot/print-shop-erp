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

vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
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
  quoteInternalCreateOrder,
  type InternalCreateOrderQuoteInput,
} from '../create-order-quote-service';

const now = new Date('2026-08-28T05:00:00.000Z');
const tx = {
  product: { findMany: mocks.productFindMany },
  craft: { findMany: mocks.craftFindMany },
  material: { findMany: mocks.materialFindMany },
};
const automaticItem = {
  productId: 'product-stock-large',
  pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
  productStructure: OrderProductStructure.STANDARD_ENVELOPE,
  artworkVersion: null,
  plateGroupId: null,
  pricingGroup: 'LARGE',
  manualQuoteReason: null,
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
};

function input(
  overrides: Partial<InternalCreateOrderQuoteInput> = {},
): InternalCreateOrderQuoteInput {
  return {
    factsKey: 'internal-facts-v1',
    settlementType: OrderSettlementType.FACTORY_DIRECT,
    items: [automaticItem],
    orderItemCount: 1,
    packagingGroups: [
      {
        groupKey: 'bag-1',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        itemUnitsPerBag: [10],
      },
    ],
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
      weight: 160,
      isActive: true,
    },
  ]);
  mocks.craftFindMany.mockResolvedValue([
    { id: 'craft-partial', code: 'FLAT_FOIL_PARTIAL', isActive: true },
  ]);
  mocks.materialFindMany.mockResolvedValue([
    {
      id: 'paper-pearl-160',
      name: '160g珠光艳闪',
      specification: null,
      outOfStock: false,
      isActive: true,
    },
  ]);
});

describe('quoteInternalCreateOrder', () => {
  it('uses the published pure engine for item and BAGGING but not external charges', async () => {
    const result = await quoteInternalCreateOrder(input(), now);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.readSnapshot).toHaveBeenCalledWith(tx, { now });
    expect(result).toMatchObject({
      factsKey: 'internal-facts-v1',
      knownTotal: '180.00',
      total: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
      plateFee: { status: 'PENDING', amount: null },
    });
    expect(result.items[0]?.snapshot).toMatchObject({
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceVersion: CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion,
    });
    expect(result.packaging.groups[0]).toMatchObject({
      complete: true,
      suggestedSubtotal: '10.00',
    });
  });

  it('allows one configuration-outside note and returns null canonical amounts', async () => {
    const result = await quoteInternalCreateOrder(
      input({
        items: [
          {
            ...automaticItem,
            productId: null,
            specification: null,
            paperType: null,
            paperWeightGsm: null,
            crafts: [],
            manualQuoteReason: '客供纸与特殊工艺',
          },
        ],
      }),
      now,
    );

    expect(result).toMatchObject({
      knownTotal: '0.00',
      total: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
    });
    expect(result.items[0]).toMatchObject({
      complete: false,
      suggestedUnitPrice: null,
      suggestedFixedFee: null,
      suggestedSubtotal: null,
    });
    expect(result.items[0]?.snapshot).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      manualReasons: [
        expect.objectContaining({ code: 'CONFIGURATION_OUTSIDE_NOTE' }),
      ],
    });
    expect(result.packaging.groups[0]).toMatchObject({
      complete: false,
      suggestedSubtotal: null,
    });
  });
});
