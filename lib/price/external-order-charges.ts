import Decimal from 'decimal.js';

export const EXTERNAL_ORDER_CHARGE_MONEY_MAX = '9999999999.99';
const MONEY_MAX = new Decimal(EXTERNAL_ORDER_CHARGE_MONEY_MAX);

export type ExternalOrderChargeSource = {
  fileName: string;
  sha256: string;
  sheetName: string;
  sourceRange: string;
};

export type ExternalOrderProductStructure =
  | 'STANDARD_ENVELOPE'
  | 'WESTERN_ENVELOPE'
  | 'TEN_THOUSAND_ENVELOPE'
  | 'UNSPECIFIED';

export type ExternalOrderChargeWeightItem = {
  itemKey: string | null;
  quantity: number;
  paperWeightGsm: number | null;
  paperType: string | null;
  productStructure: ExternalOrderProductStructure;
};

type ExternalOrderLogisticsPolicyBase = {
  ruleVersion: string;
  maxOrderQuantity: number;
};

export type ExternalOrderEstimateLogisticsPolicy =
  ExternalOrderLogisticsPolicyBase & {
  billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE';
  weightResolutionOrder: readonly [
    'ACTUAL_FULFILLMENT_WEIGHT',
    'SERVER_ESTIMATE',
  ];
  billableWeightRounding: 'CEIL_KG';
  minimumBillableWeightKg: string;
  gramsPerItemByPaperWeightGsm: Readonly<Record<string, string>>;
  tenThousandEnvelopeGramsPerItem: string;
};

export type ExternalOrderLegacyLogisticsPolicy =
  ExternalOrderLogisticsPolicyBase & {
  billableWeightInput: 'CARRIER_CONFIRMED';
  weightResolutionOrder: readonly ['ACTUAL_FULFILLMENT_WEIGHT'];
};

export type ExternalOrderLogisticsPolicy =
  | ExternalOrderEstimateLogisticsPolicy
  | ExternalOrderLegacyLogisticsPolicy;

export type ExternalOrderChargeShipmentInput = {
  /**
   * A stable client-side row key during preview, or the persisted shipment id
   * after creation. It is copied into every charge line for auditability.
   */
  shipmentKey: string;
  /** Structured province selection. Free-form receiver addresses must not be passed here. */
  province: string | null;
  /**
   * Trusted fulfilment weight supplied by the server. When absent, the
   * versioned logistics policy may estimate weight from `weightItems`.
   */
  billableWeightKg: Decimal.Value | null;
  /** Server-validated item facts allocated to this shipment for weight estimation. */
  weightItems?: readonly ExternalOrderChargeWeightItem[];
  requiresActualWeight?: boolean;
  /** Sum of all style quantities allocated to this shipment. */
  itemQuantity: number;
};

