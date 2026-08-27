import Decimal from 'decimal.js';

export const EXTERNAL_ORDER_CHARGE_MONEY_MAX = '9999999999.99';
const MONEY_MAX = new Decimal(EXTERNAL_ORDER_CHARGE_MONEY_MAX);

export const ZTO_PRICE_SOURCE = {
  fileName: '长昆中通报价表(1).xlsx',
  sha256: 'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
  sheetName: '中通',
} as const;

export const CARTON_PRICE_SOURCE = {
  fileName: '纸箱价格表1(1).xlsx',
  sha256: '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
  sheetName: 'Sheet1',
} as const;

export type ExternalOrderChargeSource = {
  fileName: string;
  sha256: string;
  sheetName: string;
  sourceRange: string;
};

export type ExternalOrderChargeShipmentInput = {
  /**
   * A stable client-side row key during preview, or the persisted shipment id
   * after creation. It is copied into every charge line for auditability.
   */
  shipmentKey: string;
  /** Structured province selection. Free-form receiver addresses must not be passed here. */
  province: string | null;
  /**
   * Carrier-confirmed billable weight, already rounded by the carrier. The
   * workbook does not define how a raw scale weight should be rounded.
   */
  billableWeightKg: Decimal.Value | null;
  /** Sum of all style quantities allocated to this shipment. */
  itemQuantity: number;
};

export type ExternalOrderChargeInput = {
  isSfCollect: boolean;
  shipments: ExternalOrderChargeShipmentInput[];
};

export type ExternalOrderChargeLine = {
  code: string;
  ruleCode: string | null;
  categoryCode: 'SHIPPING' | 'PACKAGING';
  categoryName: string;
  shipmentKey: string;
  name: string;
  amount: string | null;
  complete: boolean;
  /** Packaging amounts are workbook-backed suggestions pending operator confirmation. */
  advisory: boolean;
  /** A zero shipping line caused by SF collect, not by a zero tariff. */
  waived: boolean;
  basis: Record<string, string | number | boolean | null>;
  source: ExternalOrderChargeSource | null;
  errors: string[];
};

export type ExternalOrderShipmentChargeQuote = {
  shipmentKey: string;
  shipping: ExternalOrderChargeLine;
  packaging: ExternalOrderChargeLine;
};

export type ExternalOrderChargeQuote = {
  complete: boolean;
  suggestedShippingTotal: string | null;
  suggestedPackagingTotal: string | null;
  suggestedTotal: string | null;
  shipments: ExternalOrderShipmentChargeQuote[];
  components: ExternalOrderChargeLine[];
  errors: string[];
  snapshot: ExternalOrderChargeSnapshot;
};

export type ExternalOrderChargeSnapshot = {
  version: 1;
  input: {
    isSfCollect: boolean;
    shipments: Array<{
      shipmentKey: string;
      province: string | null;
      billableWeightKg: string | null;
      itemQuantity: number;
    }>;
  };
  suggestedShippingTotal: string | null;
  suggestedPackagingTotal: string | null;
  suggestedTotal: string | null;
  components: ExternalOrderChargeLine[];
  complete: boolean;
  errors: string[];
};

export type ExternalOrderShippingRule = {
  kind: 'SHIPPING';
  code: string;
  provinces: readonly string[];
  firstFee: string;
  firstWeightKg: string;
  additionalUnitKg: string;
  additionalUnitFee: string;
  source: ExternalOrderChargeSource;
};

export type ExternalOrderPackagingRule = {
  kind: 'PACKAGING';
  code: string;
  minQty: number;
  maxQty: number;
  amount: string;
  advisory: false;
  source: ExternalOrderChargeSource;
};

export type ExternalOrderChargeRule =
  | ExternalOrderShippingRule
  | ExternalOrderPackagingRule;

