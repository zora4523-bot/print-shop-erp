import Decimal from 'decimal.js';
import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';
import { validatePriceAdjustmentTriggerCondition } from './adjustment-condition';

export type QuoteAdjustmentType =
  | 'PER_SHEET'
  | 'PER_PIECE'
  | 'PER_ORDER'
  | 'PER_10K'
  | 'FIXED_AMOUNT';

type LegacyQuoteAdjustmentType = Exclude<
  QuoteAdjustmentType,
  'FIXED_AMOUNT'
>;

export type QuotePriceTier = {
  id: string;
  productId: string;
  minQty: number;
  unitPrice: Decimal.Value;
};

export type QuoteAdjustment = {
  id: string;
  name: string;
  adjustmentType: LegacyQuoteAdjustmentType;
  amount: Decimal.Value;
  triggerCondition: unknown;
  // Callers normally pass active rows only. Keeping this flag at the pure
  // boundary makes an accidental unfiltered dictionary read fail closed.
  isActive?: boolean;
};

export type QuoteInput = {
  quantity: number;
  productId: string | null;
  craftIds: string[];
  specification: string | null;
  paperType: string | null;
  foilColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  settlementType: string;
  baseUnitPrice?: Decimal.Value | null;
  minOrderQty?: number | null;
  priceTiers: QuotePriceTier[];
  adjustments: QuoteAdjustment[];
};

export type QuoteComponent = {
  source: 'BASE' | 'ADJUSTMENT';
  sourceId: string | null;
  name: string;
  adjustmentType: QuoteAdjustmentType;
  rate: string;
  units: string;
  amount: string;
  categoryCode: string | null;
  categoryName: string | null;
  ruleCode: string | null;
  sourceSheet: string | null;
  sourceRange: string | null;
};

export type QuoteTriggerCondition = Record<
  string,
  string | number | boolean | string[]
>;

type NormalizedTriggerCondition = {
  productIds?: string[];
  craftIds?: string[];
  craftMode?: 'ANY' | 'ALL';
  specifications?: string[];
  paperTypes?: string[];
  foilColors?: string[];
  isDoubleSided?: boolean;
  isDoubleColor?: boolean;
  minQty?: number;
  maxQty?: number;
  settlementTypes?: string[];
  unitsPerSheet?: number;
  perFoilColor?: boolean;
};

export type QuoteSnapshot = {
  version: 1;
  priceBook: {
    id: string;
    code: string;
    name: string;
    version: number;
    sourceName: string | null;
    sourceSha256: string | null;
  } | null;
  input: {
    quantity: number;
    productId: string | null;
    productCode: string | null;
    craftIds: string[];
    craftCodes: string[];
    specification: string | null;
    paperType: string | null;
    foilColors: string[];
    isDoubleSided: boolean;
    isDoubleColor: boolean;
    settlementType: string;
    orderItemCount: number;
    baseUnitPrice: string | null;
    minOrderQty: number | null;
  };
  base: {
    source:
      | 'PRICE_TIER'
      | 'PRODUCT_BASE'
      | 'CUSTOMER_PRICE_RULE'
      | 'MISSING';
    sourceId: string | null;
    minQty: number | null;
    unitPrice: string | null;
  };
  appliedAdjustments: Array<{
    id: string;
    name: string;
    adjustmentType: QuoteAdjustmentType;
    amount: string;
    triggerCondition: QuoteTriggerCondition;
    categoryCode: string | null;
    categoryName: string | null;
    ruleCode: string | null;
    sourceSheet: string | null;
    sourceRange: string | null;
  }>;
  components: QuoteComponent[];
  suggestedUnitPrice: string | null;
  suggestedFixedFee: string | null;
  suggestedSubtotal: string | null;
  complete: boolean;
  errors: string[];
};

export type QuoteResult = {
  components: QuoteComponent[];
  suggestedUnitPrice: string | null;
  suggestedFixedFee: string | null;
  suggestedSubtotal: string | null;
  complete: boolean;
  errors: string[];
  snapshot: QuoteSnapshot;
};

