import type {
  CreateOrderPackagingGroupInput,
  CreateOrderPriceSnapshot,
  CreateOrderQuoteInput,
  CreateOrderQuoteItemInput,
} from '../../create-order';
import type { ExternalOrderChargeSource } from '../../external-order-charges';

const ZTO_SOURCE: ExternalOrderChargeSource = {
  fileName: '长昆中通报价表(1).xlsx',
  sha256: 'golden-zto-source',
  sheetName: '中通',
  sourceRange: 'A3:D29',
};

const CARTON_SOURCE: ExternalOrderChargeSource = {
  fileName: '纸箱价格表1(1).xlsx',
  sha256: 'golden-carton-source',
  sheetName: 'Sheet1',
  sourceRange: 'A2:B6',
};

const fullTiers = [
  ['FULL_500', 1, 750, '0.4800', '0.5200'],
  ['FULL_1000', 751, 1_500, '0.3100', '0.3250'],
  ['FULL_2000', 1_501, 2_500, '0.2700', '0.2850'],
  ['FULL_3000', 2_501, 3_500, '0.2500', '0.2700'],
  ['FULL_4000', 3_501, 4_500, '0.2300', '0.2450'],
  ['FULL_5000', 4_501, 7_500, '0.2000', '0.2200'],
  ['FULL_10000', 7_501, 15_000, '0.1800', '0.2000'],
  ['FULL_20000', 15_001, 25_000, '0.1700', '0.1900'],
  ['FULL_30000', 25_001, 40_000, '0.1700', '0.1900'],
  ['FULL_50000', 40_001, null, '0.1600', '0.1800'],
] as const;

const coatedLargePrintPrices = [
  [100, '130.00'],
  [200, '200.00'],
  [300, '220.00'],
  [400, '240.00'],
  [500, '260.00'],
  [1_000, '310.00'],
  [2_000, '450.00'],
  [3_000, '580.00'],
  [4_000, '700.00'],
  [5_000, '870.00'],
  [10_000, '1520.00'],
  [20_000, '2580.00'],
] as const;

const SECTION_8 = '§8' as const;

export const RULE8_PARTIAL_GOLDEN_CASES = [
  {
    caseId: 'S8-PARTIAL-001',
    section: SECTION_8,
    label: '999 个正1色',
    item: { quantity: 999, frontColors: ['哑金'], backColors: [] },
    expected: { blank: '129.87', machine: '40.00', bagging: '10.00' },
  },
  {
    caseId: 'S8-PARTIAL-002',
    section: SECTION_8,
    label: '1000 个正1色',
    item: { quantity: 1_000, frontColors: ['哑金'], backColors: [] },
    expected: { blank: '130.00', machine: '40.00', bagging: '10.00' },
  },
  {
    caseId: 'S8-PARTIAL-003',
    section: SECTION_8,
    label: '1000 个正2色',
    item: {
      quantity: 1_000,
      frontColors: ['哑金', '红金'],
      backColors: [],
    },
    expected: { blank: '130.00', machine: '80.00', bagging: '10.00' },
  },
  {
    caseId: 'S8-PARTIAL-004',
    section: SECTION_8,
    label: '1000 个正1反1',
    item: {
      quantity: 1_000,
      frontColors: ['哑金'],
      backColors: ['哑金'],
    },
    expected: { blank: '130.00', machine: '80.00', bagging: '10.00' },
  },
  {
    caseId: 'S8-PARTIAL-005',
    section: SECTION_8,
    label: '1000 个正3色',
    item: {
      quantity: 1_000,
      frontColors: ['哑金', '红金', '银'],
      backColors: [],
    },
    expected: { blank: '130.00', machine: '120.00', bagging: '10.00' },
  },
] as const;