const ZTO_TARIFF_DEFINITIONS: readonly ExternalOrderShippingRule[] = [
  {
    kind: 'SHIPPING',
    code: 'ZTO_GUANGDONG',
    provinces: ['广东'],
    firstWeightKg: '1',
    firstFee: '2.8',
    additionalUnitKg: '1',
    additionalUnitFee: '1.5',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A3:D3' },
  },
  {
    kind: 'SHIPPING',
    code: 'ZTO_STANDARD_2_8',
    provinces: ['江西', '江苏', '安徽', '湖南', '湖北', '广西', '浙江', '福建'],
    firstWeightKg: '1',
    firstFee: '2.8',
    additionalUnitKg: '1',
    additionalUnitFee: '2.8',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A4:D11' },
  },
  {
    kind: 'SHIPPING',
    code: 'ZTO_STANDARD_3_5',
    provinces: ['天津', '上海', '北京', '河南', '河北', '四川', '重庆', '贵州', '山东'],
    firstWeightKg: '1',
    firstFee: '2.8',
    additionalUnitKg: '1',
    additionalUnitFee: '3.5',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A12:D20' },
  },
  {
    kind: 'SHIPPING',
    code: 'ZTO_STANDARD_4_5',
    provinces: ['云南', '山西', '陕西', '黑龙江', '吉林', '辽宁', '海南'],
    firstWeightKg: '1',
    firstFee: '2.8',
    additionalUnitKg: '1',
    additionalUnitFee: '4.5',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A21:D27' },
  },
  {
    kind: 'SHIPPING',
    code: 'ZTO_REMOTE_FIRST_12',
    provinces: ['新疆', '西藏'],
    firstWeightKg: '1',
    firstFee: '12',
    additionalUnitKg: '0.5',
    additionalUnitFee: '5.3',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A28:D28' },
  },
  {
    kind: 'SHIPPING',
    code: 'ZTO_REMOTE_FIRST_10',
    provinces: ['甘肃', '青海', '宁夏', '内蒙古'],
    firstWeightKg: '1',
    firstFee: '10',
    additionalUnitKg: '0.5',
    additionalUnitFee: '5.3',
    source: { ...ZTO_PRICE_SOURCE, sourceRange: 'A29:D29' },
  },
] as const;

export const ZTO_PROVINCE_OPTIONS: readonly string[] =
  ZTO_TARIFF_DEFINITIONS.flatMap((definition) => [...definition.provinces]);

const PROVINCE_ALIASES = new Map<string, string>([
  ...ZTO_TARIFF_DEFINITIONS.flatMap((definition) =>
    definition.provinces.flatMap((province) => [
      [province, province] as const,
      [`${province}省`, province] as const,
    ]),
  ),
  ['北京市', '北京'],
  ['天津市', '天津'],
  ['上海市', '上海'],
  ['重庆市', '重庆'],
  ['内蒙古自治区', '内蒙古'],
  ['广西壮族自治区', '广西'],
  ['西藏自治区', '西藏'],
  ['宁夏回族自治区', '宁夏'],
  ['新疆维吾尔自治区', '新疆'],
]);

// Autonomous-region short names do not take the ordinary "省" suffix.
for (const invalidAlias of ['内蒙古省', '广西省', '西藏省', '宁夏省', '新疆省']) {
  PROVINCE_ALIASES.delete(invalidAlias);
}
// Municipalities should use either their short name or the exact “市” form.
for (const invalidAlias of ['北京省', '天津省', '上海省', '重庆省']) {
  PROVINCE_ALIASES.delete(invalidAlias);
}

