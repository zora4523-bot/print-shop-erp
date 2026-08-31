import Decimal from 'decimal.js';
import { NO_FOIL_COLOR } from '@/lib/order/foil-colors';
import type {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
} from '@/generated/prisma/client';
import {
  STOCK_LOCAL_FOIL_CRAFT_CODE,
  canonicalizePricingCraftCodes,
  orderItemFoilPassCount,
  resolveOrderItemFoilSides,
} from '@/lib/order/pricing-route';
import {
  parseCustomerRuleCondition,
  type CustomerRuleConditionV1,
} from './customer-rule-condition';
import { externalPriceRuleDisplayName } from './external-price-display';
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
  currency?: string;
  effectiveFrom?: Date | string | null;
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
  paperCatalogMatched: boolean;
  pricingRoute: OrderItemPricingRoute;
  productStructure: OrderProductStructure;
  artworkVersion: string | null;
  plateGroupId: string | null;
  pricingGroup: string | null;
  actualWidthMm: number | null;
  actualHeightMm: number | null;
  paperWeightGsm: number | null;
  catalogSpecification?: string | null;
  catalogPaperType?: string | null;
  catalogSpecificationMatched?: boolean;
  catalogDimensionsMatched?: boolean;
  catalogPaperWeightMatched?: boolean;
  frontFoilColors?: string[];
  backFoilColors?: string[];
  foilColors: string[];
  foilTechnique: OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: OrderLamination;
  printColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  settlementType: string;
  orderItemCount: number;
};

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

function actualFoilColors(input: ExternalSalesQuoteInput): string[] {
  const sides = resolveOrderItemFoilSides(input);
  return [
    ...new Set(
      [...sides.frontFoilColors, ...sides.backFoilColors].filter(
        (color) => color !== NO_FOIL_COLOR,
      ),
    ),
  ];
}

function foilPassCount(input: ExternalSalesQuoteInput): number {
  return orderItemFoilPassCount(input);
}

