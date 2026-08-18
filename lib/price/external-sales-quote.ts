import Decimal from 'decimal.js';
import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';
import type {
  QuoteAdjustmentType,
  QuoteComponent,
  QuoteResult,
  QuoteSnapshot,
  QuoteTriggerCondition,
} from './quote';

export type CustomerPriceRuleKindValue = 'BASE' | 'ADD_ON' | 'REFERENCE';

export type CustomerPriceCalculationTypeValue =
  | 'PER_PIECE'
  | 'FIXED_AMOUNT'
  | 'PER_SHEET'
  | 'PER_10K'
  | 'PER_ITEM';

export type ExternalSalesPriceBook = {
  id: string;
  code: string;
  name: string;
  version: number;
  sourceName: string | null;
  sourceSha256: string | null;
};

export type ExternalSalesPriceRule = {
  id: string;
  code: string;
  name: string;
  kind: CustomerPriceRuleKindValue;
  calculationType: CustomerPriceCalculationTypeValue | null;
  amount: Decimal.Value | null;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  priority: number;
  blocksAutomaticQuote: boolean;
  sourceSheet: string | null;
  sourceRange: string | null;
  note: string | null;
  productId: string | null;
  category: {
    code: string;
    name: string;
  };
};

export type ExternalSalesQuoteInput = {
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
};

type NormalizedCondition = {
  productCodes?: string[];
  craftCodes?: string[];
  noneOfCraftCodes?: string[];
  anyCraftCodeOutside?: string[];
  craftMode?: 'ANY' | 'ALL';
  specifications?: string[];
  paperTypes?: string[];
  foilColors?: string[];
  isDoubleSided?: boolean;
  isDoubleColor?: boolean;
  foilColorCount?: number;
  minFoilColorCount?: number;
  maxFoilColorCount?: number;
  minItemCount?: number;
  maxItemCount?: number;
  unitsPerSheet?: number;
  perFoilColor?: boolean;
};

const CONDITION_KEYS = new Set<keyof NormalizedCondition>([
  'productCodes',
  'craftCodes',
  'noneOfCraftCodes',
  'anyCraftCodeOutside',
  'craftMode',
  'specifications',
  'paperTypes',
  'foilColors',
  'isDoubleSided',
  'isDoubleColor',
  'foilColorCount',
  'minFoilColorCount',
  'maxFoilColorCount',
  'minItemCount',
  'maxItemCount',
  'unitsPerSheet',
  'perFoilColor',
]);

const RULE_KINDS = new Set<CustomerPriceRuleKindValue>([
  'BASE',
  'ADD_ON',
  'REFERENCE',
]);

const CALCULATION_TYPES = new Set<CustomerPriceCalculationTypeValue>([
  'PER_PIECE',
  'FIXED_AMOUNT',
  'PER_SHEET',
  'PER_10K',
  'PER_ITEM',
]);

export const EXTERNAL_SALES_PRICE_LIMITS = {
  ruleAmount: '9999999999.9999',
  subtotal: '9999999999.99',
  unitPrice: '999999.9999',
} as const;

const RATE_MAX = new Decimal(EXTERNAL_SALES_PRICE_LIMITS.ruleAmount);
const SUBTOTAL_MAX = new Decimal(EXTERNAL_SALES_PRICE_LIMITS.subtotal);
const UNIT_PRICE_MAX = new Decimal(EXTERNAL_SALES_PRICE_LIMITS.unitPrice);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStringArray(
  value: unknown,
  label: string,
  errors: string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || entry.trim() === '')
  ) {
    errors.push(`${label} 必须是非空字符串数组`);
    return undefined;
  }
  return [...new Set(value.map((entry) => String(entry).trim()))];
}

function parsePositiveInteger(
  value: unknown,
  label: string,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    errors.push(`${label} 必须是正整数`);
    return undefined;
  }
  return Number(value);
}

function parseNonNegativeInteger(
  value: unknown,
  label: string,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    errors.push(`${label} 必须是非负整数`);
    return undefined;
  }
  return Number(value);
}