const CARTON_TIERS: readonly ExternalOrderPackagingRule[] = [
  {
    kind: 'PACKAGING',
    code: 'CARTON_Q1_500',
    minQty: 1,
    maxQty: 500,
    amount: '1',
    advisory: false,
    source: { ...CARTON_PRICE_SOURCE, sourceRange: 'A2:B2' },
  },
  {
    kind: 'PACKAGING',
    code: 'CARTON_Q501_1000',
    minQty: 501,
    maxQty: 1_000,
    amount: '3',
    advisory: false,
    source: { ...CARTON_PRICE_SOURCE, sourceRange: 'A3:B3' },
  },
  {
    kind: 'PACKAGING',
    code: 'CARTON_Q1001_2000',
    minQty: 1_001,
    maxQty: 2_000,
    amount: '5',
    advisory: false,
    source: { ...CARTON_PRICE_SOURCE, sourceRange: 'A4:B4' },
  },
  {
    kind: 'PACKAGING',
    code: 'CARTON_Q2001_3000',
    minQty: 2_001,
    maxQty: 3_000,
    amount: '7',
    advisory: false,
    source: { ...CARTON_PRICE_SOURCE, sourceRange: 'A5:B5' },
  },
  {
    kind: 'PACKAGING',
    code: 'CARTON_Q3001_5000',
    minQty: 3_001,
    maxQty: 5_000,
    amount: '8',
    advisory: false,
    source: { ...CARTON_PRICE_SOURCE, sourceRange: 'A6:B6' },
  },
] as const;

export const DEFAULT_EXTERNAL_ORDER_CHARGE_RULES: readonly ExternalOrderChargeRule[] =
  [...ZTO_TARIFF_DEFINITIONS, ...CARTON_TIERS];

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function parseFiniteDecimal(value: Decimal.Value | null): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeZtoProvince(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return PROVINCE_ALIASES.get(trimmed) ?? null;
}

export function getZtoTariff(
  provinceInput: string | null,
  rules: readonly ExternalOrderChargeRule[] = DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
): {
  ruleCode: string;
  province: string;
  firstWeightKg: string;
  firstFee: string;
  additionalUnitKg: string;
  additionalUnitFee: string;
  sourceRange: string;
} | null {
  const province = normalizeZtoProvince(provinceInput);
  const matches = province
    ? rules.filter(
        (rule): rule is ExternalOrderShippingRule =>
          rule.kind === 'SHIPPING' && rule.provinces.includes(province),
      )
    : [];
  if (!province || matches.length !== 1) return null;
  const tariff = matches[0] as ExternalOrderShippingRule;
  return {
    ruleCode: tariff.code,
    province,
    firstWeightKg: new Decimal(tariff.firstWeightKg).toString(),
    firstFee: money(new Decimal(tariff.firstFee)),
    additionalUnitKg: new Decimal(tariff.additionalUnitKg).toString(),
    additionalUnitFee: money(new Decimal(tariff.additionalUnitFee)),
    sourceRange: tariff.source.sourceRange,
  };
}

function incompleteLine(
  shipmentKey: string,
  categoryCode: 'SHIPPING' | 'PACKAGING',
  categoryName: string,
  name: string,
  errors: string[],
  basis: ExternalOrderChargeLine['basis'],
  chargeSource: ExternalOrderChargeSource | null,
  advisory: boolean,
): ExternalOrderChargeLine {
  return {
    code: `${categoryCode}_${shipmentKey}`,
    ruleCode: null,
    categoryCode,
    categoryName,
    shipmentKey,
    name,
    amount: null,
    complete: false,
    advisory,
    waived: false,
    basis,
    source: chargeSource,
    errors,
  };
}

