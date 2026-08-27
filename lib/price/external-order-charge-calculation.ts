import Decimal from 'decimal.js';

export type ExternalOrderProductStructure =
  | 'STANDARD_ENVELOPE'
  | 'WESTERN_ENVELOPE'
  | 'TEN_THOUSAND_ENVELOPE'
  | 'UNSPECIFIED';

export type ExternalOrderChargeItemInput = {
  /** Stable key or human-readable label used only in calculation details. */
  key?: string;
  quantity: number;
  paperWeightGsm: number | null;
  productStructure: ExternalOrderProductStructure;
};

export type ExternalOrderChargeCalculationInput = {
  items: readonly ExternalOrderChargeItemInput[];
  destinationProvince: string | null;
  isSfCollect: boolean;
};

export type CartonChargeTierConfig = {
  maximumQuantity: number;
  amount: Decimal.Value;
};

export type ExternalOrderZtoBand = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type ZtoBandRateConfig = {
  firstWeightKg: Decimal.Value;
  firstFee: Decimal.Value;
  additionalUnitKg: Decimal.Value;
  additionalUnitFee: Decimal.Value;
};

/**
 * Calculation structure stays in code. Every business number is supplied by
 * this object so an adapter can load a versioned price configuration without
 * coupling the calculator to React or persistence.
 */
export type ExternalOrderChargeCalculationConfig = {
  cartonTiers: readonly CartonChargeTierConfig[];
  weight: {
    gramsPerKilogram: Decimal.Value;
    minimumBillableWeightKg: Decimal.Value;
    tenThousandEnvelopeGramsPerItem: Decimal.Value;
    gramsPerItemByPaperWeightGsm: Readonly<Record<string, Decimal.Value>>;
  };
  zto: {
    maximumQuotedQuantity: number;
    ratesByBand: Readonly<Record<ExternalOrderZtoBand, ZtoBandRateConfig>>;
  };
};

export const DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG = {
  cartonTiers: [
    { maximumQuantity: 500, amount: '1' },
    { maximumQuantity: 1_000, amount: '3' },
    { maximumQuantity: 2_000, amount: '5' },
    { maximumQuantity: 3_000, amount: '7' },
    { maximumQuantity: 5_000, amount: '8' },
  ],
  weight: {
    gramsPerKilogram: '1000',
    minimumBillableWeightKg: '1',
    tenThousandEnvelopeGramsPerItem: '10',
    gramsPerItemByPaperWeightGsm: {
      120: '4.5',
      150: '6',
      160: '6',
      180: '6.75',
      200: '8',
      230: '10',
    },
  },
  zto: {
    maximumQuotedQuantity: 2_000,
    ratesByBand: {
      A: {
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '1.5',
      },
      B: {
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '2.8',
      },
      C: {
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '3.5',
      },
      D: {
        firstWeightKg: '1',
        firstFee: '2.8',
        additionalUnitKg: '1',
        additionalUnitFee: '4.5',
      },
      E: {
        firstWeightKg: '1',
        firstFee: '10',
        additionalUnitKg: '0.5',
        additionalUnitFee: '5.3',
      },
      F: {
        firstWeightKg: '1',
        firstFee: '12',
        additionalUnitKg: '0.5',
        additionalUnitFee: '5.3',
      },
    },
  },
} as const satisfies ExternalOrderChargeCalculationConfig;

export type ExternalOrderQuantityCalculation =
  | {
      status: 'CALCULATED';
      totalQuantity: number;
    }
  | {
      status: 'MANUAL_REQUIRED';
      totalQuantity: null;
      reasonCode: 'INVALID_QUANTITY';
      reason: string;
    };

export type CartonChargeCalculation =
  | {
      status: 'CALCULATED';
      amount: string;
      totalQuantity: number;
      fullSegmentCount: number;
      fullSegmentQuantity: number;
      remainderQuantity: number;
      remainderTierMaximumQuantity: number | null;
    }
  | {
      status: 'MANUAL_REQUIRED';
      amount: null;
      totalQuantity: number | null;
      reasonCode: 'INVALID_QUANTITY' | 'INVALID_CONFIGURATION';
      reason: string;
    };

export type ExternalOrderWeightLine = {
  itemKey: string | null;
  quantity: number;
  gramsPerItem: string;
  netWeightGrams: string;
  source: 'PAPER_WEIGHT' | 'PRODUCT_STRUCTURE';
};