function parseCondition(
  raw: unknown,
): { condition: NormalizedCondition | null; errors: string[] } {
  if (raw === null || raw === undefined) {
    return { condition: {}, errors: [] };
  }
  if (!isRecord(raw)) {
    return { condition: null, errors: ['触发条件必须是 JSON object'] };
  }

  const errors: string[] = [];
  const unknownKeys = Object.keys(raw).filter(
    (key) => !CONDITION_KEYS.has(key as keyof NormalizedCondition),
  );
  if (unknownKeys.length > 0) {
    errors.push(`包含未知触发字段：${unknownKeys.join('、')}`);
  }

  const condition: NormalizedCondition = {
    productCodes: parseStringArray(raw.productCodes, 'productCodes', errors),
    craftCodes: parseStringArray(raw.craftCodes, 'craftCodes', errors),
    noneOfCraftCodes: parseStringArray(
      raw.noneOfCraftCodes,
      'noneOfCraftCodes',
      errors,
    ),
    anyCraftCodeOutside: parseStringArray(
      raw.anyCraftCodeOutside,
      'anyCraftCodeOutside',
      errors,
    ),
    specifications: parseStringArray(
      raw.specifications,
      'specifications',
      errors,
    ),
    paperTypes: parseStringArray(raw.paperTypes, 'paperTypes', errors),
    foilColors: parseStringArray(raw.foilColors, 'foilColors', errors),
    foilColorCount: parseNonNegativeInteger(
      raw.foilColorCount,
      'foilColorCount',
      errors,
    ),
    minFoilColorCount: parseNonNegativeInteger(
      raw.minFoilColorCount,
      'minFoilColorCount',
      errors,
    ),
    maxFoilColorCount: parseNonNegativeInteger(
      raw.maxFoilColorCount,
      'maxFoilColorCount',
      errors,
    ),
    minItemCount: parsePositiveInteger(
      raw.minItemCount,
      'minItemCount',
      errors,
    ),
    maxItemCount: parsePositiveInteger(
      raw.maxItemCount,
      'maxItemCount',
      errors,
    ),
    unitsPerSheet: parsePositiveInteger(
      raw.unitsPerSheet,
      'unitsPerSheet',
      errors,
    ),
  };

  for (const key of [
    'isDoubleSided',
    'isDoubleColor',
    'perFoilColor',
  ] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      errors.push(`${key} 必须是布尔值`);
    } else {
      condition[key] = raw[key];
    }
  }

  if (raw.craftMode !== undefined) {
    if (raw.craftMode !== 'ANY' && raw.craftMode !== 'ALL') {
      errors.push('craftMode 只能是 ANY 或 ALL');
    } else {
      condition.craftMode = raw.craftMode;
    }
  }

  if (
    condition.minItemCount !== undefined &&
    condition.maxItemCount !== undefined &&
    condition.minItemCount > condition.maxItemCount
  ) {
    errors.push('minItemCount 不能大于 maxItemCount');
  }
  if (
    condition.minFoilColorCount !== undefined &&
    condition.maxFoilColorCount !== undefined &&
    condition.minFoilColorCount > condition.maxFoilColorCount
  ) {
    errors.push('minFoilColorCount 不能大于 maxFoilColorCount');
  }

  return errors.length > 0
    ? { condition: null, errors }
    : { condition, errors: [] };
}

function actualFoilColors(input: ExternalSalesQuoteInput): string[] {
  return [
    ...new Set(input.foilColors.filter((color) => color !== NO_FOIL_COLOR)),
  ];
}

