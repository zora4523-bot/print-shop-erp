import { describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../../../generated/prisma/enums';
import { calculateCreateOrderQuote } from '../../price/create-order';
import {
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { ZTO_PROVINCE_OPTIONS } from '../../price/external-order-charges';

vi.mock('../../db', () => ({ db: {} }));

import {
  projectPublishedCreateOrderPriceSnapshot,
  type PublishedCreateOrderPriceProjectionInput,
  type PublishedCreateOrderRuleRow,
} from '../create-order-published-rule-adapter';

const PROCESSING_BOOK_ID = 'book-processing-unit';
const LOGISTICS_BOOK_ID = 'book-logistics-unit';
const SOURCE_SHA = 'a'.repeat(64);
const MAX_PERSISTED_QUANTITY = 9_999_999;

function rule(
  overrides: Partial<PublishedCreateOrderRuleRow> & { code: string },
): PublishedCreateOrderRuleRow {
  return {
    id: `rule-${overrides.code}`,
    priceBookId: PROCESSING_BOOK_ID,
    name: overrides.code,
    kind: CustomerPriceRuleKind.ADD_ON,
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    amount: null,
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: null,
    maxQty: null,
    triggerCondition: { schemaVersion: 1, target: 'ITEM' },
    exclusiveGroup: null,
    priority: 100,
    sourceSheet: null,
    sourceRange: null,
    sourceName: null,
    sourceSha256: null,
    blocksAutomaticQuote: false,
    isActive: true,
    category: { code: 'BASE_PROCESSING', name: '加工费' },
    ...overrides,
  };
}

function blockingReference(
  code: string,
  triggerCondition: Record<string, unknown>,
  quantity: { minQty: number | null; maxQty: number | null } = {
    minQty: null,
    maxQty: null,
  },
): PublishedCreateOrderRuleRow {
  return rule({
    code,
    kind: CustomerPriceRuleKind.REFERENCE,
    calculationType: null,
    blocksAutomaticQuote: true,
    priority: 500,
    category: { code: 'REFERENCE', name: '参考' },
    triggerCondition: { schemaVersion: 1, target: 'ITEM', ...triggerCondition },
    ...quantity,
  });
}

const FULL_SPECIFICATIONS = [
  ['中号封', '0.2000'],
  ['方形封', '0.2000'],
  ['大号封', '0.2200'],
  ['西封中号', '0.2000'],
  ['西封大号', '0.2200'],
] as const;

function printBase(args: {
  code: string;
  tier: number;
  amount: string;
  paperType: string;
  specification: string;
  laminations: readonly string[];
}): PublishedCreateOrderRuleRow {
  return rule({
    code: `${args.code}_Q${args.tier}`,
    kind: CustomerPriceRuleKind.BASE,
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    amount: args.amount,
    minQty: args.tier,
    maxQty: args.tier,
    exclusiveGroup: 'COLOR_BASE',
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      pricingRoutes: ['COLOR_PRINT'],
      productStructures: ['STANDARD_ENVELOPE'],
      specifications: [args.specification],
      paperTypes: [args.paperType],
      foilTechniques: ['NONE', 'FLAT'],
      laminations: args.laminations,
    },
  });
}

/** One complete processing + logistics rule set shaped like the published v3 books. */
function publishedRules(): PublishedCreateOrderRuleRow[] {
  const partial = [
    rule({
      code: 'STOCK_LOCAL_FOIL_LT_1000_PER_PASS',
      amount: '40',
      minQty: 1,
      maxQty: 999,
      exclusiveGroup: 'STOCK_LOCAL_FOIL_MACHINE',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['STOCK_BLANK'],
        perFoilPass: true,
      },
    }),
    rule({
      code: 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS',
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      amount: '0.04',
      minQty: 1_000,
      maxQty: MAX_PERSISTED_QUANTITY,
      exclusiveGroup: 'STOCK_LOCAL_FOIL_MACHINE',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['STOCK_BLANK'],
        perFoilPass: true,
      },
    }),
  ];
  const fullTiers = FULL_SPECIFICATIONS.map(([specification, amount], index) =>
    rule({
      code: `BASE_CUSTOM-${index}_GTE_1`,
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      amount,
      minQty: 1,
      maxQty: MAX_PERSISTED_QUANTITY,
      exclusiveGroup: 'CUSTOM_BASE',
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
        specifications: [specification],
        paperTypes: ['160g珠光艳闪', '160g红卡'],
      },
    }),
  );
  const fullAddOn = (
    code: string,
    calculationType: CustomerPriceCalculationType,
    amount: string,
    condition: Record<string, unknown>,
  ) =>
    rule({
      code,
      calculationType,
      amount,
      triggerCondition: {
        schemaVersion: 1,
        target: 'ITEM',
        pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
        ...condition,
      },
    });
  const full = [
    ...fullTiers,
    fullAddOn('CUSTOM_DOUBLE_COLOR', CustomerPriceCalculationType.PER_PIECE, '0.09', {
      foilColorCount: 2,
    }),
    fullAddOn('CUSTOM_WESTERN_ENVELOPE', CustomerPriceCalculationType.PER_PIECE, '0.06', {
      productStructures: ['WESTERN_ENVELOPE'],
    }),
    fullAddOn('CUSTOM_RELIEF_OR_RAISED_PIECE', CustomerPriceCalculationType.PER_PIECE, '0.05', {
      foilTechniques: ['RELIEF', 'RAISED'],
    }),
    fullAddOn('CUSTOM_RELIEF_OR_RAISED_SETUP', CustomerPriceCalculationType.FIXED_AMOUNT, '90', {
      foilTechniques: ['RELIEF', 'RAISED'],
    }),
  ];
  const coated = {
    code: 'BASE_COLOR-COATED-200-LARGE',
    paperType: '200g铜版纸',
    specification: '大号88×165',
    laminations: ['MATTE'],
  };
  const iceWhite = {
    code: 'BASE_COLOR-ICE-WHITE-160-MID',
    paperType: '160g冰白纸',
    specification: '中号80×120',
    laminations: ['NONE'],
  };
  const print = [
    printBase({ ...coated, tier: 500, amount: '260' }),
    printBase({ ...coated, tier: 1_000, amount: '310' }),
    printBase({ ...coated, tier: 2_000, amount: '450' }),
    printBase({ ...iceWhite, tier: 500, amount: '290' }),
    printBase({ ...iceWhite, tier: 1_000, amount: '320' }),
    ...([
      [1_000, '200'],
      [2_000, '250'],
    ] as const).map(([tier, amount]) =>
      rule({
        code: `COLOR_SINGLE_FRONT_FOIL_Q${tier}`,
        amount,
        minQty: tier,
        maxQty: tier,
        exclusiveGroup: 'COLOR_SINGLE_FRONT_FOIL',
        triggerCondition: {
          schemaVersion: 1,
          target: 'ITEM',
          pricingRoutes: ['COLOR_PRINT'],
          foilTechniques: ['FLAT'],
          foilPassCount: 1,
        },
      }),
    ),
  ];
  const bagging = ([
    ['PACKAGING_SINGLE_STYLE_PER_BAG', 'SINGLE_STYLE', '0.1'],
    ['PACKAGING_MIXED_STYLE_PER_BAG', 'MIXED_STYLE', '0.2'],
  ] as const).map(([code, mode, amount]) =>
    rule({
      code,
      calculationType: CustomerPriceCalculationType.PER_BAG,
      amount,
      exclusiveGroup: 'PACKAGING_GROUP_MODE',
      triggerCondition: {
        schemaVersion: 1,
        target: 'PACKAGING_GROUP',
        packagingModes: [mode],
      },
    }),
  );
  const blocking = [
    blockingReference('COLOR_BACK_SIDE_FOIL_MANUAL', {
      pricingRoutes: ['COLOR_PRINT'],
      isDoubleSided: true,
    }),
    blockingReference('COLOR_MULTI_FOIL_MANUAL', {
      pricingRoutes: ['COLOR_PRINT'],
      minFoilPassCount: 2,
    }),
    blockingReference('COLOR_NON_FLAT_FOIL_MANUAL', {
      pricingRoutes: ['COLOR_PRINT'],
      foilTechniques: ['RELIEF', 'RAISED'],
    }),
    blockingReference('COLOR_NONSTANDARD_LAMINATION_MANUAL', {
      pricingRoutes: ['COLOR_PRINT'],
      laminations: ['SOFT_TOUCH', 'NEW_GLOSS', 'LASER'],
    }),
    blockingReference('COLOR_NONSTANDARD_PROCESS_MANUAL', {
      pricingRoutes: ['COLOR_PRINT'],
      anyCraftCodeOutside: [
        'COATED_COLOR_PRINT',
        'COATED_COLOR_PRINT_FOIL',
        'COLOR_PRINT',
        'COLOR_PRINT_FOIL',
        'DIE_CUT',
        'GLUING',
        'PACKING',
      ],
    }),
    blockingReference(
      'COLOR_SINGLE_FRONT_FOIL_LT_1000_MANUAL',
      {
        pricingRoutes: ['COLOR_PRINT'],
        foilTechniques: ['FLAT'],
        foilPassCount: 1,
      },
      { minQty: 1, maxQty: 999 },
    ),
    blockingReference('CUSTOM_DOUBLE_SIDED_MANUAL', {
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
      isDoubleSided: true,
    }),
    blockingReference('CUSTOM_TEN_THOUSAND_MANUAL', {
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
      productStructures: ['TEN_THOUSAND_ENVELOPE'],
    }),
    blockingReference('CUSTOM_THREE_PLUS_COLORS_MANUAL', {
      pricingRoutes: ['CUSTOM_SINGLE_FLAT_FOIL'],
      minFoilColorCount: 3,
    }),
  ];
  const source = {
    sourceName: '物流价目.xlsx',
    sourceSheet: 'Sheet1',
    sourceRange: 'A1:B2',
    sourceSha256: SOURCE_SHA,
  };
  const logistics = [
    rule({
      code: 'ZTO_ALL',
      priceBookId: LOGISTICS_BOOK_ID,
      amount: '2.8',
      includedUnits: '1',
      incrementUnits: '1',
      incrementAmount: '3.5',
      exclusiveGroup: 'ZTO_PROVINCE_RATE',
      triggerCondition: { carrierCode: 'ZTO', provinces: [...ZTO_PROVINCE_OPTIONS] },
      category: { code: 'SHIPPING_FEE', name: '快递费' },
      ...source,
    }),
    rule({
      code: 'CARTON_1_5000',
      priceBookId: LOGISTICS_BOOK_ID,
      amount: '8',
      minQty: 1,
      maxQty: 5_000,
      exclusiveGroup: 'CARTON_ORDER_QUANTITY_TIER',
      triggerCondition: {
        scope: 'ORDER_TOTAL_QUANTITY',
        segmentedAboveMaximum: true,
      },
      category: { code: 'PACKING_MATERIAL', name: '纸箱' },
      ...source,
    }),
  ];
  return [
    ...partial,
    ...full,
    ...print,
    ...bagging,
    ...blocking,
    ...logistics,
  ];
}