export const RULE8_FULL_GOLDEN_CASES = [
  {
    caseId: 'S8-FULL-001',
    section: SECTION_8,
    label: '珠光160大号 5000 个单色',
    item: {},
    expected: { status: 'QUOTED', unitPrice: '0.2200', processing: '1100.00' },
  },
  {
    caseId: 'S8-FULL-002',
    section: SECTION_8,
    label: '触感200大号 5000 个单色',
    item: { paperType: '触感纸', paperWeightGsm: 200 },
    expected: { status: 'QUOTED', unitPrice: '0.3200', processing: '1600.00' },
  },
  {
    caseId: 'S8-FULL-003',
    section: SECTION_8,
    label: '珠光160大号 5000 个浮雕',
    item: { specialEffect: 'RELIEF' },
    expected: { status: 'QUOTED', unitPrice: '0.2700', processing: '1440.00' },
  },
  {
    caseId: 'S8-FULL-004',
    section: SECTION_8,
    label: '珠光160大号 5000 个三色',
    item: { frontColors: ['哑金', '红金', '银'] },
    expected: {
      status: 'MANUAL_PRICING_REQUIRED',
      manualReason: 'FULL_THREE_OR_MORE_COLORS',
    },
  },
  ...([
    ['S8-FULL-005', 1, 'FULL_500', '0.5200'],
    ['S8-FULL-006', 750, 'FULL_500', '0.5200'],
    ['S8-FULL-007', 751, 'FULL_1000', '0.3250'],
    ['S8-FULL-008', 4_500, 'FULL_4000', '0.2450'],
    ['S8-FULL-009', 4_501, 'FULL_5000', '0.2200'],
    ['S8-FULL-010', 7_500, 'FULL_5000', '0.2200'],
    ['S8-FULL-011', 7_501, 'FULL_10000', '0.2000'],
    ['S8-FULL-012', 25_000, 'FULL_20000', '0.1900'],
    ['S8-FULL-013', 25_001, 'FULL_30000', '0.1900'],
    ['S8-FULL-014', 40_000, 'FULL_30000', '0.1900'],
    ['S8-FULL-015', 40_001, 'FULL_50000', '0.1800'],
  ] as const).map(([caseId, quantity, tierCode, unitPrice]) => ({
    caseId,
    section: SECTION_8,
    label: `专版大号 ${quantity} 个边界`,
    item: { quantity },
    expected: { status: 'QUOTED' as const, tierCode, unitPrice },
  })),
] as const;

export const RULE8_PRINT_GOLDEN_CASES = [
  {
    caseId: 'S8-PRINT-001',
    section: SECTION_8,
    label: '铜版200大号 1000 个',
    item: { quantity: 1_000 },
    expected: { status: 'QUOTED', tierQuantity: 1_000, processing: '310.00' },
  },
  {
    caseId: 'S8-PRINT-002',
    section: SECTION_8,
    label: '铜版200大号 6000 个',
    item: { quantity: 6_000 },
    expected: { status: 'QUOTED', tierQuantity: 5_000, processing: '870.00' },
  },
  {
    caseId: 'S8-PRINT-003',
    section: SECTION_8,
    label: '冰白160中号 2000 个空格',
    item: {
      paperType: '冰白纸',
      paperWeightGsm: 160,
      specification: '中号封',
      quantity: 2_000,
    },
    expected: {
      status: 'MANUAL_PRICING_REQUIRED',
      manualReason: 'PRINT_PRICE_NOT_FOUND',
    },
  },
] as const;

export const RULE8_CARTON_GOLDEN_CASES = ([
  [500, '1.00'],
  [1_000, '3.00'],
  [2_000, '5.00'],
  [3_000, '7.00'],
  [5_000, '8.00'],
  [5_001, '9.00'],
  [6_000, '11.00'],
  [8_000, '15.00'],
  [10_000, '16.00'],
  [12_000, '21.00'],
  [20_000, '32.00'],
] as const).map(([quantity, amount], index) => ({
  caseId: `S8-CARTON-${String(index + 1).padStart(3, '0')}`,
  section: SECTION_8,
  label: `整单 ${quantity} 个纸箱`,
  quantity,
  amount,
}));

export const RULE8_SHIPPING_GOLDEN_CASES = [
  ...([
    ['广东', '19.30'],
    ['上海', '41.30'],
    ['云南', '52.30'],
    ['甘肃', '126.60'],
    ['新疆', '128.60'],
  ] as const).map(([province, amount], index) => ({
    caseId: `S8-SHIPPING-${String(index + 1).padStart(3, '0')}`,
    section: SECTION_8,
    label: `2000 个 160g 发${province}`,
    kind: 'REGION' as const,
    province,
    amount,
  })),
  {
    caseId: 'S8-SHIPPING-006',
    section: SECTION_8,
    label: '2000 个 180g 向上进位',
    kind: 'WEIGHT_180' as const,
    province: '上海',
    amount: '48.30',
  },
  {
    caseId: 'S8-SHIPPING-007',
    section: SECTION_8,
    label: '2001 个走物流待定',
    kind: 'FREIGHT_PENDING' as const,
    province: '上海',
    amount: null,
  },
  {
    caseId: 'S8-SHIPPING-008',
    section: SECTION_8,
    label: '顺丰到付快递 0 元',
    kind: 'SF_COLLECT' as const,
    province: '上海',
    amount: '0.00',
  },
] as const;

export const RULE8_GOLDEN_CASE_COUNT =
  RULE8_PARTIAL_GOLDEN_CASES.length +
  RULE8_FULL_GOLDEN_CASES.length +
  RULE8_PRINT_GOLDEN_CASES.length +
  RULE8_CARTON_GOLDEN_CASES.length +
  RULE8_SHIPPING_GOLDEN_CASES.length;