function matchesCondition(
  input: ExternalSalesQuoteInput,
  condition: NormalizedCondition,
): boolean {
  if (
    condition.productCodes &&
    (!input.productCode || !condition.productCodes.includes(input.productCode))
  ) {
    return false;
  }
  if (condition.craftCodes) {
    const matches =
      (condition.craftMode ?? 'ANY') === 'ALL'
        ? condition.craftCodes.every((code) => input.craftCodes.includes(code))
        : condition.craftCodes.some((code) => input.craftCodes.includes(code));
    if (!matches) return false;
  }
  if (
    condition.noneOfCraftCodes &&
    condition.noneOfCraftCodes.some((code) => input.craftCodes.includes(code))
  ) {
    return false;
  }
  if (
    condition.anyCraftCodeOutside &&
    !input.craftCodes.some(
      (code) => !condition.anyCraftCodeOutside?.includes(code),
    )
  ) {
    return false;
  }
  if (
    condition.specifications &&
    (!input.specification ||
      !condition.specifications.includes(input.specification))
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
  if (
    condition.foilColorCount !== undefined &&
    condition.foilColorCount !== actualFoilColors(input).length
  ) {
    return false;
  }
  if (
    condition.minFoilColorCount !== undefined &&
    actualFoilColors(input).length < condition.minFoilColorCount
  ) {
    return false;
  }
  if (
    condition.maxFoilColorCount !== undefined &&
    actualFoilColors(input).length > condition.maxFoilColorCount
  ) {
    return false;
  }
  if (
    condition.minItemCount !== undefined &&
    input.orderItemCount < condition.minItemCount
  ) {
    return false;
  }
  if (
    condition.maxItemCount !== undefined &&
    input.orderItemCount > condition.maxItemCount
  ) {
    return false;
  }
  return true;
}

function quantityMatches(
  input: ExternalSalesQuoteInput,
  rule: ExternalSalesPriceRule,
): boolean {
  return !(
    (rule.minQty !== null && input.quantity < rule.minQty) ||
    (rule.maxQty !== null && input.quantity > rule.maxQty)
  );
}

function appliesToProduct(
  input: ExternalSalesQuoteInput,
  rule: ExternalSalesPriceRule,
): boolean {
  return rule.productId === null || rule.productId === input.productId;
}

function parseRuleRate(rule: ExternalSalesPriceRule): Decimal | null {
  if (rule.amount === null) return null;
  try {
    const amount = new Decimal(rule.amount);
    if (
      !amount.isFinite() ||
      amount.isNegative() ||
      amount.decimalPlaces() > 4 ||
      amount.gt(RATE_MAX)
    ) {
      return null;
    }
    return amount;
  } catch {
    return null;
  }
}

type ValidatedRule = {
  rule: ExternalSalesPriceRule;
  condition: NormalizedCondition;
  rate: Decimal | null;
};

function validateRules(rules: ExternalSalesPriceRule[]): {
  rules: ValidatedRule[];
  errors: string[];
} {
  const errors: string[] = [];
  const validated: ValidatedRule[] = [];

  for (const rule of rules) {
    const label = rule.name || rule.code || rule.id;
    if (!RULE_KINDS.has(rule.kind)) {
      errors.push(`报价规则“${label}”类型非法`);
      continue;
    }
    if (
      (rule.minQty !== null &&
        (!Number.isSafeInteger(rule.minQty) || rule.minQty < 1)) ||
      (rule.maxQty !== null &&
        (!Number.isSafeInteger(rule.maxQty) || rule.maxQty < 1)) ||
      (rule.minQty !== null &&
        rule.maxQty !== null &&
        rule.minQty > rule.maxQty)
    ) {
      errors.push(`报价规则“${label}”数量范围非法`);
      continue;
    }
    const parsed = parseCondition(rule.triggerCondition);
    if (!parsed.condition) {
      for (const error of parsed.errors) {
        errors.push(`报价规则“${label}”：${error}`);
      }
      continue;
    }

    if (rule.kind !== 'REFERENCE') {
      if (
        rule.calculationType === null ||
        !CALCULATION_TYPES.has(rule.calculationType)
      ) {
        errors.push(`报价规则“${label}”缺少有效计价方式`);
        continue;
      }
      if (
        rule.calculationType === 'PER_SHEET' &&
        parsed.condition.unitsPerSheet === undefined
      ) {
        errors.push(`报价规则“${label}”按张计价但缺少 unitsPerSheet`);
        continue;
      }
      const rate = parseRuleRate(rule);
      if (!rate) {
        errors.push(`报价规则“${label}”金额非法`);
        continue;
      }
      validated.push({ rule, condition: parsed.condition, rate });
      continue;
    }

    validated.push({ rule, condition: parsed.condition, rate: null });
  }

  return { rules: validated, errors };
}

/**
 * Validate the persisted rule contract without calculating a customer quote.
 *
 * The versioned price-book publisher reuses this function so the admin write
 * path cannot accept trigger fields or calculation combinations that the
 * production quote engine would later reject.
 */
export function validateExternalSalesPriceRules(
  rules: ExternalSalesPriceRule[],
): string[] {
  return validateRules(rules).errors;
}

function calculationUnits(
  input: ExternalSalesQuoteInput,
  rule: ExternalSalesPriceRule,
  condition: NormalizedCondition,
): Decimal {
  const colorMultiplier = condition.perFoilColor
    ? new Decimal(actualFoilColors(input).length)
    : new Decimal(1);
  switch (rule.calculationType) {
    case 'PER_PIECE':
      return new Decimal(input.quantity).times(colorMultiplier);
    case 'PER_SHEET':
      return new Decimal(input.quantity)
        .div(condition.unitsPerSheet as number)
        .ceil()
        .times(colorMultiplier);
    case 'PER_10K':
      return new Decimal(input.quantity).div(10_000).times(colorMultiplier);
    case 'PER_ITEM':
    case 'FIXED_AMOUNT':
      return colorMultiplier;
    case null:
      return new Decimal(0);
  }
}

function componentType(
  calculationType: CustomerPriceCalculationTypeValue,
): QuoteAdjustmentType {
  if (calculationType === 'PER_ITEM') return 'PER_ORDER';
  return calculationType;
}

function snapshotTriggerCondition(
  condition: NormalizedCondition,
): QuoteTriggerCondition {
  return Object.fromEntries(
    Object.entries(condition).filter((entry) => entry[1] !== undefined),
  ) as QuoteTriggerCondition;
}

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function makeComponent(
  input: ExternalSalesQuoteInput,
  validated: ValidatedRule,
): QuoteComponent {
  const { rule, condition, rate } = validated;
  const calculationType = rule.calculationType as CustomerPriceCalculationTypeValue;
  const units = calculationUnits(input, rule, condition);
  const amount = money((rate as Decimal).times(units));
  return {
    source: rule.kind === 'BASE' ? 'BASE' : 'ADJUSTMENT',
    sourceId: rule.id,
    name: rule.name,
    adjustmentType: componentType(calculationType),
    rate: (rate as Decimal).toFixed(4),
    units: units.toString(),
    amount: amount.toFixed(2),
    categoryCode: rule.category.code,
    categoryName: rule.category.name,
    ruleCode: rule.code,
    sourceSheet: rule.sourceSheet,
    sourceRange: rule.sourceRange,
  };
}

function selectAddOns(
  matched: ValidatedRule[],
  errors: string[],
): ValidatedRule[] {
  const selected: ValidatedRule[] = [];
  const grouped = new Map<string, ValidatedRule[]>();

  for (const candidate of matched) {
    const group = candidate.rule.exclusiveGroup?.trim();
    if (!group) {
      selected.push(candidate);
      continue;
    }
    const current = grouped.get(group) ?? [];
    current.push(candidate);
    grouped.set(group, current);
  }

  for (const [group, candidates] of grouped) {
    const highestPriority = Math.max(
      ...candidates.map((candidate) => candidate.rule.priority),
    );
    const winners = candidates.filter(
      (candidate) => candidate.rule.priority === highestPriority,
    );
    if (winners.length !== 1) {
      errors.push(
        `收费规则组“${group}”同时命中多个同优先级规则，请管理员修正规则`,
      );
      continue;
    }
    selected.push(winners[0] as ValidatedRule);
  }

  return selected;
}

export function calculateExternalSalesQuote(args: {
  input: ExternalSalesQuoteInput;
  priceBook: ExternalSalesPriceBook;
  rules: ExternalSalesPriceRule[];
}): QuoteResult {
  const { input, priceBook } = args;
  const errors: string[] = [];

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    errors.push('数量必须是正整数');
  }
  if (!Number.isSafeInteger(input.orderItemCount) || input.orderItemCount < 1) {
    errors.push('工单款式数量非法');
  }

  const validation = validateRules(args.rules);
  errors.push(...validation.errors);

  const matched = validation.rules.filter(
    ({ rule, condition }) =>
      appliesToProduct(input, rule) &&
      quantityMatches(input, rule) &&
      matchesCondition(input, condition),
  );

  const blockingReferences = matched.filter(
    ({ rule }) => rule.kind === 'REFERENCE' && rule.blocksAutomaticQuote,
  );
  for (const { rule } of blockingReferences) {
    errors.push(`需人工报价：${rule.name}${rule.note ? `（${rule.note}）` : ''}`);
  }

  const baseCandidates = matched.filter(({ rule }) => rule.kind === 'BASE');
  let base: ValidatedRule | null = null;
  if (baseCandidates.length === 0) {
    errors.push('报价单未覆盖当前产品、规格、纸张或数量，请联系管理员人工报价');
  } else if (baseCandidates.length > 1) {
    errors.push('同时命中多个基础报价规则，请管理员修正规则后再报价');
  } else {
    base = baseCandidates[0] as ValidatedRule;
  }

  const addOnCandidates = matched.filter(({ rule }) => rule.kind === 'ADD_ON');
  const addOns = selectAddOns(addOnCandidates, errors);
  const appliedRules = base ? [base, ...addOns] : [];
  const components = appliedRules.map((rule) => makeComponent(input, rule));

  // Preserve the workbook's per-piece rate as the suggested unit price.  A
  // quantity of one at ¥0.135 must store unitPrice=0.1350 and subtotal=¥0.14,
  // not silently rewrite the source rate to ¥0.1400.  Non-piece components
  // stay in fixedFee so the persisted order formula remains auditable.
  const perPieceUnit = appliedRules
    .filter(({ rule }) => rule.calculationType === 'PER_PIECE')
    .reduce(
      (sum, { condition, rate }) =>
        sum.plus(
          (rate as Decimal).times(
            condition.perFoilColor
              ? actualFoilColors(input).length
              : 1,
          ),
        ),
      new Decimal(0),
    );
  const fixedSubtotal = components
    .filter((component) => component.adjustmentType !== 'PER_PIECE')
    .reduce((sum, component) => sum.plus(component.amount), new Decimal(0));
  const subtotal = money(perPieceUnit.times(input.quantity)).plus(
    fixedSubtotal,
  );

  let suggestedUnitPrice: string | null = null;
  let suggestedFixedFee: string | null = null;
  let suggestedSubtotal: string | null = null;
  if (errors.length === 0 && base) {
    const unit = perPieceUnit.toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const fixed = money(fixedSubtotal);
    if (unit.gt(UNIT_PRICE_MAX)) {
      errors.push('建议单价超过系统上限 999,999.9999 元');
    }
    if (fixed.gt(SUBTOTAL_MAX) || subtotal.gt(SUBTOTAL_MAX)) {
      errors.push('建议金额超过系统上限 9,999,999,999.99 元');
    }
    if (errors.length === 0) {
      suggestedUnitPrice = unit.toFixed(4);
      suggestedFixedFee = fixed.toFixed(2);
      suggestedSubtotal = subtotal.toFixed(2);
    }
  }

  const complete = errors.length === 0 && base !== null;
  const snapshot: QuoteSnapshot = {
    version: 1,
    priceBook: {
      id: priceBook.id,
      code: priceBook.code,
      name: priceBook.name,
      version: priceBook.version,
      sourceName: priceBook.sourceName,
      sourceSha256: priceBook.sourceSha256,
    },
    input: {
      quantity: input.quantity,
      productId: input.productId,
      productCode: input.productCode,
      craftIds: [...input.craftIds],
      craftCodes: [...input.craftCodes],
      specification: input.specification,
      paperType: input.paperType,
      foilColors: [...input.foilColors],
      isDoubleSided: input.isDoubleSided,
      isDoubleColor: input.isDoubleColor,
      settlementType: input.settlementType,
      orderItemCount: input.orderItemCount,
      baseUnitPrice: null,
      minOrderQty: null,
    },
    base: {
      source: base ? 'CUSTOMER_PRICE_RULE' : 'MISSING',
      sourceId: base?.rule.id ?? null,
      minQty: base?.rule.minQty ?? null,
      unitPrice:
        base?.rule.calculationType === 'PER_PIECE'
          ? (base.rate as Decimal).toFixed(4)
          : null,
    },
    appliedAdjustments: addOns.map(({ rule, condition, rate }) => ({
      id: rule.id,
      name: rule.name,
      adjustmentType: componentType(
        rule.calculationType as CustomerPriceCalculationTypeValue,
      ),
      amount: (rate as Decimal).toFixed(4),
      triggerCondition: snapshotTriggerCondition(condition),
      categoryCode: rule.category.code,
      categoryName: rule.category.name,
      ruleCode: rule.code,
      sourceSheet: rule.sourceSheet,
      sourceRange: rule.sourceRange,
    })),
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