function matchesCondition(
  input: ExternalSalesQuoteInput,
  condition: CustomerRuleConditionV1,
  options: { productBound: boolean },
): boolean {
  const inputCraftCodes = canonicalizePricingCraftCodes(input.craftCodes);
  if (condition.target !== 'ITEM') return false;
  if (
    !options.productBound &&
    condition.productCodes &&
    (!input.productCode || !condition.productCodes.includes(input.productCode))
  ) {
    return false;
  }
  if (condition.craftCodes) {
    const conditionCraftCodes = canonicalizePricingCraftCodes(
      condition.craftCodes,
    );
    const matches =
      (condition.craftMode ?? 'ANY') === 'ALL'
        ? conditionCraftCodes.every((code) => inputCraftCodes.includes(code))
        : conditionCraftCodes.some((code) => inputCraftCodes.includes(code));
    if (!matches) return false;
  }
  if (
    condition.noneOfCraftCodes &&
    canonicalizePricingCraftCodes(condition.noneOfCraftCodes).some((code) =>
      inputCraftCodes.includes(code),
    )
  ) {
    return false;
  }
  if (
    condition.anyCraftCodeOutside &&
    !inputCraftCodes.some(
      (code) =>
        !canonicalizePricingCraftCodes(
          condition.anyCraftCodeOutside ?? [],
        ).includes(code),
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
    condition.pricingRoutes &&
    !condition.pricingRoutes.includes(input.pricingRoute)
  ) {
    return false;
  }
  if (
    condition.productStructures &&
    !condition.productStructures.includes(input.productStructure)
  ) {
    return false;
  }
  if (
    condition.foilTechniques &&
    !condition.foilTechniques.includes(input.foilTechnique)
  ) {
    return false;
  }
  if (
    condition.laminations &&
    !condition.laminations.includes(input.lamination)
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
    condition.hasLocalFoil !== undefined &&
    condition.hasLocalFoil !== input.hasLocalFoil
  ) {
    return false;
  }
  if (
    condition.printColors &&
    !condition.printColors.some((color) => input.printColors.includes(color))
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
    condition.foilPassCount !== undefined &&
    condition.foilPassCount !== foilPassCount(input)
  ) {
    return false;
  }
  if (
    condition.minFoilPassCount !== undefined &&
    foilPassCount(input) < condition.minFoilPassCount
  ) {
    return false;
  }
  if (
    condition.maxFoilPassCount !== undefined &&
    foilPassCount(input) > condition.maxFoilPassCount
  ) {
    return false;
  }
  if (
    condition.printColorCount !== undefined &&
    condition.printColorCount !== input.printColors.length
  ) {
    return false;
  }
  if (
    condition.minPrintColorCount !== undefined &&
    input.printColors.length < condition.minPrintColorCount
  ) {
    return false;
  }
  if (
    condition.maxPrintColorCount !== undefined &&
    input.printColors.length > condition.maxPrintColorCount
  ) {
    return false;
  }
  for (const [value, minimum, maximum] of [
    [input.actualWidthMm, condition.minWidthMm, condition.maxWidthMm],
    [input.actualHeightMm, condition.minHeightMm, condition.maxHeightMm],
    [
      input.paperWeightGsm,
      condition.minPaperWeightGsm,
      condition.maxPaperWeightGsm,
    ],
  ] as const) {
    if (minimum !== undefined && (value === null || value < minimum)) {
      return false;
    }
    if (maximum !== undefined && (value === null || value > maximum)) {
      return false;
    }
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
  condition: CustomerRuleConditionV1;
  rate: Decimal | null;
};

function validateRules(rules: ExternalSalesPriceRule[]): {
  rules: ValidatedRule[];
  errors: string[];
} {
  const errors: string[] = [];
  const validated: ValidatedRule[] = [];

  for (const rule of rules) {
    const label = externalPriceRuleDisplayName(rule.name);
    if (!RULE_KINDS.has(rule.kind)) {
      errors.push(`收费项目“${label}”的类型设置无效`);
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
      errors.push(`收费项目“${label}”的数量范围设置无效`);
      continue;
    }
    const parsed = parseCustomerRuleCondition(rule.triggerCondition);
    if (!parsed.condition) {
      for (const error of parsed.errors) {
        errors.push(`收费项目“${label}”：${error}`);
      }
      continue;
    }

    if (rule.kind !== 'REFERENCE') {
      if (
        rule.calculationType === null ||
        !CALCULATION_TYPES.has(rule.calculationType)
      ) {
        errors.push(`收费项目“${label}”缺少有效计价方式`);
        continue;
      }
      if (
        rule.calculationType === 'PER_SHEET' &&
        parsed.condition.unitsPerSheet === undefined
      ) {
        errors.push(`收费项目“${label}”按张计价但未填写每张成品数`);
        continue;
      }
      const rate = parseRuleRate(rule);
      if (!rate) {
        errors.push(`收费项目“${label}”的金额设置无效`);
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
  condition: CustomerRuleConditionV1,
): Decimal {
  const foilMultiplier = condition.perFoilColor
    ? new Decimal(actualFoilColors(input).length)
    : new Decimal(1);
  const foilPassMultiplier = condition.perFoilPass
    ? new Decimal(foilPassCount(input))
    : new Decimal(1);
  const printMultiplier = condition.perPrintColor
    ? new Decimal(input.printColors.length)
    : new Decimal(1);
  const colorMultiplier = foilMultiplier
    .times(foilPassMultiplier)
    .times(printMultiplier);
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
  condition: CustomerRuleConditionV1,
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
    name: externalPriceRuleDisplayName(rule.name),
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

  for (const candidates of grouped.values()) {
    const highestPriority = Math.max(
      ...candidates.map((candidate) => candidate.rule.priority),
    );
    const winners = candidates.filter(
      (candidate) => candidate.rule.priority === highestPriority,
    );
    if (winners.length !== 1) {
      const names = [
        ...new Set(
          winners.map(({ rule }) => externalPriceRuleDisplayName(rule.name)),
        ),
      ]
        .filter(Boolean)
        .map((name) => `“${name}”`)
        .join('、');
      errors.push(
        `${names || '多个收费项目'}在同一适用范围和顺序下同时命中，请管理员修正后再报价`,
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
  quotedAt?: Date;
}): QuoteResult {
  const { input, priceBook } = args;
  const errors: string[] = [];
  const sides = resolveOrderItemFoilSides(input);

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    errors.push('数量必须是正整数');
  }
  if (!Number.isSafeInteger(input.orderItemCount) || input.orderItemCount < 1) {
    errors.push('工单款式数量非法');
  }
  if (input.pricingRoute === 'MANUAL_QUOTE') {
    errors.push('本款式使用历史人工路线，需管理员填写终价');
  } else {
    if (!input.paperCatalogMatched) {
      errors.push(
        '自定义纸张或纸张已不在有效字典，需管理员填写终价',
      );
    }
    if (input.productStructure === 'UNSPECIFIED') {
      errors.push('未明确产品结构，不能自动计价');
    }
    if (input.foilTechnique === 'UNSPECIFIED') {
      errors.push('未明确烫金方式，不能自动计价');
    }
    if (actualFoilColors(input).length > 0 && input.hasLocalFoil === null) {
      errors.push('未明确是否局部烫金，不能自动计价');
    }
    if (
      input.pricingRoute === 'CUSTOM_SINGLE_FLAT_FOIL' ||
      input.pricingRoute === 'COLOR_PRINT'
    ) {
      if (input.actualWidthMm === null || input.actualHeightMm === null) {
        errors.push('专版/彩印自动计价必须填写实际宽度和高度');
      }
      if (input.paperWeightGsm === null) {
        errors.push('专版/彩印自动计价必须填写纸张克重');
      }
      if (input.catalogSpecificationMatched === false) {
        errors.push('MANUAL_PRICING_REQUIRED：所选规格与报价 SKU 不一致');
      }
      if (input.catalogDimensionsMatched === false) {
        errors.push('MANUAL_PRICING_REQUIRED：实际尺寸不是报价 SKU 的标准尺寸');
      }
      if (input.catalogPaperWeightMatched === false) {
        errors.push('MANUAL_PRICING_REQUIRED：纸张克重为手工值或与纸张字典不一致');
      }
    }
    if (
      input.craftCodes.includes('EMBOSS') &&
      input.craftCodes.includes('BUMP')
    ) {
      errors.push('浮雕与激凸只能选择一种');
    }
    if (input.pricingRoute === 'COLOR_PRINT' && input.printColors.length === 0) {
      errors.push('彩印自动计价必须填写彩印颜色');
    }
    if (
      input.pricingRoute !== 'COLOR_PRINT' &&
      input.lamination !== 'NONE'
    ) {
      errors.push('非彩印款式的覆膜方式必须为“无覆膜”');
    }
    if (input.pricingRoute === 'COLOR_PRINT') {
      const foilColorCount = actualFoilColors(input).length;
      if (foilColorCount === 0) {
        if (input.foilTechnique !== 'NONE') {
          errors.push('纯彩印未选烫金颜色时，烫金方式必须为“无烫金”');
        }
        if (input.hasLocalFoil !== false) {
          errors.push('纯彩印未选烫金颜色时，不能标记局部烫金');
        }
      } else {
        if (input.foilTechnique === 'NONE') {
          errors.push('彩印加烫金时必须选择烫金方式');
        }
      }
    }
    if (input.pricingRoute === 'STOCK_BLANK') {
      const normalizedCraftCodes = canonicalizePricingCraftCodes(
        input.craftCodes,
      );
      if (!normalizedCraftCodes.includes(STOCK_LOCAL_FOIL_CRAFT_CODE)) {
        errors.push('通版现货局部烫金必须选择“局部烫金”工艺');
      }
      if (input.hasLocalFoil !== true) {
        errors.push('通版现货路线必须明确为局部烫金');
      }
    }
  }

  const itemRules = args.rules.filter((rule) => {
    const parsed = parseCustomerRuleCondition(rule.triggerCondition);
    return parsed.condition?.target !== 'PACKAGING_GROUP';
  });
  const validation = validateRules(itemRules);
  errors.push(...validation.errors);

  const matched = validation.rules.filter(
    ({ rule, condition }) =>
      appliesToProduct(input, rule) &&
      quantityMatches(input, rule) &&
      matchesCondition(input, condition, {
        productBound: rule.productId !== null,
      }),
  );

  const blockingReferences = matched.filter(
    ({ rule }) => rule.kind === 'REFERENCE' && rule.blocksAutomaticQuote,
  );
  for (const { rule } of blockingReferences) {
    errors.push(
      `需人工报价：${externalPriceRuleDisplayName(rule.name)}${
        rule.note ? `（${rule.note}）` : ''
      }`,
    );
  }

  const routeAwareBaseCandidates = matched.filter(
    ({ rule, condition }) =>
      rule.kind === 'BASE' &&
      condition.pricingRoutes?.includes(input.pricingRoute),
  );
  const matchedBaseWithoutRoute = matched.some(
    ({ rule, condition }) =>
      rule.kind === 'BASE' && !condition.pricingRoutes,
  );
  if (routeAwareBaseCandidates.length === 0 && matchedBaseWithoutRoute) {
    errors.push('命中的基础报价未选择适用计价路线，需管理员补全后再报价');
  }
  const baseCandidates = routeAwareBaseCandidates;
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
          )
            .times(condition.perFoilPass ? foilPassCount(input) : 1)
            .times(condition.perPrintColor ? input.printColors.length : 1),
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
    quotedAt: (args.quotedAt ?? new Date()).toISOString(),
    priceBook: {
      id: priceBook.id,
      code: priceBook.code,
      name: priceBook.name,
      version: priceBook.version,
      currency: priceBook.currency ?? 'CNY',
      effectiveFrom:
        priceBook.effectiveFrom instanceof Date
          ? priceBook.effectiveFrom.toISOString()
          : priceBook.effectiveFrom ?? null,
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
      pricingRoute: input.pricingRoute,
      productStructure: input.productStructure,
      artworkVersion: input.artworkVersion,
      plateGroupId: input.plateGroupId,
      pricingGroup: input.pricingGroup,
      actualWidthMm: input.actualWidthMm,
      actualHeightMm: input.actualHeightMm,
      paperWeightGsm: input.paperWeightGsm,
      catalogSpecification: input.catalogSpecification ?? null,
      catalogPaperType: input.catalogPaperType ?? null,
      catalogSpecificationMatched:
        input.catalogSpecificationMatched ?? null,
      catalogDimensionsMatched: input.catalogDimensionsMatched ?? null,
      catalogPaperWeightMatched: input.catalogPaperWeightMatched ?? null,
      frontFoilColors: [...sides.frontFoilColors],
      backFoilColors: [...sides.backFoilColors],
      foilPassCount: foilPassCount(input),
      foilColors: [...input.foilColors],
      foilTechnique: input.foilTechnique,
      hasLocalFoil: input.hasLocalFoil,
      lamination: input.lamination,
      printColors: [...input.printColors],
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
      name: externalPriceRuleDisplayName(rule.name),
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