function quoteShipping(
  shipment: ExternalOrderChargeShipmentInput,
  orderTotalQuantity: number,
  isSfCollect: boolean,
  rules: readonly ExternalOrderChargeRule[],
): ExternalOrderChargeLine {
  if (isSfCollect) {
    return {
      code: `SHIPPING_${shipment.shipmentKey}`,
      ruleCode: null,
      categoryCode: 'SHIPPING',
      categoryName: '快递费',
      shipmentKey: shipment.shipmentKey,
      name: '顺丰到付（自行预约）',
      amount: '0.00',
      complete: true,
      advisory: false,
      waived: true,
      basis: {
        isSfCollect: true,
        province: shipment.province?.trim() || null,
        billableWeightKg:
          parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      },
      source: null,
      errors: [],
    };
  }

  if (orderTotalQuantity > 2_000) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      '物流运费待定',
      ['整单总数量超过 2000 个，改走物流，运费待定'],
      {
        isSfCollect: false,
        orderTotalQuantity,
        province: shipment.province?.trim() || null,
        billableWeightKg:
          parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      },
      null,
      false,
    );
  }

  const tariffView = getZtoTariff(shipment.province, rules);
  const province = normalizeZtoProvince(shipment.province);
  if (!tariffView || !province) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      '中通快递费',
      ['计费地区不在中通报价表内，请人工确认'],
      {
        isSfCollect: false,
        province: shipment.province?.trim() || null,
        billableWeightKg:
          parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      },
      null,
      false,
    );
  }

  const tariffRule = rules.find(
    (rule): rule is ExternalOrderShippingRule =>
      rule.kind === 'SHIPPING' && rule.code === tariffView.ruleCode,
  ) as ExternalOrderShippingRule;
  const firstWeightKg = new Decimal(tariffRule.firstWeightKg);
  const firstFee = new Decimal(tariffRule.firstFee);
  const additionalUnitKg = new Decimal(tariffRule.additionalUnitKg);
  const additionalUnitFee = new Decimal(tariffRule.additionalUnitFee);
  const weight = parseFiniteDecimal(shipment.billableWeightKg);
  const chargeSource = tariffRule.source;
  if (!weight || weight.lte(0)) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      `${province}中通快递费`,
      ['缺少有效的系统计费重量，请人工确认'],
      {
        isSfCollect: false,
        province,
        billableWeightKg: weight?.toString() ?? null,
        additionalUnitKg: tariffView.additionalUnitKg,
      },
      chargeSource,
      false,
    );
  }

  const additionalWeight = Decimal.max(0, weight.minus(firstWeightKg));
  const additionalUnits = additionalWeight.div(additionalUnitKg).ceil();
  const amount = firstFee.plus(
    additionalUnitFee.times(additionalUnits),
  );
  if (amount.gt(MONEY_MAX)) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      `${province}中通快递费`,
      ['快递费超过系统可保存上限，请人工确认'],
      {
        isSfCollect: false,
        province,
        billableWeightKg: weight.toString(),
        additionalUnitKg: tariffView.additionalUnitKg,
      },
      chargeSource,
      false,
    );
  }

  return {
    code: `SHIPPING_${shipment.shipmentKey}`,
    ruleCode: tariffRule.code,
    categoryCode: 'SHIPPING',
    categoryName: '快递费',
    shipmentKey: shipment.shipmentKey,
    name: `${province}中通快递费`,
    amount: money(amount),
    complete: true,
    advisory: false,
    waived: false,
    basis: {
      isSfCollect: false,
      province,
      billableWeightKg: weight.toString(),
      firstWeightKg: tariffView.firstWeightKg,
      firstFee: tariffView.firstFee,
      additionalUnitKg: tariffView.additionalUnitKg,
      additionalUnitFee: tariffView.additionalUnitFee,
      additionalUnits: additionalUnits.toNumber(),
    },
    source: chargeSource,
    errors: [],
  };
}

