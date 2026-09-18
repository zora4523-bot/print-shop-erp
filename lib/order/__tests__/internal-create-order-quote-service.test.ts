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

it.each([null, '管理员核价'])('拒绝 120g 款式且不进入事务（manualQuoteReason=%s）', async (manualQuoteReason) => {
  await expect(quoteInternalCreateOrder(input({
    items: [{ ...automaticItem, paperType: '120g珠光艳闪', paperWeightGsm: 120, manualQuoteReason }],
  }), now)).rejects.toThrow('120g 纸张已停用');
  expect(mocks.transaction).not.toHaveBeenCalled();
});

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
      total: '180.00',
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
      plateFee: null,
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

  it('纯彩印无烫金时返回完整总价且不展示制版待核价', async () => {
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

    const result = await quoteInternalCreateOrder(
      input({
        items: [
          {
            ...automaticItem,
            productId: 'product-print-large',
            pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
            paperType: '200g铜版纸',
            paperWeightGsm: 200,
            crafts: ['craft-print'],
            frontFoilColors: [],
            backFoilColors: [],
            foilColors: [],
            foilTechnique: OrderFoilTechnique.NONE,
            hasLocalFoil: false,
            lamination: OrderLamination.NONE,
            printColors: ['CMYK'],
          },
        ],
      }),
      now,
    );

    expect(result.items[0]?.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({ complete: true });
    expect(result.packaging).toMatchObject({ requiresAdminConfirmation: false });
    expect(result).toMatchObject({
      knownTotal: '320.00',
      total: '320.00',
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
      plateFee: null,
    });
  });
});