function projectionInput(
  rules: readonly PublishedCreateOrderRuleRow[] = publishedRules(),
): PublishedCreateOrderPriceProjectionInput {
  return {
    priceVersion: {
      processing: {
        purpose: CustomerPriceBookPurpose.PROCESSING,
        id: PROCESSING_BOOK_ID,
        code: 'EXTERNAL_SALES_PROCESSING_RULES',
        name: '外部销售加工费',
        version: 9,
        sourceSha256: SOURCE_SHA,
      },
      logistics: {
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        id: LOGISTICS_BOOK_ID,
        code: 'EXTERNAL_SALES_LOGISTICS_RULES',
        name: '外部销售物流',
        version: 9,
        sourceSha256: SOURCE_SHA,
      },
    },
    processingNotes: { constants: { customPaperBaselineGsm: 160 } },
    logisticsNotes: {
      ruleVersion: 'unit-logistics',
      shipping: {
        billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
        weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT', 'SERVER_ESTIMATE'],
        billableWeightRounding: 'CEIL_KG',
        maxOrderQuantity: 5_000,
        gramsPerItemByPaperWeightGsm: { 160: 6, 200: 8 },
        minimumBillableWeightKg: 1,
        tenThousandEnvelopeGramsPerItem: 10,
      },
    },
    rules,
  };
}

