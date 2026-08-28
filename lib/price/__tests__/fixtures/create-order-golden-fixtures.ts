import type {
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
  [1, 750, '0.4800', '0.5200'],
  [751, 1_500, '0.3100', '0.3250'],
  [1_501, 2_500, '0.2700', '0.2850'],
  [2_501, 3_500, '0.2500', '0.2700'],
  [3_501, 4_500, '0.2300', '0.2450'],
  [4_501, 7_500, '0.2000', '0.2200'],
  [7_501, 15_000, '0.1800', '0.2000'],
  [15_001, 40_000, '0.1700', '0.1900'],
  [40_001, null, '0.1600', '0.1800'],
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

export const CREATE_ORDER_GOLDEN_SNAPSHOT = {
  priceVersion: 'create-order-golden-v1',
  partial: {
    blankUnitPrices: [
      {
        paperType: '珠光艳闪',
        paperWeightGsm: 160,
        specification: '大号封',
        unitPrice: '0.1300',
      },
      {
        paperType: '珠光艳闪',
        paperWeightGsm: 180,
        specification: '大号封',
        unitPrice: '0.1300',
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
      ([minQuantity, maxQuantity, midPrice, largePrice]) => [
        {
          pricingGroup: 'MID' as const,
          minQuantity,
          maxQuantity,
          unitPrice: midPrice,
        },
        {
          pricingGroup: 'LARGE' as const,
          minQuantity,
          maxQuantity,
          unitPrice: largePrice,
        },
      ],
    ),
    paperSurcharges: [
      {
        paperType: '触感纸',
        paperWeightGsm: 200,
        unitSurcharge: '0.1000',
      },
    ],
    secondColorUnitSurcharge: '0.0900',
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
    foilPerOrderPrices: [],
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
    packRaw: '10个装',
    pack: 10,
    packagingMode: 'STANDARD',
    paperWeightSource: 'CATALOG',
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
  } = {},
): CreateOrderQuoteInput {
  return {
    items,
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