const ADJUSTMENT_TYPES = new Set<LegacyQuoteAdjustmentType>([
  'PER_SHEET',
  'PER_PIECE',
  'PER_ORDER',
  'PER_10K',
]);

// Keep the pure quote boundary aligned with the columns that eventually store
// its result. PostgreSQL Decimal(10,4) accepts at most 999999.9999 and
// Decimal(12,2) accepts at most 9999999999.99. A valid rule can still overflow
// after quantity/multiple-rule multiplication, so checking only rule inputs is
// not enough.
const DECIMAL_10_4_MAX = new Decimal('999999.9999');
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function unitPriceFloor(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_DOWN);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRate(value: Decimal.Value): Decimal | null {
  try {
    const parsed = new Decimal(value);
    if (
      !parsed.isFinite() ||
      parsed.isNegative() ||
      parsed.decimalPlaces() > 4 ||
      parsed.gt(DECIMAL_10_4_MAX)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseStringList(
  condition: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): string[] | undefined {
  if (!(key in condition)) return undefined;
  const value = condition[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || entry.trim() === '')
  ) {
    errors.push(`${label}必须是非空字符串数组`);
    return undefined;
  }
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

function parseBoolean(
  condition: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): boolean | undefined {
  if (!(key in condition)) return undefined;
  const value = condition[key];
  if (typeof value !== 'boolean') {
    errors.push(`${label}必须是布尔值`);
    return undefined;
  }
  return value;
}

function parsePositiveInteger(
  condition: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): number | undefined {
  if (!(key in condition)) return undefined;
  const value = condition[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    errors.push(`${label}必须是正整数`);
    return undefined;
  }
  return value as number;
}

function validateTriggerCondition(
  raw: unknown,
  adjustmentType: LegacyQuoteAdjustmentType,
): { condition: NormalizedTriggerCondition | null; errors: string[] } {
  const contractErrors = validatePriceAdjustmentTriggerCondition(
    raw,
    adjustmentType,
  );
  if (contractErrors.length > 0) {
    return { condition: null, errors: contractErrors };
  }
  if (raw === null || raw === undefined) {
    return { condition: {}, errors: [] };
  }
  if (!isRecord(raw)) {
    return { condition: null, errors: ['触发条件必须是 JSON object'] };
  }

  const errors: string[] = [];
  const condition: NormalizedTriggerCondition = {};
  condition.productIds = parseStringList(raw, 'productIds', 'productIds', errors);
  condition.craftIds = parseStringList(raw, 'craftIds', 'craftIds', errors);
  condition.specifications = parseStringList(
    raw,
    'specifications',
    'specifications',
    errors,
  );
  condition.paperTypes = parseStringList(raw, 'paperTypes', 'paperTypes', errors);
  condition.foilColors = parseStringList(raw, 'foilColors', 'foilColors', errors);
  condition.settlementTypes = parseStringList(
    raw,
    'settlementTypes',
    'settlementTypes',
    errors,
  );
  condition.isDoubleSided = parseBoolean(
    raw,
    'isDoubleSided',
    'isDoubleSided',
    errors,
  );
  condition.isDoubleColor = parseBoolean(
    raw,
    'isDoubleColor',
    'isDoubleColor',
    errors,
  );
  condition.perFoilColor = parseBoolean(
    raw,
    'perFoilColor',
    'perFoilColor',
    errors,
  );
  condition.minQty = parsePositiveInteger(raw, 'minQty', 'minQty', errors);
  condition.maxQty = parsePositiveInteger(raw, 'maxQty', 'maxQty', errors);
  condition.unitsPerSheet = parsePositiveInteger(
    raw,
    'unitsPerSheet',
    'unitsPerSheet',
    errors,
  );

  if ('craftMode' in raw) {
    const craftMode = raw.craftMode;
    if (craftMode !== 'ANY' && craftMode !== 'ALL') {
      errors.push('craftMode 只能是 ANY 或 ALL');
    } else {
      condition.craftMode = craftMode;
    }
  }
  return errors.length > 0
    ? { condition: null, errors }
    : { condition, errors: [] };
}

function matchesCondition(
  input: QuoteInput,
  condition: NormalizedTriggerCondition,
): boolean {
  if (
    condition.productIds &&
    (!input.productId || !condition.productIds.includes(input.productId))
  ) {
    return false;
  }
  if (condition.craftIds) {
    const matches =
      (condition.craftMode ?? 'ANY') === 'ALL'
        ? condition.craftIds.every((id) => input.craftIds.includes(id))
        : condition.craftIds.some((id) => input.craftIds.includes(id));
    if (!matches) return false;
  }
  if (
    condition.specifications &&
    (!input.specification || !condition.specifications.includes(input.specification))
  ) {
    return false;
  }
  if (
    condition.paperTypes &&
    (!input.paperType || !condition.paperTypes.includes(input.paperType))
  ) {
    return false;
  }
  if (
    condition.foilColors &&
    !condition.foilColors.some((color) => input.foilColors.includes(color))
  ) {
    return false;
  }
  if (
    condition.isDoubleSided !== undefined &&
    condition.isDoubleSided !== input.isDoubleSided
  ) {
    return false;
  }
  if (
    condition.isDoubleColor !== undefined &&
    condition.isDoubleColor !== input.isDoubleColor
  ) {
    return false;
  }
  if (condition.minQty !== undefined && input.quantity < condition.minQty) {
    return false;
  }
  if (condition.maxQty !== undefined && input.quantity > condition.maxQty) {
    return false;
  }
  if (
    condition.settlementTypes &&
    !condition.settlementTypes.includes(input.settlementType)
  ) {
    return false;
  }
  return true;
}

function foilColorMultiplier(input: QuoteInput): number {
  const actualColors = new Set(
    input.foilColors.filter((color) => color !== NO_FOIL_COLOR),
  );
  return actualColors.size;
}

function adjustmentUnits(
  input: QuoteInput,
  type: LegacyQuoteAdjustmentType,
  condition: NormalizedTriggerCondition,
): Decimal {
  const colorMultiplier = condition.perFoilColor
    ? new Decimal(foilColorMultiplier(input))
    : new Decimal(1);
  switch (type) {
    case 'PER_PIECE':
      return new Decimal(input.quantity).times(colorMultiplier);
    case 'PER_SHEET':
      return new Decimal(input.quantity)
        .div(condition.unitsPerSheet as number)
        .ceil()
        .times(colorMultiplier);
    case 'PER_10K':
      return new Decimal(input.quantity).div(10_000).times(colorMultiplier);
    case 'PER_ORDER':
      // A quote is for exactly one order item, so PER_ORDER applies once per
      // item in this version (then per foil color when explicitly requested).
      return colorMultiplier;
  }
}

function snapshotBaseUnitPrice(value: QuoteInput['baseUnitPrice']): string | null {
  if (value === null || value === undefined) return null;
  const parsed = parseRate(value);
  return parsed ? parsed.toFixed(4) : null;
}

function snapshotTriggerCondition(
  condition: NormalizedTriggerCondition,
): QuoteTriggerCondition {
  return Object.fromEntries(
    Object.entries(condition).filter((entry) => entry[1] !== undefined),
  ) as QuoteTriggerCondition;
}

export function calculateQuote(input: QuoteInput): QuoteResult {
  const errors: string[] = [];
  const components: QuoteComponent[] = [];
  const appliedAdjustments: QuoteSnapshot['appliedAdjustments'] = [];

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    errors.push('数量必须是正整数');
  }

  if (input.minOrderQty !== null && input.minOrderQty !== undefined) {
    if (!Number.isSafeInteger(input.minOrderQty) || input.minOrderQty < 1) {
      errors.push('产品最小起订量配置非法');
    } else if (
      Number.isSafeInteger(input.quantity) &&
      input.quantity > 0 &&
      input.quantity < input.minOrderQty
    ) {
      errors.push(`数量低于产品最小起订量 ${input.minOrderQty}`);
    }
  }

  let baseSnapshot: QuoteSnapshot['base'] = {
    source: 'MISSING',
    sourceId: null,
    minQty: null,
    unitPrice: null,
  };
  let baseRate: Decimal | null = null;

  if (errors.length === 0) {
    const applicableTiers: Array<{ tier: QuotePriceTier; rate: Decimal }> = [];
    for (const tier of input.priceTiers) {
      if (tier.productId !== input.productId) continue;
      const rate = parseRate(tier.unitPrice);
      if (!Number.isSafeInteger(tier.minQty) || tier.minQty < 1 || !rate) {
        errors.push(`价格阶梯“${tier.id}”配置非法`);
        continue;
      }
      if (tier.minQty <= input.quantity) applicableTiers.push({ tier, rate });
    }
    applicableTiers.sort((left, right) => right.tier.minQty - left.tier.minQty);
    const selected = applicableTiers[0];
    if (selected) {
      baseRate = selected.rate;
      baseSnapshot = {
        source: 'PRICE_TIER',
        sourceId: selected.tier.id,
        minQty: selected.tier.minQty,
        unitPrice: selected.rate.toFixed(4),
      };
    } else if (input.baseUnitPrice !== null && input.baseUnitPrice !== undefined) {
      const fallback = parseRate(input.baseUnitPrice);
      if (fallback) {
        baseRate = fallback;
        baseSnapshot = {
          source: 'PRODUCT_BASE',
          sourceId: input.productId,
          minQty: null,
          unitPrice: fallback.toFixed(4),
        };
      } else {
        errors.push('产品基础单价配置非法');
      }
    } else {
      errors.push('未找到适用的价格阶梯，产品也没有基础单价');
    }
  }

  if (baseRate) {
    components.push({
      source: 'BASE',
      sourceId: baseSnapshot.sourceId,
      name: '基础价',
      adjustmentType: 'PER_PIECE',
      rate: baseRate.toFixed(4),
      units: String(input.quantity),
      amount: money(baseRate.times(input.quantity)).toFixed(2),
      categoryCode: null,
      categoryName: null,
      ruleCode: null,
      sourceSheet: null,
      sourceRange: null,
    });
  }

  for (const adjustment of input.adjustments) {
    if (adjustment.isActive === false) continue;
    const ruleName = adjustment.name || adjustment.id || '未命名规则';
    if (!ADJUSTMENT_TYPES.has(adjustment.adjustmentType)) {
      errors.push(`加价规则“${ruleName}”：计价类型非法`);
      continue;
    }
    const rate = parseRate(adjustment.amount);
    if (!rate) {
      errors.push(`加价规则“${ruleName}”：金额必须是最多 4 位小数的非负有限数`);
      continue;
    }
    const validated = validateTriggerCondition(
      adjustment.triggerCondition,
      adjustment.adjustmentType,
    );
    if (!validated.condition) {
      for (const error of validated.errors) {
        errors.push(`加价规则“${ruleName}”：${error}`);
      }
      continue;
    }
    if (!matchesCondition(input, validated.condition)) continue;

    const units = adjustmentUnits(
      input,
      adjustment.adjustmentType,
      validated.condition,
    );
    const amount = money(rate.times(units));
    components.push({
      source: 'ADJUSTMENT',
      sourceId: adjustment.id,
      name: ruleName,
      adjustmentType: adjustment.adjustmentType,
      rate: rate.toFixed(4),
      units: units.toString(),
      amount: amount.toFixed(2),
      categoryCode: null,
      categoryName: null,
      ruleCode: null,
      sourceSheet: null,
      sourceRange: null,
    });
    appliedAdjustments.push({
      id: adjustment.id,
      name: ruleName,
      adjustmentType: adjustment.adjustmentType,
      amount: rate.toFixed(4),
      triggerCondition: snapshotTriggerCondition(validated.condition),
      categoryCode: null,
      categoryName: null,
      ruleCode: null,
      sourceSheet: null,
      sourceRange: null,
    });
  }

  const subtotal = components.reduce(
    (sum, component) => sum.plus(component.amount),
    new Decimal(0),
  );
  // Suggested OrderItem fields must satisfy the form/schema invariant that
  // fixedFee is non-negative. Deriving unit price from raw rates can violate
  // it after per-component cent rounding (two tiny PER_PIECE components may
  // each round to zero while their combined raw rate rounds up). Instead,
  // allocate only the already-rounded per-piece component total into unit
  // price, floor to four decimals, and leave the non-negative remainder in
  // fixedFee. For non-negative components this guarantees:
  //   money(quantity * unitPrice) + fixedFee = subtotal
  const perPieceComponentTotal = components
    .filter((component) => component.adjustmentType === 'PER_PIECE')
    .reduce(
      (sum, component) => sum.plus(component.amount),
      new Decimal(0),
    );
  let suggestedUnitCandidate: Decimal | null = null;
  let suggestedFixedCandidate: Decimal | null = null;
  if (errors.length === 0 && baseRate) {
    suggestedUnitCandidate = unitPriceFloor(
      perPieceComponentTotal.div(input.quantity),
    );
    const extendedUnitAmount = money(
      suggestedUnitCandidate.times(input.quantity),
    );
    suggestedFixedCandidate = money(subtotal.minus(extendedUnitAmount));

    if (suggestedUnitCandidate.gt(DECIMAL_10_4_MAX)) {
      errors.push(
        '建议单价超过系统上限 999,999.9999 元，请调整价格规则后重试',
      );
    }
    if (suggestedFixedCandidate.gt(DECIMAL_12_2_MAX)) {
      errors.push(
        '建议一次性费用超过系统上限 9,999,999,999.99 元，请调整价格规则后重试',
      );
    }
    if (subtotal.gt(DECIMAL_12_2_MAX)) {
      errors.push(
        '建议小计超过系统上限 9,999,999,999.99 元，请调整价格规则或数量后重试',
      );
    }
  }

  const complete = errors.length === 0 && baseRate !== null;
  let suggestedUnitPrice: string | null = null;
  let suggestedFixedFee: string | null = null;
  let suggestedSubtotal: string | null = null;
  if (complete && suggestedUnitCandidate && suggestedFixedCandidate) {
    suggestedUnitPrice = suggestedUnitCandidate.toFixed(4);
    suggestedFixedFee = suggestedFixedCandidate.toFixed(2);
    suggestedSubtotal = subtotal.toFixed(2);
  }

  const snapshot: QuoteSnapshot = {
    version: 1,
    priceBook: null,
    input: {
      quantity: input.quantity,
      productId: input.productId,
      productCode: null,
      craftIds: [...input.craftIds],
      craftCodes: [],
      specification: input.specification,
      paperType: input.paperType,
      foilColors: [...input.foilColors],
      isDoubleSided: input.isDoubleSided,
      isDoubleColor: input.isDoubleColor,
      settlementType: input.settlementType,
      orderItemCount: 1,
      baseUnitPrice: snapshotBaseUnitPrice(input.baseUnitPrice),
      minOrderQty: input.minOrderQty ?? null,
    },
    base: baseSnapshot,
    appliedAdjustments,
    components,
    suggestedUnitPrice,
    suggestedFixedFee,
    suggestedSubtotal,
    complete,
    errors: [...errors],
  };

  return {
    components,
    suggestedUnitPrice,
    suggestedFixedFee,
    suggestedSubtotal,
    complete,
    errors,
    snapshot,
  };
}