function quotePackaging(
  shipment: ExternalOrderChargeShipmentInput,
  orderTotalQuantity: number,
  isPrimaryShipment: boolean,
  rules: readonly ExternalOrderChargeRule[],
): ExternalOrderChargeLine {
  if (!Number.isSafeInteger(orderTotalQuantity) || orderTotalQuantity < 1) {
    return incompleteLine(
      shipment.shipmentKey,
      'PACKAGING',
      '打包耗材费',
      '纸箱费',
      ['整单总数量必须是大于 0 的安全整数'],
      { orderTotalQuantity },
      null,
      false,
    );
  }

  const tiers = rules
    .filter(
    (candidate): candidate is ExternalOrderPackagingRule =>
      candidate.kind === 'PACKAGING',
    )
    .sort((left, right) => left.maxQty - right.maxQty);
  let previousMaximum = 0;
  const hasInvalidTier =
    tiers.length === 0 ||
    tiers.some((tier) => {
      const amount = parseFiniteDecimal(tier.amount);
      const valid =
        Number.isSafeInteger(tier.minQty) &&
        Number.isSafeInteger(tier.maxQty) &&
        tier.minQty === previousMaximum + 1 &&
        tier.maxQty >= tier.minQty &&
        amount !== null &&
        !amount.isNegative() &&
        amount.lte(MONEY_MAX);
      previousMaximum = tier.maxQty;
      return !valid;
    });
  const segmentTier = tiers.at(-1) ?? null;
  if (hasInvalidTier || !segmentTier) {
    return incompleteLine(
      shipment.shipmentKey,
      'PACKAGING',
      '打包耗材费',
      '纸箱费',
      ['纸箱数量档必须从 1 开始连续覆盖且金额有效'],
      { orderTotalQuantity },
      null,
      false,
    );
  }

  const fullSegmentCount =
    orderTotalQuantity > segmentTier.maxQty
      ? Math.floor(orderTotalQuantity / segmentTier.maxQty)
      : 0;
  const remainderQuantity =
    fullSegmentCount > 0
      ? orderTotalQuantity % segmentTier.maxQty
      : orderTotalQuantity;
  const remainderTier =
    remainderQuantity === 0
      ? null
      : tiers.find((tier) => remainderQuantity <= tier.maxQty) ?? null;
  if (remainderQuantity > 0 && !remainderTier) {
    return incompleteLine(
      shipment.shipmentKey,
      'PACKAGING',
      '打包耗材费',
      '纸箱费',
      ['纸箱数量档未覆盖当前整单余量'],
      { orderTotalQuantity, remainderQuantity },
      segmentTier.source,
      false,
    );
  }

  const segmentAmount = parseFiniteDecimal(segmentTier.amount)!;
  const remainderAmount = remainderTier
    ? parseFiniteDecimal(remainderTier.amount)!
    : new Decimal(0);
  const cartonAmount = segmentAmount
    .times(fullSegmentCount)
    .plus(remainderAmount);
  if (cartonAmount.gt(MONEY_MAX)) {
    return incompleteLine(
      shipment.shipmentKey,
      'PACKAGING',
      '打包耗材费',
      '纸箱费',
      ['纸箱费超过系统可保存上限，请管理员修正价目簿'],
      {
        orderTotalQuantity,
        fullSegmentCount,
        remainderQuantity,
      },
      segmentTier.source,
      false,
    );
  }

  const appliedTier = fullSegmentCount > 0 ? segmentTier : remainderTier!;
  const amount = isPrimaryShipment ? cartonAmount : new Decimal(0);

  return {
    code: `PACKAGING_${shipment.shipmentKey}`,
    ruleCode: isPrimaryShipment ? appliedTier.code : null,
    categoryCode: 'PACKAGING',
    categoryName: '打包耗材费',
    shipmentKey: shipment.shipmentKey,
    name: isPrimaryShipment ? '纸箱费' : '纸箱费已计入主地址',
    amount: money(amount),
    complete: true,
    advisory: false,
    waived: false,
    basis: {
      orderTotalQuantity,
      fullSegmentCount,
      segmentQuantity: segmentTier.maxQty,
      remainderQuantity,
      remainderTierMaximumQuantity: remainderTier?.maxQty ?? null,
      granularity: 'PER_ORDER',
      allocatedToPrimaryShipment: isPrimaryShipment,
    },
    source: isPrimaryShipment ? appliedTier.source : null,
    errors: [],
  };
}

function sumCompleteLines(
  lines: ExternalOrderChargeLine[],
): string | null {
  if (lines.some((line) => !line.complete || line.amount === null)) return null;
  return money(
    lines.reduce(
      (total, line) => total.plus(line.amount as string),
      new Decimal(0),
    ),
  );
}