export const CREATE_ORDER_GOLDEN_SNAPSHOT = {
  priceVersion: {
    processing: {
      id: 'processing-book-golden-v1',
      code: 'EXTERNAL_PROCESSING',
      version: 1,
      sourceSha256:
        '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
    },
    logistics: {
      id: 'logistics-book-golden-v1',
      code: 'EXTERNAL_LOGISTICS',
      version: 1,
      sourceSha256:
        '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
    },
  },
  partial: {
    blankUnitPrices: [
      {
        paperType: '珠光艳闪',
        paperWeightGsm: 160,
        specification: '大号封',
        unitPrice: '0.1300',
      },
      {
        paperType: '红卡',
        paperWeightGsm: 180,
        specification: '大号封',
        unitPrice: '0.1500',
      },
    ],
    machineFee: {
      perPassBelowQuantity: 1_000,
      fixedFeePerPass: '40.00',
      perPiecePerPass: '0.0400',
    },
  },
  full: {
    unitPrices: fullTiers.flatMap(
      ([tierCode, minQuantity, maxQuantity, midPrice, largePrice]) => [
        {
          tierCode,
          pricingGroup: 'MID' as const,
          minQuantity,
          maxQuantity,
          unitPrice: midPrice,
        },
        {
          tierCode,
          pricingGroup: 'LARGE' as const,
          minQuantity,
          maxQuantity,
          unitPrice: largePrice,
        },
      ],
    ),
    basePapers: [
      { paperType: '珠光艳闪', paperWeightGsm: 160 },
      { paperType: '红卡', paperWeightGsm: 160 },
    ],
    paperSurcharges: [
      {
        paperType: '杂色珠光',
        paperWeightGsm: 160,
        unitSurcharge: '0.0300',
      },
      {
        paperType: '莱尼纹',
        paperWeightGsm: 150,
        unitSurcharge: '0.0350',
      },
      {
        paperType: '红卡',
        paperWeightGsm: 180,
        unitSurcharge: '0.0250',
      },
      {
        paperType: '红卡',
        paperWeightGsm: 230,
        unitSurcharge: '0.0400',
      },
      {
        paperType: '金葱',
        paperWeightGsm: 230,
        unitSurcharge: '0.1000',
      },
      {
        paperType: '触感纸',
        paperWeightGsm: 200,
        unitSurcharge: '0.1000',
      },
    ],
    secondColorUnitSurcharge: '0.0900',
    westEnvelopeUnitSurcharge: '0.0600',
    specialEffects: [
      {
        effect: 'RELIEF',
        unitSurcharge: '0.0500',
        setupFee: '90.00',
      },
      {
        effect: 'RAISED',
        unitSurcharge: '0.0500',
        setupFee: '90.00',
      },
    ],
  },
  print: {
    perOrderPrices: [
      ...coatedLargePrintPrices.map(([tierQuantity, amount]) => ({
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        tierQuantity,
        amount,
      })),
      {
        paperType: '冰白纸',
        paperWeightGsm: 160,
        specification: '中号封',
        tierQuantity: 1_000,
        amount: '320.00',
      },
      {
        paperType: '冰白纸',
        paperWeightGsm: 160,
        specification: '中号封',
        tierQuantity: 2_000,
        amount: null,
      },
    ],
    foilPerOrderPrices: [
      ...([
        [1_000, '200.00'],
        [2_000, '250.00'],
        [3_000, '350.00'],
        [4_000, '480.00'],
        [5_000, '580.00'],
        [10_000, '700.00'],
        [20_000, '1200.00'],
      ] as const).flatMap(([tierQuantity, amount]) => [
        {
          mode: 'PARTIAL' as const,
          foilPassCount: 1,
          tierQuantity,
          amount,
        },
        {
          mode: 'FULL' as const,
          foilPassCount: 1,
          tierQuantity,
          amount,
        },
      ]),
    ],
  },
  bagging: {
    standardPerBag: '0.1000',
    mixedPerBag: '0.2000',
  },
  plate: {
    label: '制烫金版费',
  },
  orderCharges: {
    logisticsPolicy: {
      ruleVersion: 'golden-logistics-v1',
      billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
      weightResolutionOrder: [
        'ACTUAL_FULFILLMENT_WEIGHT',
        'SERVER_ESTIMATE',
      ],
      maxOrderQuantity: 2_000,
      billableWeightRounding: 'CEIL_KG',
      minimumBillableWeightKg: '1',
      gramsPerItemByPaperWeightGsm: {
        120: '4.5',
        150: '6',
        160: '6',
        180: '6.75',
        200: '8',
        230: '10',
      },
      tenThousandEnvelopeGramsPerItem: '10',
    },
    rules: [
      {
        kind: 'SHIPPING',
        code: 'ZTO_GUANGDONG',
        provinces: ['广东'],
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '1.5',
        source: ZTO_SOURCE,
      },
      {
        kind: 'SHIPPING',
        code: 'ZTO_STANDARD_2_8',
        provinces: ['江西', '江苏', '安徽', '湖南', '湖北', '广西', '浙江', '福建'],
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '2.8',
        source: ZTO_SOURCE,
      },
      {
        kind: 'SHIPPING',
        code: 'ZTO_STANDARD_3_5',
        provinces: ['天津', '上海', '北京', '河南', '河北', '四川', '重庆', '贵州', '山东'],
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '3.5',
        source: ZTO_SOURCE,
      },
      {
        kind: 'SHIPPING',
        code: 'ZTO_STANDARD_4_5',
        provinces: ['云南', '山西', '陕西', '黑龙江', '吉林', '辽宁', '海南'],
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '4.5',
        source: ZTO_SOURCE,
      },
      {
        kind: 'SHIPPING',
        code: 'ZTO_REMOTE_FIRST_10',
        provinces: ['甘肃', '青海', '宁夏', '内蒙古'],
        firstWeightKg: '1',
        firstFee: '10',
        additionalUnitKg: '0.5',
        additionalUnitFee: '5.3',
        source: ZTO_SOURCE,
      },
      {
        kind: 'SHIPPING',
        code: 'ZTO_REMOTE_FIRST_12',
        provinces: ['新疆', '西藏'],
        firstWeightKg: '1',
        firstFee: '12',
        additionalUnitKg: '0.5',
        additionalUnitFee: '5.3',
        source: ZTO_SOURCE,
      },
      {
        kind: 'PACKAGING',
        code: 'CARTON_1_500',
        minQty: 1,
        maxQty: 500,
        amount: '1',
        advisory: false,
        source: CARTON_SOURCE,
      },
      {
        kind: 'PACKAGING',
        code: 'CARTON_501_1000',
        minQty: 501,
        maxQty: 1_000,
        amount: '3',
        advisory: false,
        source: CARTON_SOURCE,
      },
      {
        kind: 'PACKAGING',
        code: 'CARTON_1001_2000',
        minQty: 1_001,
        maxQty: 2_000,
        amount: '5',
        advisory: false,
        source: CARTON_SOURCE,
      },
      {
        kind: 'PACKAGING',
        code: 'CARTON_2001_3000',
        minQty: 2_001,
        maxQty: 3_000,
        amount: '7',
        advisory: false,
        source: CARTON_SOURCE,
      },
      {
        kind: 'PACKAGING',
        code: 'CARTON_3001_5000',
        minQty: 3_001,
        maxQty: 5_000,
        amount: '8',
        advisory: false,
        source: CARTON_SOURCE,
      },
    ],
  },
} as const satisfies CreateOrderPriceSnapshot;