export type ExternalOrderWeightCalculation =
  | {
      status: 'CALCULATED';
      netWeightGrams: string;
      billableWeightKg: string;
      lines: ExternalOrderWeightLine[];
    }
  | {
      status: 'MANUAL_REQUIRED';
      netWeightGrams: null;
      billableWeightKg: null;
      lines: ExternalOrderWeightLine[];
      reasonCode:
        | 'INVALID_QUANTITY'
        | 'INVALID_CONFIGURATION'
        | 'UNSUPPORTED_PRODUCT_STRUCTURE'
        | 'UNSUPPORTED_PAPER_WEIGHT';
      reason: string;
      itemKey: string | null;
    };

export type ZtoShippingChargeCalculation =
  | {
      status: 'CALCULATED';
      carrier: 'ZTO';
      amount: string;
      province: string;
      band: ExternalOrderZtoBand;
      billableWeightKg: string;
      additionalUnits: string;
    }
  | {
      status: 'WAIVED';
      carrier: 'SF_COLLECT';
      amount: '0.00';
      reason: string;
    }
  | {
      status: 'LOGISTICS_PENDING';
      carrier: 'LOGISTICS';
      amount: null;
      reasonCode: 'ORDER_EXCEEDS_ZTO_QUANTITY_LIMIT';
      reason: string;
      totalQuantity: number;
    }
  | {
      status: 'MANUAL_REQUIRED';
      carrier: 'ZTO';
      amount: null;
      reasonCode:
        | 'INVALID_QUANTITY'
        | 'INVALID_CONFIGURATION'
        | 'UNKNOWN_PROVINCE'
        | 'WEIGHT_REQUIRED';
      reason: string;
    };

export type ExternalOrderChargeCalculation = {
  complete: boolean;
  quantity: ExternalOrderQuantityCalculation;
  carton: CartonChargeCalculation;
  weight: ExternalOrderWeightCalculation;
  shipping: ZtoShippingChargeCalculation;
};

const ZTO_PROVINCES_BY_BAND: Readonly<
  Record<ExternalOrderZtoBand, readonly string[]>
> = {
  A: ['广东'],
  B: ['江西', '江苏', '安徽', '湖南', '湖北', '广西', '浙江', '福建'],
  C: ['天津', '上海', '北京', '河南', '河北', '四川', '重庆', '贵州', '山东'],
  D: ['云南', '山西', '陕西', '黑龙江', '吉林', '辽宁', '海南'],
  E: ['甘肃', '青海', '宁夏', '内蒙古'],
  F: ['新疆', '西藏'],
};