export function calculateExternalOrderCharges(
  input: ExternalOrderChargeInput,
  rules: readonly ExternalOrderChargeRule[] = DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
): ExternalOrderChargeQuote {
  if (input.shipments.length === 0) {
    const errors = ['至少需要一个发货地址才能计算快递与打包耗材费'];
    const snapshot: ExternalOrderChargeSnapshot = {
      version: 1,
      input: { isSfCollect: input.isSfCollect, shipments: [] },
      suggestedShippingTotal: null,
      suggestedPackagingTotal: null,
      suggestedTotal: null,
      components: [],
      complete: false,
      errors,
    };
    return {
      complete: false,
      suggestedShippingTotal: null,
      suggestedPackagingTotal: null,
      suggestedTotal: null,
      shipments: [],
      components: [],
      errors,
      snapshot,
    };
  }

  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  for (const shipment of input.shipments) {
    if (seenKeys.has(shipment.shipmentKey)) duplicateKeys.add(shipment.shipmentKey);
    seenKeys.add(shipment.shipmentKey);
  }
  if (
    input.shipments.some((shipment) => shipment.shipmentKey.trim() === '') ||
    duplicateKeys.size > 0
  ) {
    const errors = [
      ...(input.shipments.some((shipment) => shipment.shipmentKey.trim() === '')
        ? ['发货记录标识不能为空']
        : []),
      ...(duplicateKeys.size > 0
        ? [`发货记录标识重复：${[...duplicateKeys].join('、')}`]
        : []),
    ];
    const snapshotInput = input.shipments.map((shipment) => ({
      shipmentKey: shipment.shipmentKey,
      province: shipment.province?.trim() || null,
      billableWeightKg:
        parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      itemQuantity: shipment.itemQuantity,
    }));
    const snapshot: ExternalOrderChargeSnapshot = {
      version: 1,
      input: { isSfCollect: input.isSfCollect, shipments: snapshotInput },
      suggestedShippingTotal: null,
      suggestedPackagingTotal: null,
      suggestedTotal: null,
      components: [],
      complete: false,
      errors,
    };
    return {
      complete: false,
      suggestedShippingTotal: null,
      suggestedPackagingTotal: null,
      suggestedTotal: null,
      shipments: [],
      components: [],
      errors,
      snapshot,
    };
  }

  const orderTotalQuantity = input.shipments.reduce(
    (total, shipment) => total + shipment.itemQuantity,
    0,
  );
  const shipments = input.shipments.map((shipment, index) => ({
    shipmentKey: shipment.shipmentKey,
    shipping: quoteShipping(
      shipment,
      orderTotalQuantity,
      input.isSfCollect,
      rules,
    ),
    packaging: quotePackaging(
      shipment,
      orderTotalQuantity,
      index === 0,
      rules,
    ),
  }));
  const shippingLines = shipments.map((shipment) => shipment.shipping);
  const packagingLines = shipments.map((shipment) => shipment.packaging);
  const components = shipments.flatMap((shipment) => [
    shipment.shipping,
    shipment.packaging,
  ]);
  const suggestedShippingTotal = sumCompleteLines(shippingLines);
  const suggestedPackagingTotal = sumCompleteLines(packagingLines);
  const complete = components.every((component) => component.complete);
  const suggestedTotal = complete
    ? money(
        new Decimal(suggestedShippingTotal as string).plus(
          suggestedPackagingTotal as string,
        ),
      )
    : null;
  const errors = components.flatMap((component) =>
    component.errors.map(
      (error) => `发货记录 ${component.shipmentKey}·${component.categoryName}：${error}`,
    ),
  );

  const snapshotInput = input.shipments.map((shipment) => ({
    shipmentKey: shipment.shipmentKey,
    province: shipment.province?.trim() || null,
    billableWeightKg:
      parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
    itemQuantity: shipment.itemQuantity,
  }));
  const snapshot: ExternalOrderChargeSnapshot = {
    version: 1,
    input: { isSfCollect: input.isSfCollect, shipments: snapshotInput },
    suggestedShippingTotal,
    suggestedPackagingTotal,
    suggestedTotal,
    components,
    complete,
    errors,
  };
  return {
    complete,
    suggestedShippingTotal,
    suggestedPackagingTotal,
    suggestedTotal,
    shipments,
    components,
    errors,
    snapshot,
  };
}