export type ExternalOrderChargeInput = {
  /** Server chooses this policy only for sample shipments. */
  samplePackaging?: { ruleCode: string | null };
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
  version: 2;
  policy: {
    ruleVersion: string;
    billableWeightInput:
      | 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
      | 'CARRIER_CONFIRMED';
    weightResolutionOrder: readonly string[];
    maxOrderQuantity: number;
    billableWeightRounding: 'CEIL_KG' | null;
  };
  input: {
    isSfCollect: boolean;
    shipments: Array<{
      shipmentKey: string;
      province: string | null;
      billableWeightKg: string | null;
      weightItems?: ExternalOrderChargeWeightItem[];
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

export const ZTO_PROVINCE_OPTIONS: readonly string[] = [
  '广东',
  '江西',
  '江苏',
  '安徽',
  '湖南',
  '湖北',
  '广西',
  '浙江',
  '福建',
  '天津',
  '上海',
  '北京',
  '河南',
  '河北',
  '四川',
  '重庆',
  '贵州',
  '山东',
  '云南',
  '山西',
  '陕西',
  '黑龙江',
  '吉林',
  '辽宁',
  '海南',
  '新疆',
  '西藏',
  '甘肃',
  '青海',
  '宁夏',
  '内蒙古',
];

const PROVINCE_ALIASES = new Map<string, string>([
  ...ZTO_PROVINCE_OPTIONS.flatMap((province) => [
    [province, province] as const,
    [`${province}省`, province] as const,
  ]),
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

export type ExternalOrderShipmentWeightResolution =
  | {
      status: 'RESOLVED';
      source: 'ACTUAL_FULFILLMENT_WEIGHT' | 'SERVER_ESTIMATE';
      billableWeightKg: string;
      netWeightGrams: string | null;
      weightItemCount: number;
    }
  | {
      status: 'INCOMPLETE';
      source: 'ACTUAL_FULFILLMENT_WEIGHT' | 'SERVER_ESTIMATE';
      billableWeightKg: null;
      netWeightGrams: null;
      weightItemCount: number;
      error: string;
    };

function weightItemLabel(
  item: ExternalOrderChargeWeightItem,
  index: number,
): string {
  return item.itemKey?.trim() || `第 ${index + 1} 款`;
}

/**
 * Resolves trusted fulfilment weight first, then estimates from server-owned
 * item facts. Browser input must be removed by the caller before it reaches
 * this function.
 */
export function resolveExternalOrderShipmentWeight(
  shipment: ExternalOrderChargeShipmentInput,
  policy: ExternalOrderLogisticsPolicy,
): ExternalOrderShipmentWeightResolution {
  const normalizedActualWeight =
    shipment.billableWeightKg === null ||
    shipment.billableWeightKg === undefined
      ? ''
      : String(shipment.billableWeightKg).trim();
  const hasActualWeightFact = normalizedActualWeight !== '';
  const actualWeight = parseFiniteDecimal(shipment.billableWeightKg);
  if (
    hasActualWeightFact &&
    /^\d{1,6}(?:\.\d{1,3})?$/.test(normalizedActualWeight) &&
    actualWeight?.gt(0)
  ) {
    return {
      status: 'RESOLVED',
      source: 'ACTUAL_FULFILLMENT_WEIGHT',
      billableWeightKg: actualWeight.toString(),
      netWeightGrams: null,
      weightItemCount: shipment.weightItems?.length ?? 0,
    };
  }
  if (hasActualWeightFact) {
    return {
      status: 'INCOMPLETE',
      source: 'ACTUAL_FULFILLMENT_WEIGHT',
      billableWeightKg: null,
      netWeightGrams: null,
      weightItemCount: shipment.weightItems?.length ?? 0,
      error: '实际计费重量无效，请核对履约重量',
    };
  }

  if (shipment.requiresActualWeight) {
    return {status: 'INCOMPLETE', source: 'SERVER_ESTIMATE', billableWeightKg: null, netWeightGrams: null, weightItemCount: shipment.weightItems?.length ?? 0, error: '装盒运费需确认实际包装重量'};
  }

  if (policy.billableWeightInput === 'CARRIER_CONFIRMED') {
    return {
      status: 'INCOMPLETE',
      source: 'SERVER_ESTIMATE',
      billableWeightKg: null,
      netWeightGrams: null,
      weightItemCount: shipment.weightItems?.length ?? 0,
      error: '缺少已确认的实际计费重量，请人工确认',
    };
  }

  const weightItems = shipment.weightItems ?? [];
  if (weightItems.length === 0) {
    return {
      status: 'INCOMPLETE',
      source: 'SERVER_ESTIMATE',
      billableWeightKg: null,
      netWeightGrams: null,
      weightItemCount: 0,
      error: '缺少可用于估算的款式重量事实，请人工确认',
    };
  }

  const minimumBillableWeightKg = parseFiniteDecimal(
    policy.minimumBillableWeightKg,
  );
  const tenThousandEnvelopeGramsPerItem = parseFiniteDecimal(
    policy.tenThousandEnvelopeGramsPerItem,
  );
  if (
    policy.billableWeightRounding !== 'CEIL_KG' ||
    policy.weightResolutionOrder.length !== 2 ||
    policy.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT' ||
    policy.weightResolutionOrder[1] !== 'SERVER_ESTIMATE' ||
    !minimumBillableWeightKg?.gt(0) ||
    !tenThousandEnvelopeGramsPerItem?.gt(0)
  ) {
    return {
      status: 'INCOMPLETE',
      source: 'SERVER_ESTIMATE',
      billableWeightKg: null,
      netWeightGrams: null,
      weightItemCount: weightItems.length,
      error: '物流重量估算策略无效，请管理员检查价目版本',
    };
  }

  let netWeightGrams = new Decimal(0);
  let weightItemQuantity = 0;
  for (let index = 0; index < weightItems.length; index += 1) {
    const item = weightItems[index] as ExternalOrderChargeWeightItem;
    const label = weightItemLabel(item, index);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      return {
        status: 'INCOMPLETE',
        source: 'SERVER_ESTIMATE',
        billableWeightKg: null,
        netWeightGrams: null,
        weightItemCount: weightItems.length,
        error: `${label}分配数量无效，物流重量需人工确认`,
      };
    }
    const nextWeightItemQuantity = weightItemQuantity + item.quantity;
    if (!Number.isSafeInteger(nextWeightItemQuantity)) {
      return {
        status: 'INCOMPLETE',
        source: 'SERVER_ESTIMATE',
        billableWeightKg: null,
        netWeightGrams: null,
        weightItemCount: weightItems.length,
        error: '重量明细数量合计超出安全整数，请人工确认',
      };
    }
    weightItemQuantity = nextWeightItemQuantity;

    let gramsPerItem: Decimal | null = null;
    if (item.productStructure === 'TEN_THOUSAND_ENVELOPE') {
      gramsPerItem = tenThousandEnvelopeGramsPerItem;
    } else if (
      item.productStructure === 'STANDARD_ENVELOPE' ||
      item.productStructure === 'WESTERN_ENVELOPE'
    ) {
      const configuredGrams =
        item.paperWeightGsm === null || !Number.isFinite(item.paperWeightGsm)
          ? undefined
          : policy.gramsPerItemByPaperWeightGsm[String(item.paperWeightGsm)];
      gramsPerItem =
        configuredGrams === undefined
          ? null
          : parseFiniteDecimal(configuredGrams);
      if (!gramsPerItem?.gt(0)) {
        const paperWeight =
          item.paperWeightGsm === null ? '未填写' : `${item.paperWeightGsm}g`;
        return {
          status: 'INCOMPLETE',
          source: 'SERVER_ESTIMATE',
          billableWeightKg: null,
          netWeightGrams: null,
          weightItemCount: weightItems.length,
          error: `${label}的纸张克重（${paperWeight}）没有物流单重配置，请人工确认`,
        };
      }
    } else {
      return {
        status: 'INCOMPLETE',
        source: 'SERVER_ESTIMATE',
        billableWeightKg: null,
        netWeightGrams: null,
        weightItemCount: weightItems.length,
        error: `${label}的产品结构未确定，物流重量需人工确认`,
      };
    }

    netWeightGrams = netWeightGrams.plus(
      gramsPerItem.times(item.quantity),
    );
  }

  if (weightItemQuantity !== shipment.itemQuantity) {
    return {
      status: 'INCOMPLETE',
      source: 'SERVER_ESTIMATE',
      billableWeightKg: null,
      netWeightGrams: null,
      weightItemCount: weightItems.length,
      error: `重量明细数量 ${weightItemQuantity} 与发货分配数量 ${shipment.itemQuantity} 不一致，请人工确认`,
    };
  }

  const estimatedWeightKg = Decimal.max(
    minimumBillableWeightKg,
    netWeightGrams.div(1_000).ceil(),
  );
  return {
    status: 'RESOLVED',
    source: 'SERVER_ESTIMATE',
    billableWeightKg: estimatedWeightKg.toString(),
    netWeightGrams: netWeightGrams.toString(),
    weightItemCount: weightItems.length,
  };
}

export function normalizeZtoProvince(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return PROVINCE_ALIASES.get(trimmed) ?? null;
}

export function getZtoTariff(
  provinceInput: string | null,
  rules: readonly ExternalOrderChargeRule[],
): {
  ruleCode: string;
  province: string;
  firstWeightKg: string;
  firstFee: string;
  additionalUnitKg: string;
  additionalUnitFee: string;
  sourceRange: string;
} | null {
  const selected = selectZtoTariff(provinceInput, rules);
  if (!selected) return null;
  return {
    ruleCode: selected.rule.code,
    province: selected.province,
    firstWeightKg: selected.firstWeightKg.toString(),
    firstFee: money(selected.firstFee),
    additionalUnitKg: selected.additionalUnitKg.toString(),
    additionalUnitFee: money(selected.additionalUnitFee),
    sourceRange: selected.rule.source.sourceRange,
  };
}

type SelectedZtoTariff = {
  rule: ExternalOrderShippingRule;
  province: string;
  firstWeightKg: Decimal;
  firstFee: Decimal;
  additionalUnitKg: Decimal;
  additionalUnitFee: Decimal;
};

function selectZtoTariff(
  provinceInput: string | null,
  rules: readonly ExternalOrderChargeRule[],
): SelectedZtoTariff | null {
  const province = normalizeZtoProvince(provinceInput);
  const matches = province
    ? rules.filter(
        (rule): rule is ExternalOrderShippingRule =>
          rule.kind === 'SHIPPING' && rule.provinces.includes(province),
      )
    : [];
  if (!province || matches.length !== 1) return null;
  const tariff = matches[0] as ExternalOrderShippingRule;
  const duplicateCodeCount = rules.filter(
    (rule): rule is ExternalOrderShippingRule =>
      rule.kind === 'SHIPPING' && rule.code === tariff.code,
  ).length;
  const firstWeightKg = parseFiniteDecimal(tariff.firstWeightKg);
  const firstFee = parseFiniteDecimal(tariff.firstFee);
  const additionalUnitKg = parseFiniteDecimal(tariff.additionalUnitKg);
  const additionalUnitFee = parseFiniteDecimal(tariff.additionalUnitFee);
  if (
    !tariff.code.trim() ||
    duplicateCodeCount !== 1 ||
    !firstWeightKg?.gt(0) ||
    !additionalUnitKg?.gt(0) ||
    !firstFee ||
    firstFee.isNegative() ||
    !additionalUnitFee ||
    additionalUnitFee.isNegative()
  ) {
    return null;
  }
  return {
    rule: tariff,
    province,
    firstWeightKg,
    firstFee,
    additionalUnitKg,
    additionalUnitFee,
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
  policy: ExternalOrderLogisticsPolicy,
): ExternalOrderChargeLine {
  if (!Number.isSafeInteger(shipment.itemQuantity) || shipment.itemQuantity < 1) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      '快递费待定',
      ['逐票款式数量必须是大于 0 的安全整数'],
      { itemQuantity: shipment.itemQuantity },
      null,
      false,
    );
  }
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

  if (
    !Number.isSafeInteger(policy.maxOrderQuantity) ||
    policy.maxOrderQuantity < 1
  ) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      '中通快递费',
      ['物流数量边界策略无效，请管理员检查价目版本'],
      {
        isSfCollect: false,
        orderTotalQuantity,
        maxOrderQuantity: policy.maxOrderQuantity,
        policyVersion: policy.ruleVersion,
      },
      null,
      false,
    );
  }

  if (orderTotalQuantity > policy.maxOrderQuantity) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      '物流运费待定',
      [
        `整单总数量超过 ${policy.maxOrderQuantity} 个，改走物流，运费待定`,
      ],
      {
        isSfCollect: false,
        orderTotalQuantity,
        maxOrderQuantity: policy.maxOrderQuantity,
        policyVersion: policy.ruleVersion,
        province: shipment.province?.trim() || null,
        billableWeightKg:
          parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      },
      null,
      false,
    );
  }

  const province = normalizeZtoProvince(shipment.province);
  if (!province) {
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
  const selectedTariff = selectZtoTariff(province, rules);
  if (!selectedTariff) {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      `${province}中通快递费`,
      ['计费地区的中通规则不唯一或配置无效，请人工确认'],
      {
        isSfCollect: false,
        province,
        billableWeightKg:
          parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
      },
      null,
      false,
    );
  }
  const {
    rule: tariffRule,
    firstWeightKg,
    firstFee,
    additionalUnitKg,
    additionalUnitFee,
  } = selectedTariff;
  const tariffView = getZtoTariff(province, rules)!;
  const weightResolution = resolveExternalOrderShipmentWeight(shipment, policy);
  const chargeSource = tariffRule.source;
  if (weightResolution.status === 'INCOMPLETE') {
    return incompleteLine(
      shipment.shipmentKey,
      'SHIPPING',
      '快递费',
      `${province}中通快递费`,
      [weightResolution.error],
      {
        isSfCollect: false,
        province,
        billableWeightKg: null,
        weightSource: weightResolution.source,
        weightItemCount: weightResolution.weightItemCount,
        netWeightGrams: weightResolution.netWeightGrams,
        policyVersion: policy.ruleVersion,
        billableWeightRounding:
          policy.billableWeightInput === 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
            ? policy.billableWeightRounding
            : null,
        additionalUnitKg: tariffView.additionalUnitKg,
      },
      chargeSource,
      false,
    );
  }

  const weight = new Decimal(weightResolution.billableWeightKg);

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
        weightSource: weightResolution.source,
        weightItemCount: weightResolution.weightItemCount,
        netWeightGrams: weightResolution.netWeightGrams,
        policyVersion: policy.ruleVersion,
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
      weightSource: weightResolution.source,
      weightItemCount: weightResolution.weightItemCount,
      netWeightGrams: weightResolution.netWeightGrams,
      policyVersion: policy.ruleVersion,
      billableWeightRounding:
        policy.billableWeightInput === 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
          ? policy.billableWeightRounding
          : null,
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
  samplePackaging?: { ruleCode: string | null },
): ExternalOrderChargeLine {
  if (!Number.isSafeInteger(shipment.itemQuantity) || shipment.itemQuantity < 1) {
    const orderTotalInvalid =
      !Number.isSafeInteger(orderTotalQuantity) || orderTotalQuantity < 1;
    return incompleteLine(
      shipment.shipmentKey,
      'PACKAGING',
      '打包耗材费',
      '纸箱费',
      [
        ...(orderTotalInvalid
          ? ['整单总数量必须是大于 0 的安全整数']
          : []),
        '逐票款式数量必须是大于 0 的安全整数',
      ],
      {
        orderTotalQuantity,
        itemQuantity: shipment.itemQuantity,
      },
      null,
      false,
    );
  }
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

  if (samplePackaging) {
    const tier = samplePackaging.ruleCode ? tiers.find((row) => row.code === samplePackaging.ruleCode) : tiers[0];
    if (!tier) return incompleteLine(shipment.shipmentKey, 'PACKAGING', '打包耗材费', '纸箱费', ['所选包装已停用，请重新选择包装'], { orderTotalQuantity }, null, false);
    return {
      code: `PACKAGING_${shipment.shipmentKey}`, ruleCode: isPrimaryShipment ? tier.code : null,
      categoryCode: 'PACKAGING', categoryName: '打包耗材费', shipmentKey: shipment.shipmentKey,
      name: isPrimaryShipment ? '纸箱费' : '纸箱费已计入主地址',
      amount: isPrimaryShipment ? money(new Decimal(tier.amount)) : '0.00', complete: true,
      advisory: false, waived: false, errors: [], source: isPrimaryShipment ? tier.source : null,
      basis: { orderTotalQuantity, granularity: 'PER_ORDER', samplePackaging: true, selectedTierMaximumQuantity: tier.maxQty, allocatedToPrimaryShipment: isPrimaryShipment },
    };
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
  const total = lines.reduce(
    (result, line) => result.plus(line.amount as string),
    new Decimal(0),
  );
  return total.lte(MONEY_MAX) ? money(total) : null;
}

function logisticsPolicySnapshot(policy: ExternalOrderLogisticsPolicy) {
  return {
    ruleVersion: policy.ruleVersion,
    billableWeightInput: policy.billableWeightInput,
    weightResolutionOrder: [...policy.weightResolutionOrder],
    maxOrderQuantity: policy.maxOrderQuantity,
    billableWeightRounding:
      policy.billableWeightInput === 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
        ? policy.billableWeightRounding
        : null,
  } as const;
}

function chargeSnapshotInput(input: ExternalOrderChargeInput) {
  return input.shipments.map((shipment) => ({
    shipmentKey: shipment.shipmentKey,
    ...(shipment.requiresActualWeight ? {requiresActualWeight: true} : {}),
    province: shipment.province?.trim() || null,
    billableWeightKg:
      parseFiniteDecimal(shipment.billableWeightKg)?.toString() ?? null,
    ...(shipment.weightItems
      ? { weightItems: shipment.weightItems.map((item) => ({ ...item })) }
      : {}),
    itemQuantity: shipment.itemQuantity,
  }));
}

function invalidChargeInputQuote(
  input: ExternalOrderChargeInput,
  policy: ExternalOrderLogisticsPolicy,
  errors: string[],
): ExternalOrderChargeQuote {
  const snapshot: ExternalOrderChargeSnapshot = {
    version: 2,
    policy: logisticsPolicySnapshot(policy),
    input: {
      isSfCollect: input.isSfCollect,
      shipments: chargeSnapshotInput(input),
    },
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

export function calculateExternalOrderCharges(
  input: ExternalOrderChargeInput,
  rules: readonly ExternalOrderChargeRule[],
  policy: ExternalOrderLogisticsPolicy,
): ExternalOrderChargeQuote {
  if (input.shipments.length === 0) {
    const errors = ['至少需要一个发货地址才能计算快递与打包耗材费'];
    return invalidChargeInputQuote(input, policy, errors);
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
    return invalidChargeInputQuote(input, policy, errors);
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
      policy,
    ),
    packaging: quotePackaging(
      shipment,
      orderTotalQuantity,
      index === 0,
      rules,
      input.samplePackaging,
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
  const componentsComplete = components.every((component) => component.complete);
  const aggregateErrors: string[] = [];
  if (componentsComplete && suggestedShippingTotal === null) {
    aggregateErrors.push('快递费合计超过系统可保存上限');
  }
  if (componentsComplete && suggestedPackagingTotal === null) {
    aggregateErrors.push('打包耗材费合计超过系统可保存上限');
  }
  const componentTotal =
    suggestedShippingTotal !== null && suggestedPackagingTotal !== null
      ? new Decimal(suggestedShippingTotal).plus(suggestedPackagingTotal)
      : null;
  if (componentTotal?.gt(MONEY_MAX)) {
    aggregateErrors.push('快递与打包耗材费合计超过系统可保存上限');
  }
  const complete =
    componentsComplete &&
    suggestedShippingTotal !== null &&
    suggestedPackagingTotal !== null &&
    aggregateErrors.length === 0;
  const suggestedTotal = complete ? money(componentTotal!) : null;
  const errors = [
    ...components.flatMap((component) =>
    component.errors.map(
      (error) => `发货记录 ${component.shipmentKey}·${component.categoryName}：${error}`,
    ),
    ),
    ...aggregateErrors,
  ];

  const snapshotInput = chargeSnapshotInput(input);
  const snapshot: ExternalOrderChargeSnapshot = {
    version: 2,
    policy: logisticsPolicySnapshot(policy),
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