const PROVINCE_ALIASES = new Map<string, string>([
  ...Object.values(ZTO_PROVINCES_BY_BAND).flatMap((provinces) =>
    provinces.flatMap((province) => [
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

for (const invalidAlias of [
  '内蒙古省',
  '广西省',
  '西藏省',
  '宁夏省',
  '新疆省',
  '北京省',
  '天津省',
  '上海省',
  '重庆省',
]) {
  PROVINCE_ALIASES.delete(invalidAlias);
}

function parseFiniteDecimal(value: Decimal.Value): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function parsePositiveDecimal(value: Decimal.Value): Decimal | null {
  const parsed = parseFiniteDecimal(value);
  return parsed?.gt(0) ? parsed : null;
}

function parseNonNegativeDecimal(value: Decimal.Value): Decimal | null {
  const parsed = parseFiniteDecimal(value);
  return parsed?.gte(0) ? parsed : null;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function validQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0;
}

function itemName(item: ExternalOrderChargeItemInput, index: number): string {
  return item.key?.trim() || `第 ${index + 1} 款`;
}

export function calculateExternalOrderTotalQuantity(
  items: readonly ExternalOrderChargeItemInput[],
): ExternalOrderQuantityCalculation {
  if (items.length === 0) {
    return {
      status: 'MANUAL_REQUIRED',
      totalQuantity: null,
      reasonCode: 'INVALID_QUANTITY',
      reason: '至少需要一个款式才能计算订单级费用',
    };
  }

  let totalQuantity = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as ExternalOrderChargeItemInput;
    if (!validQuantity(item.quantity)) {
      return {
        status: 'MANUAL_REQUIRED',
        totalQuantity: null,
        reasonCode: 'INVALID_QUANTITY',
        reason: `${itemName(item, index)}数量必须是大于 0 的安全整数`,
      };
    }
    totalQuantity += item.quantity;
    if (!Number.isSafeInteger(totalQuantity)) {
      return {
        status: 'MANUAL_REQUIRED',
        totalQuantity: null,
        reasonCode: 'INVALID_QUANTITY',
        reason: '订单总数量超过安全计算范围，需人工处理',
      };
    }
  }

  return { status: 'CALCULATED', totalQuantity };
}

type ParsedCartonTier = {
  maximumQuantity: number;
  amount: Decimal;
};

function parseCartonTiers(
  tiers: readonly CartonChargeTierConfig[],
): ParsedCartonTier[] | null {
  if (tiers.length === 0) return null;

  const parsed: ParsedCartonTier[] = [];
  let previousMaximum = 0;
  for (const tier of tiers) {
    const amount = parseNonNegativeDecimal(tier.amount);
    if (
      !Number.isSafeInteger(tier.maximumQuantity) ||
      tier.maximumQuantity <= previousMaximum ||
      !amount
    ) {
      return null;
    }
    parsed.push({ maximumQuantity: tier.maximumQuantity, amount });
    previousMaximum = tier.maximumQuantity;
  }
  return parsed;
}

export function calculateCartonCharge(
  totalQuantity: number,
  config: ExternalOrderChargeCalculationConfig =
    DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG,
): CartonChargeCalculation {
  if (!validQuantity(totalQuantity)) {
    return {
      status: 'MANUAL_REQUIRED',
      amount: null,
      totalQuantity: Number.isFinite(totalQuantity) ? totalQuantity : null,
      reasonCode: 'INVALID_QUANTITY',
      reason: '订单总数量必须是大于 0 的安全整数',
    };
  }

  const tiers = parseCartonTiers(config.cartonTiers);
  const segment = tiers?.at(-1);
  if (!tiers || !segment) {
    return {
      status: 'MANUAL_REQUIRED',
      amount: null,
      totalQuantity,
      reasonCode: 'INVALID_CONFIGURATION',
      reason: '纸箱价格配置无效，需管理员修正后重新计价',
    };
  }

  const fullSegmentCount =
    totalQuantity > segment.maximumQuantity
      ? Math.floor(totalQuantity / segment.maximumQuantity)
      : 0;
  const remainderQuantity =
    fullSegmentCount > 0
      ? totalQuantity % segment.maximumQuantity
      : totalQuantity;
  const remainderTier =
    remainderQuantity === 0
      ? null
      : tiers.find((tier) => remainderQuantity <= tier.maximumQuantity) ?? null;

  if (remainderQuantity > 0 && !remainderTier) {
    return {
      status: 'MANUAL_REQUIRED',
      amount: null,
      totalQuantity,
      reasonCode: 'INVALID_CONFIGURATION',
      reason: '纸箱价格配置未覆盖当前余量，需管理员修正后重新计价',
    };
  }

  const amount = segment.amount
    .times(fullSegmentCount)
    .plus(remainderTier?.amount ?? 0);

  return {
    status: 'CALCULATED',
    amount: money(amount),
    totalQuantity,
    fullSegmentCount,
    fullSegmentQuantity: segment.maximumQuantity,
    remainderQuantity,
    remainderTierMaximumQuantity: remainderTier?.maximumQuantity ?? null,
  };
}

function manualWeight(
  reasonCode: Extract<
    ExternalOrderWeightCalculation,
    { status: 'MANUAL_REQUIRED' }
  >['reasonCode'],
  reason: string,
  itemKey: string | null,
  lines: ExternalOrderWeightLine[],
): ExternalOrderWeightCalculation {
  return {
    status: 'MANUAL_REQUIRED',
    netWeightGrams: null,
    billableWeightKg: null,
    lines,
    reasonCode,
    reason,
    itemKey,
  };
}

export function calculateOrderBillableWeight(
  items: readonly ExternalOrderChargeItemInput[],
  config: ExternalOrderChargeCalculationConfig =
    DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG,
): ExternalOrderWeightCalculation {
  if (items.length === 0) {
    return manualWeight(
      'INVALID_QUANTITY',
      '至少需要一个款式才能估算订单重量',
      null,
      [],
    );
  }

  const gramsPerKilogram = parsePositiveDecimal(
    config.weight.gramsPerKilogram,
  );
  const minimumBillableWeightKg = parsePositiveDecimal(
    config.weight.minimumBillableWeightKg,
  );
  const tenThousandEnvelopeGrams = parsePositiveDecimal(
    config.weight.tenThousandEnvelopeGramsPerItem,
  );
  if (
    !gramsPerKilogram ||
    !minimumBillableWeightKg ||
    !tenThousandEnvelopeGrams
  ) {
    return manualWeight(
      'INVALID_CONFIGURATION',
      '重量参数配置无效，需管理员修正后重新计价',
      null,
      [],
    );
  }

  const lines: ExternalOrderWeightLine[] = [];
  let totalGrams = new Decimal(0);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as ExternalOrderChargeItemInput;
    const name = itemName(item, index);
    if (!validQuantity(item.quantity)) {
      return manualWeight(
        'INVALID_QUANTITY',
        `${name}数量必须是大于 0 的安全整数`,
        item.key?.trim() || null,
        lines,
      );
    }

    let gramsPerItem: Decimal | null = null;
    let source: ExternalOrderWeightLine['source'] = 'PAPER_WEIGHT';
    if (item.productStructure === 'TEN_THOUSAND_ENVELOPE') {
      gramsPerItem = tenThousandEnvelopeGrams;
      source = 'PRODUCT_STRUCTURE';
    } else if (
      item.productStructure === 'STANDARD_ENVELOPE' ||
      item.productStructure === 'WESTERN_ENVELOPE'
    ) {
      const configuredGrams =
        item.paperWeightGsm === null || !Number.isFinite(item.paperWeightGsm)
          ? undefined
          : config.weight.gramsPerItemByPaperWeightGsm[
              String(item.paperWeightGsm)
            ];
      gramsPerItem =
        configuredGrams === undefined
          ? null
          : parsePositiveDecimal(configuredGrams);
      if (!gramsPerItem) {
        const paperWeight =
          item.paperWeightGsm === null ? '未填写' : `${item.paperWeightGsm}g`;
        return manualWeight(
          'UNSUPPORTED_PAPER_WEIGHT',
          `${name}的纸张克重（${paperWeight}）没有单重配置，物流重量需人工确认`,
          item.key?.trim() || null,
          lines,
        );
      }
    } else {
      return manualWeight(
        'UNSUPPORTED_PRODUCT_STRUCTURE',
        `${name}的产品结构未确定，物流重量需人工确认`,
        item.key?.trim() || null,
        lines,
      );
    }

    const lineWeight = gramsPerItem.times(item.quantity);
    totalGrams = totalGrams.plus(lineWeight);
    lines.push({
      itemKey: item.key?.trim() || null,
      quantity: item.quantity,
      gramsPerItem: gramsPerItem.toString(),
      netWeightGrams: lineWeight.toString(),
      source,
    });
  }

  const billableWeightKg = Decimal.max(
    minimumBillableWeightKg,
    totalGrams.div(gramsPerKilogram).ceil(),
  );

  return {
    status: 'CALCULATED',
    netWeightGrams: totalGrams.toString(),
    billableWeightKg: billableWeightKg.toString(),
    lines,
  };
}

export function normalizeExternalOrderProvince(
  provinceInput: string | null,
): string | null {
  const province = provinceInput?.trim();
  return province ? PROVINCE_ALIASES.get(province) ?? null : null;
}

function getZtoBand(province: string): ExternalOrderZtoBand | null {
  for (const band of Object.keys(
    ZTO_PROVINCES_BY_BAND,
  ) as ExternalOrderZtoBand[]) {
    if (ZTO_PROVINCES_BY_BAND[band].includes(province)) return band;
  }
  return null;
}

export function calculateZtoShippingCharge(
  input: {
    destinationProvince: string | null;
    totalQuantity: number;
    billableWeightKg: Decimal.Value | null;
    isSfCollect: boolean;
  },
  config: ExternalOrderChargeCalculationConfig =
    DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG,
): ZtoShippingChargeCalculation {
  if (input.isSfCollect) {
    return {
      status: 'WAIVED',
      carrier: 'SF_COLLECT',
      amount: '0.00',
      reason: '顺丰到付，本单快递费为 0',
    };
  }

  if (!validQuantity(input.totalQuantity)) {
    return {
      status: 'MANUAL_REQUIRED',
      carrier: 'ZTO',
      amount: null,
      reasonCode: 'INVALID_QUANTITY',
      reason: '订单总数量必须是大于 0 的安全整数',
    };
  }
  if (
    !Number.isSafeInteger(config.zto.maximumQuotedQuantity) ||
    config.zto.maximumQuotedQuantity < 1
  ) {
    return {
      status: 'MANUAL_REQUIRED',
      carrier: 'ZTO',
      amount: null,
      reasonCode: 'INVALID_CONFIGURATION',
      reason: '中通数量边界配置无效，需管理员修正后重新计价',
    };
  }
  if (input.totalQuantity > config.zto.maximumQuotedQuantity) {
    return {
      status: 'LOGISTICS_PENDING',
      carrier: 'LOGISTICS',
      amount: null,
      reasonCode: 'ORDER_EXCEEDS_ZTO_QUANTITY_LIMIT',
      reason: `订单总数量超过 ${config.zto.maximumQuotedQuantity}，改走物流，运费待定`,
      totalQuantity: input.totalQuantity,
    };
  }

  const province = normalizeExternalOrderProvince(input.destinationProvince);
  const band = province ? getZtoBand(province) : null;
  if (!province || !band) {
    return {
      status: 'MANUAL_REQUIRED',
      carrier: 'ZTO',
      amount: null,
      reasonCode: 'UNKNOWN_PROVINCE',
      reason: '收货省份不在中通报价范围内，运费需人工确认',
    };
  }

  const weight =
    input.billableWeightKg === null
      ? null
      : parsePositiveDecimal(input.billableWeightKg);
  if (!weight) {
    return {
      status: 'MANUAL_REQUIRED',
      carrier: 'ZTO',
      amount: null,
      reasonCode: 'WEIGHT_REQUIRED',
      reason: '缺少有效的计费重量，中通运费需人工确认',
    };
  }

  const rate = config.zto.ratesByBand[band];
  const firstWeightKg = parsePositiveDecimal(rate.firstWeightKg);
  const firstFee = parseNonNegativeDecimal(rate.firstFee);
  const additionalUnitKg = parsePositiveDecimal(rate.additionalUnitKg);
  const additionalUnitFee = parseNonNegativeDecimal(rate.additionalUnitFee);
  if (!firstWeightKg || !firstFee || !additionalUnitKg || !additionalUnitFee) {
    return {
      status: 'MANUAL_REQUIRED',
      carrier: 'ZTO',
      amount: null,
      reasonCode: 'INVALID_CONFIGURATION',
      reason: `中通 ${band} 档费率配置无效，需管理员修正后重新计价`,
    };
  }

  const additionalWeight = Decimal.max(0, weight.minus(firstWeightKg));
  const additionalUnits = additionalWeight.div(additionalUnitKg).ceil();
  const amount = firstFee.plus(additionalUnitFee.times(additionalUnits));

  return {
    status: 'CALCULATED',
    carrier: 'ZTO',
    amount: money(amount),
    province,
    band,
    billableWeightKg: weight.toString(),
    additionalUnits: additionalUnits.toString(),
  };
}

function manualCartonFromQuantity(
  quantity: Extract<
    ExternalOrderQuantityCalculation,
    { status: 'MANUAL_REQUIRED' }
  >,
): CartonChargeCalculation {
  return {
    status: 'MANUAL_REQUIRED',
    amount: null,
    totalQuantity: null,
    reasonCode: 'INVALID_QUANTITY',
    reason: quantity.reason,
  };
}

export function calculateExternalOrderChargeCalculation(
  input: ExternalOrderChargeCalculationInput,
  config: ExternalOrderChargeCalculationConfig =
    DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG,
): ExternalOrderChargeCalculation {
  const quantity = calculateExternalOrderTotalQuantity(input.items);
  const carton =
    quantity.status === 'CALCULATED'
      ? calculateCartonCharge(quantity.totalQuantity, config)
      : manualCartonFromQuantity(quantity);
  const weight = calculateOrderBillableWeight(input.items, config);
  const shipping = calculateZtoShippingCharge(
    {
      destinationProvince: input.destinationProvince,
      totalQuantity:
        quantity.status === 'CALCULATED' ? quantity.totalQuantity : Number.NaN,
      billableWeightKg:
        weight.status === 'CALCULATED' ? weight.billableWeightKg : null,
      isSfCollect: input.isSfCollect,
    },
    config,
  );

  return {
    complete:
      quantity.status === 'CALCULATED' &&
      carton.status === 'CALCULATED' &&
      weight.status === 'CALCULATED' &&
      (shipping.status === 'CALCULATED' || shipping.status === 'WAIVED'),
    quantity,
    carton,
    weight,
    shipping,
  };
}