function printItem(
  overrides: Parameters<typeof createGoldenOrderItem>[0] = {},
) {
  return createGoldenOrderItem({
    craft: 'PRINT',
    paperType: '铜版纸',
    paperWeightGsm: 200,
    specification: '大号封',
    pricingGroup: 'LARGE',
    quantity: 1_000,
    frontColors: [],
    backColors: [],
    printFoilMode: 'NONE',
    ...overrides,
  });
}

describe('projectPublishedCreateOrderPriceSnapshot · 彩印覆膜条件', () => {
  it('把已发布彩印阶梯价的覆膜条件带入报价快照', () => {
    const { snapshot } = projectPublishedCreateOrderPriceSnapshot(
      projectionInput(),
    );

    expect(snapshot.print.perOrderPrices).toContainEqual({
      paperType: '铜版纸',
      paperWeightGsm: 200,
      specification: '大号封',
      tierQuantity: 1_000,
      amount: '310',
      laminations: ['MATTE'],
    });
    expect(snapshot.print.perOrderPrices).toContainEqual({
      paperType: '冰白纸',
      paperWeightGsm: 160,
      specification: '中号封',
      tierQuantity: 1_000,
      amount: '320',
      laminations: ['NONE'],
    });
  });

  it('冰白纸只按不覆膜定价，提交亚膜时按已发布条件转人工核价', () => {
    const { snapshot } = projectPublishedCreateOrderPriceSnapshot(
      projectionInput(),
    );
    const iceWhite = {
      paperType: '冰白纸',
      paperWeightGsm: 160,
      specification: '中号封',
      pricingGroup: 'MID',
    } as const;
    const quote = (overrides: Parameters<typeof printItem>[0]) =>
      calculateCreateOrderQuote(
        createGoldenOrderInput([printItem(overrides)]),
        snapshot,
      );

    expect(quote(iceWhite).items[0]).toMatchObject({
      status: 'QUOTED',
      amount: '320.00',
    });
    const matte = quote({ ...iceWhite, printFinishing: 'MATTE' });
    expect(matte.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
    });
    expect(matte.manualReasons.map((reason) => reason.code)).toEqual([
      'PRINT_FINISHING_PRICE_NOT_FOUND',
    ]);
    expect(quote({ printFinishing: 'MATTE' }).items[0]).toMatchObject({
      status: 'QUOTED',
      amount: '310.00',
    });
  });
});