export function createGoldenOrderItem(
  overrides: Partial<CreateOrderQuoteItemInput> = {},
): CreateOrderQuoteItemInput {
  return {
    itemKey: 'style-1',
    fig: 1,
    craft: 'PARTIAL',
    paperType: '珠光艳闪',
    paperWeightGsm: 160,
    specification: '大号封',
    pricingGroup: 'LARGE',
    productStructure: 'STANDARD_ENVELOPE',
    quantity: 1_000,
    frontColors: ['哑金'],
    backColors: [],
    configuration: {
      paper: 'CATALOG',
      paperWeight: 'CATALOG',
      specification: 'CATALOG',
      craft: 'CATALOG',
    },
    specialEffect: 'NONE',
    printFoilMode: 'NONE',
    ...overrides,
  };
}

export function createGoldenOrderInput(
  items: readonly CreateOrderQuoteItemInput[],
  options: {
    province?: string | null;
    isSfCollect?: boolean;
    trustedBillableWeightKg?: string | null;
    unitsPerBag?: number | null;
    packagingGroups?: readonly CreateOrderPackagingGroupInput[];
  } = {},
): CreateOrderQuoteInput {
  return {
    items,
    packagingGroups:
      options.packagingGroups ??
      items.map((item) => ({
        groupKey: `bag-${item.itemKey}`,
        mode: 'SINGLE_STYLE' as const,
        items: [
          {
            itemKey: item.itemKey,
            unitsPerBag:
              options.unitsPerBag === undefined ? 10 : options.unitsPerBag,
          },
        ],
      })),
    isSfCollect: options.isSfCollect ?? false,
    shipments: [
      {
        shipmentKey: 'primary',
        province: options.province ?? '上海',
        trustedBillableWeightKg:
          options.trustedBillableWeightKg ?? null,
        itemQuantities: Object.fromEntries(
          items.map((item) => [item.itemKey, item.quantity]),
        ),
      },
    ],
  };
}
