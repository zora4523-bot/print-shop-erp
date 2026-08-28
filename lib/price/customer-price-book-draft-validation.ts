import Decimal from 'decimal.js';
import { MAX_ORDER_ITEM_FOIL_COLORS } from '../order/foil-colors';
import {
  MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE,
  isNewOrderPricingRoute,
} from '../order/pricing-route';
import { MAX_ORDER_ITEM_PRINT_COLORS } from '../order/print-colors';
import { productCategoryMatchesPricingRoute } from '../order/pricing-route';
import {
  EXTERNAL_ORDER_CHARGE_MONEY_MAX,
  normalizeZtoProvince,
} from './external-order-charges';
import type {
  ExternalSalesPriceRuleForValidation,
} from './external-sales-rule-validation';
import {
  EXTERNAL_SALES_PRICE_LIMITS,
  validateExternalSalesPriceRules,
} from './external-sales-rule-validation';
import { externalPriceBusinessText } from './external-price-display';
import { parseCustomerRuleCondition } from './customer-rule-condition';

export type DraftPriceBookPurpose = 'PROCESSING' | 'LOGISTICS';

export type DraftPriceRuleForValidation = {
  id: string;
  code: string;
  name: string;
  kind: string;
  calculationType: string | null;
  amount: unknown;
  includedUnits: unknown;
  incrementUnits: unknown;
  incrementAmount: unknown;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  priority: number;
  blocksAutomaticQuote: boolean;
  sourceSheet: string | null;
  sourceRange: string | null;
  sourceName: string | null;
  sourceSha256: string | null;
  note: string | null;
  productId: string | null;
  isActive: boolean;
  category: {
    code: string;
    name: string;
    isActive: boolean;
  };
  product: {
    code: string;
    category: string;
    isActive: boolean;
  } | null;
};

export type DraftPriceBookValidationIssue = {
  path: string;
  message: string;
  ruleId?: string;
};

const RATE_MAX = new Decimal('9999999999.9999');
const UNIT_MAX = new Decimal('9999999.999');
const QUANTITY_MAX = 9_999_999;
const PRIORITY_MAX = 2_147_483_647;
const PROCESSING_UNIT_PRICE_MAX = new Decimal(
  EXTERNAL_SALES_PRICE_LIMITS.unitPrice,
);
const PROCESSING_SUBTOTAL_MAX = new Decimal(
  EXTERNAL_SALES_PRICE_LIMITS.subtotal,
);
const LOGISTICS_MONEY_MAX = new Decimal(EXTERNAL_ORDER_CHARGE_MONEY_MAX);
const LOGISTICS_WEIGHT_MAX = new Decimal('9999999.999');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function decimal(
  value: unknown,
  options: {
    label: string;
    maximum: Decimal;
    decimalPlaces: number;
    positive?: boolean;
    nullable?: boolean;
  },
): string | null {
  if (value === null || value === undefined) {
    return options.nullable ? null : `${options.label}不能为空`;
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    return `${options.label}格式非法`;
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    (options.positive && !parsed.gt(0)) ||
    parsed.gt(options.maximum) ||
    parsed.decimalPlaces() > options.decimalPlaces
  ) {
    return `${options.label}必须是${options.positive ? '大于 0 的' : '非负'}数字，最多 ${
      options.decimalPlaces
    } 位小数且不能超过 ${options.maximum.toFixed(options.decimalPlaces)}`;
  }
  return null;
}

function parsedDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function rangeOverlaps(
  aMin: number | null,
  aMax: number | null,
  bMin: number | null,
  bMax: number | null,
): boolean {
  const left = Math.max(aMin ?? 1, bMin ?? 1);
  const right = Math.min(aMax ?? QUANTITY_MAX, bMax ?? QUANTITY_MAX);
  return left <= right;
}

function numberRangeFromCondition(
  condition: Record<string, unknown>,
  exactKey: string,
  minKey: string,
  maxKey: string,
): [number, number] {
  const exact = condition[exactKey];
  if (Number.isSafeInteger(exact) && Number(exact) >= 0) {
    return [Number(exact), Number(exact)];
  }
  const min = condition[minKey];
  const max = condition[maxKey];
  return [
    Number.isSafeInteger(min) && Number(min) >= 0 ? Number(min) : 0,
    Number.isSafeInteger(max) && Number(max) >= 0
      ? Number(max)
      : Number.MAX_SAFE_INTEGER,
  ];
}

function arraysAreDisjoint(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const left = new Set(a.filter((value): value is string => typeof value === 'string'));
  const right = new Set(b.filter((value): value is string => typeof value === 'string'));
  return left.size > 0 && right.size > 0 && [...left].every((value) => !right.has(value));
}

/**
 * Return false only when two rule conditions are provably disjoint. Unknown
 * combinations stay conservative and are treated as potentially overlapping.
 */
function conditionsCanOverlap(aRaw: unknown, bRaw: unknown): boolean {
  const a = isRecord(aRaw) ? aRaw : {};
  const b = isRecord(bRaw) ? bRaw : {};

  for (const key of [
    'productCodes',
    'specifications',
    'paperTypes',
    'laminations',
  ] as const) {
    if (arraysAreDisjoint(a[key], b[key])) return false;
  }
  for (const key of ['isDoubleSided', 'isDoubleColor'] as const) {
    if (
      typeof a[key] === 'boolean' &&
      typeof b[key] === 'boolean' &&
      a[key] !== b[key]
    ) {
      return false;
    }
  }

  const [aColorMin, aColorMax] = numberRangeFromCondition(
    a,
    'foilColorCount',
    'minFoilColorCount',
    'maxFoilColorCount',
  );
  const [bColorMin, bColorMax] = numberRangeFromCondition(
    b,
    'foilColorCount',
    'minFoilColorCount',
    'maxFoilColorCount',
  );
  if (Math.max(aColorMin, bColorMin) > Math.min(aColorMax, bColorMax)) {
    return false;
  }

  const [aPassMin, aPassMax] = numberRangeFromCondition(
    a,
    'foilPassCount',
    'minFoilPassCount',
    'maxFoilPassCount',
  );
  const [bPassMin, bPassMax] = numberRangeFromCondition(
    b,
    'foilPassCount',
    'minFoilPassCount',
    'maxFoilPassCount',
  );
  if (Math.max(aPassMin, bPassMin) > Math.min(aPassMax, bPassMax)) {
    return false;
  }

  const [aItemMin, aItemMax] = numberRangeFromCondition(
    a,
    '__never_exact_item_count__',
    'minItemCount',
    'maxItemCount',
  );
  const [bItemMin, bItemMax] = numberRangeFromCondition(
    b,
    '__never_exact_item_count__',
    'minItemCount',
    'maxItemCount',
  );
  return Math.max(aItemMin, bItemMin) <= Math.min(aItemMax, bItemMax);
}

function commonRuleIssues(
  rules: DraftPriceRuleForValidation[],
): DraftPriceBookValidationIssue[] {
  const issues: DraftPriceBookValidationIssue[] = [];
  const seenCodes = new Map<string, DraftPriceRuleForValidation>();

  for (const rule of rules) {
    const prefix = `rules.${rule.id}`;
    const code = rule.code.trim().toLocaleLowerCase('en-US');
    const previous = seenCodes.get(code);
    if (previous) {
      issues.push({
        path: `${prefix}.code`,
        ruleId: rule.id,
        message: `收费项目与“${previous.name}”重复，请检查后再发布`,
      });
    } else {
      seenCodes.set(code, rule);
    }
    if (!rule.name.trim()) {
      issues.push({ path: `${prefix}.name`, ruleId: rule.id, message: '收费项目名称不能为空' });
    }
    if (!rule.category.isActive) {
      issues.push({
        path: `${prefix}.categoryId`,
        ruleId: rule.id,
        message: `收费类目“${rule.category.name}”已停用`,
      });
    }
    if (rule.product && !rule.product.isActive) {
      issues.push({
        path: `${prefix}.productId`,
        ruleId: rule.id,
        message: '收费项目所选产品已停用',
      });
    }
    if (
      !Number.isSafeInteger(rule.priority) ||
      rule.priority < 0 ||
      rule.priority > PRIORITY_MAX
    ) {
      issues.push({
        path: `${prefix}.priority`,
        ruleId: rule.id,
        message: '应用顺序必须是非负整数',
      });
    }
    if (
      (rule.minQty !== null &&
        (!Number.isSafeInteger(rule.minQty) ||
          rule.minQty < 1 ||
          rule.minQty > QUANTITY_MAX)) ||
      (rule.maxQty !== null &&
        (!Number.isSafeInteger(rule.maxQty) ||
          rule.maxQty < 1 ||
          rule.maxQty > QUANTITY_MAX)) ||
      (rule.minQty !== null &&
        rule.maxQty !== null &&
        rule.minQty > rule.maxQty)
    ) {
      issues.push({
        path: `${prefix}.minQty`,
        ruleId: rule.id,
        message: '数量区间非法',
      });
    }

    const amountError = decimal(rule.amount, {
      label: '金额',
      maximum: RATE_MAX,
      decimalPlaces: 4,
      nullable: true,
    });
    if (amountError) {
      issues.push({ path: `${prefix}.amount`, ruleId: rule.id, message: amountError });
    }
    for (const [field, label, value, positive] of [
      ['includedUnits', '首重单位', rule.includedUnits, true],
      ['incrementUnits', '续重单位', rule.incrementUnits, true],
      ['incrementAmount', '续重金额', rule.incrementAmount, false],
    ] as const) {
      const error = decimal(value, {
        label,
        maximum: field === 'incrementAmount' ? RATE_MAX : UNIT_MAX,
        decimalPlaces: field === 'incrementAmount' ? 4 : 3,
        positive,
        nullable: true,
      });
      if (error) {
        issues.push({ path: `${prefix}.${field}`, ruleId: rule.id, message: error });
      }
    }
  }

  return issues;
}

function processingColorMultiplier(rule: DraftPriceRuleForValidation): Decimal {
  const condition = isRecord(rule.triggerCondition)
    ? rule.triggerCondition
    : {};
  return colorDimensionMultiplier({
    enabled: condition.perFoilColor === true,
    exact: condition.foilColorCount,
    maximum: condition.maxFoilColorCount,
    absoluteMaximum: MAX_ORDER_ITEM_FOIL_COLORS,
  })
    .times(
      colorDimensionMultiplier({
        enabled: condition.perFoilPass === true,
        exact: condition.foilPassCount,
        maximum: condition.maxFoilPassCount,
        absoluteMaximum: MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE * 2,
      }),
    )
    .times(
      colorDimensionMultiplier({
      enabled: condition.perPrintColor === true,
      exact: condition.printColorCount,
      maximum: condition.maxPrintColorCount,
      absoluteMaximum: MAX_ORDER_ITEM_PRINT_COLORS,
      }),
    );
}

function colorDimensionMultiplier({
  enabled,
  exact,
  maximum,
  absoluteMaximum,
}: {
  enabled: boolean;
  exact: unknown;
  maximum: unknown;
  absoluteMaximum: number;
}): Decimal {
  if (!enabled) return new Decimal(1);
  if (Number.isSafeInteger(exact) && Number(exact) >= 0) {
    return new Decimal(Number(exact));
  }
  if (Number.isSafeInteger(maximum) && Number(maximum) >= 0) {
    return new Decimal(Number(maximum));
  }
  return new Decimal(absoluteMaximum);
}

function maximumProcessingComponent(
  rule: DraftPriceRuleForValidation,
  maximumQuantity: number = rule.maxQty ?? QUANTITY_MAX,
): Decimal | null {
  const amount = parsedDecimal(rule.amount);
  if (!amount || !rule.calculationType) return null;
  const quantity = new Decimal(maximumQuantity);
  const condition = isRecord(rule.triggerCondition)
    ? rule.triggerCondition
    : {};
  const colorMultiplier = processingColorMultiplier(rule);
  switch (rule.calculationType) {
    case 'PER_PIECE':
      return amount.times(quantity).times(colorMultiplier);
    case 'PER_SHEET': {
      const unitsPerSheet = condition.unitsPerSheet;
      if (!Number.isSafeInteger(unitsPerSheet) || Number(unitsPerSheet) < 1) {
        return null;
      }
      return amount
        .times(quantity.div(Number(unitsPerSheet)).ceil())
        .times(colorMultiplier);
    }
    case 'PER_10K':
      return amount.times(quantity.div(10_000)).times(colorMultiplier);
    case 'PER_ITEM':
    case 'FIXED_AMOUNT':
      return amount.times(colorMultiplier);
    default:
      return null;
  }
}

function unconditionalAddOnCanApplyToBase(
  base: DraftPriceRuleForValidation,
  addOn: DraftPriceRuleForValidation,
): boolean {
  const baseMin = base.minQty ?? 1;
  const baseMax = base.maxQty ?? QUANTITY_MAX;
  const addOnMin = addOn.minQty ?? 1;
  const addOnMax = addOn.maxQty ?? QUANTITY_MAX;
  const condition = isRecord(addOn.triggerCondition)
    ? addOn.triggerCondition
    : {};
  const baseCondition = isRecord(base.triggerCondition)
    ? base.triggerCondition
    : {};
  const baseProductCodes = baseCondition.productCodes;
  const productScopesOverlap =
    addOn.productId === null ||
    base.productId === addOn.productId ||
    (base.productId === null &&
      (!Array.isArray(baseProductCodes) ||
        !addOn.product ||
        baseProductCodes.includes(addOn.product.code)));
  return (
    productScopesOverlap &&
    rangeOverlaps(baseMin, baseMax, addOnMin, addOnMax) &&
    Object.keys(condition).length === 0
  );
}

function processingQuantitySamples(
  base: DraftPriceRuleForValidation,
  addOns: DraftPriceRuleForValidation[],
): number[] {
  const baseMin = base.minQty ?? 1;
  const baseMax = base.maxQty ?? QUANTITY_MAX;
  const points = new Set<number>([baseMin, baseMax]);
  for (const addOn of addOns) {
    const intersectionMin = Math.max(baseMin, addOn.minQty ?? 1);
    const intersectionMax = Math.min(
      baseMax,
      addOn.maxQty ?? QUANTITY_MAX,
    );
    points.add(intersectionMin);
    points.add(intersectionMax);
    if (intersectionMin > baseMin) points.add(intersectionMin - 1);
    if (intersectionMax < baseMax) points.add(intersectionMax + 1);
  }
  return [...points].sort((left, right) => left - right);
}

function processingProductScenarios(
  base: DraftPriceRuleForValidation,
  addOns: DraftPriceRuleForValidation[],
): Array<string | null> {
  if (base.productId !== null) return [base.productId];
  return [
    null,
    ...new Set(
      addOns
        .map((addOn) => addOn.productId)
        .filter((productId): productId is string => productId !== null),
    ),
  ];
}

/**
 * Catch combinations that are statically certain to be charged together.
 *
 * General trigger-condition satisfiability is intentionally not guessed here:
 * arrays such as crafts and foil colors can overlap in non-obvious ways. We do
 * prove the common high-risk case—unconditional add-ons over every quantity
 * sub-interval that intersects a BASE—and mirror exclusive-group winner rules.
 * Sampling both sides of every inclusive range boundary is sufficient because
 * every supported calculation is non-decreasing while the matching set is
 * unchanged.
 */
function processingAggregateIssues(
  active: DraftPriceRuleForValidation[],
): DraftPriceBookValidationIssue[] {
  const issues: DraftPriceBookValidationIssue[] = [];
  const bases = active.filter((rule) => rule.kind === 'BASE');
  const addOns = active.filter((rule) => rule.kind === 'ADD_ON');
  for (const base of bases) {
    const candidates = addOns.filter((addOn) =>
      unconditionalAddOnCanApplyToBase(base, addOn),
    );
    const quantities = processingQuantitySamples(base, candidates);
    let overflows = false;
    for (const productId of processingProductScenarios(base, candidates)) {
      for (const quantity of quantities) {
        const baseAmount = maximumProcessingComponent(base, quantity);
        if (!baseAmount) continue;
        const matched = candidates.filter(
          (addOn) =>
            (addOn.productId === null || addOn.productId === productId) &&
            quantity >= (addOn.minQty ?? 1) &&
            quantity <= (addOn.maxQty ?? QUANTITY_MAX),
        );
        const ungrouped = matched.filter(
          (addOn) => !addOn.exclusiveGroup?.trim(),
        );
        let aggregate = ungrouped.reduce(
          (sum, addOn) =>
            sum.plus(maximumProcessingComponent(addOn, quantity) ?? 0),
          baseAmount,
        );
        const groups = new Map<string, DraftPriceRuleForValidation[]>();
        for (const addOn of matched) {
          const group = addOn.exclusiveGroup?.trim();
          if (!group) continue;
          const groupCandidates = groups.get(group) ?? [];
          groupCandidates.push(addOn);
          groups.set(group, groupCandidates);
        }
        for (const groupCandidates of groups.values()) {
          const highestPriority = Math.max(
            ...groupCandidates.map((candidate) => candidate.priority),
          );
          const winnerAmounts = groupCandidates
            .filter((candidate) => candidate.priority === highestPriority)
            .map((candidate) =>
              maximumProcessingComponent(candidate, quantity),
            )
            .filter((amount): amount is Decimal => amount !== null);
          if (winnerAmounts.length > 0) {
            aggregate = aggregate.plus(Decimal.max(...winnerAmounts));
          }
        }
        if (aggregate.gt(PROCESSING_SUBTOTAL_MAX)) {
          overflows = true;
          break;
        }
      }
      if (overflows) break;
    }
    if (overflows) {
      issues.push({
        path: `rules.${base.id}.amount`,
        ruleId: base.id,
        message: `基础报价“${base.name}”与必然叠加收费合计超过款式可保存上限 ${EXTERNAL_SALES_PRICE_LIMITS.subtotal} 元`,
      });
    }
  }
  return issues;
}

function processingIssues(
  rules: DraftPriceRuleForValidation[],
): DraftPriceBookValidationIssue[] {
  const issues: DraftPriceBookValidationIssue[] = [];
  for (const rule of rules) {
    const condition = parseCustomerRuleCondition(rule.triggerCondition).condition;
    if (
      condition?.target === 'ITEM' &&
      condition.pricingRoutes?.some(
        (route) => !isNewOrderPricingRoute(route),
      )
    ) {
      issues.push({
        path: `rules.${rule.id}.triggerCondition`,
        ruleId: rule.id,
        message:
          '新规则只允许局部烫金（通版现货）、专版烫金或彩印三条计价路线',
      });
    }
  }
  const active = rules.filter((rule) => rule.isActive);
  const itemRules: DraftPriceRuleForValidation[] = [];
  const packagingGroupRules: Array<{
    rule: DraftPriceRuleForValidation;
    modes: string[];
  }> = [];
  for (const rule of active) {
    const parsedCondition = parseCustomerRuleCondition(rule.triggerCondition);
    if (!parsedCondition.condition) {
      for (const error of parsedCondition.errors) {
        issues.push({
          path: `rules.${rule.id}.triggerCondition`,
          ruleId: rule.id,
          message: `适用条件非法：${error}`,
        });
      }
    } else if (parsedCondition.condition.target === 'ITEM') {
      itemRules.push(rule);
      if (!parsedCondition.condition.pricingRoutes?.length) {
        issues.push({
          path: `rules.${rule.id}.triggerCondition`,
          ruleId: rule.id,
          message: '款式规则必须明确至少一条适用计价路线',
        });
      }
      if (rule.calculationType === 'PER_BAG') {
        issues.push({
          path: `rules.${rule.id}.calculationType`,
          ruleId: rule.id,
          message: '款式规则不能使用按袋计价',
        });
      }
      if (
        rule.product &&
        parsedCondition.condition.pricingRoutes?.some(
          (route) =>
            !productCategoryMatchesPricingRoute(
              route,
              rule.product!.category,
            ),
        )
      ) {
        issues.push({
          path: `rules.${rule.id}.triggerCondition`,
          ruleId: rule.id,
          message: '所选报价产品的分类与适用计价路线不一致',
        });
      }
    } else {
      packagingGroupRules.push({
        rule,
        modes: parsedCondition.condition.packagingModes ?? [],
      });
      if (rule.productId !== null) {
        issues.push({
          path: `rules.${rule.id}.productId`,
          ruleId: rule.id,
          message: '包装组规则必须使用通用产品',
        });
      }
      if (
        rule.kind !== 'ADD_ON' ||
        rule.calculationType !== 'PER_BAG' ||
        rule.blocksAutomaticQuote
      ) {
        issues.push({
          path: `rules.${rule.id}.calculationType`,
          ruleId: rule.id,
          message: '包装组收费必须按实际袋数自动计价',
        });
      }
      if (rule.category.code !== 'PACKING') {
        issues.push({
          path: `rules.${rule.id}.categoryId`,
          ruleId: rule.id,
          message: '包装组规则必须使用“入袋与包装”类目',
        });
      }
      if (rule.minQty !== null || rule.maxQty !== null) {
        issues.push({
          path: `rules.${rule.id}.minQty`,
          ruleId: rule.id,
          message: '包装组规则直接按实际袋数乘算，不能混用款式数量区间',
        });
      }
      if (rule.exclusiveGroup !== 'PACKAGING_GROUP_MODE') {
        issues.push({
          path: `rules.${rule.id}.exclusiveGroup`,
          ruleId: rule.id,
          message: '包装组的包装方式设置不完整，请重新选择',
        });
      }
      const amount = parsedDecimal(rule.amount);
      if (amount?.times(QUANTITY_MAX).gt(PROCESSING_SUBTOTAL_MAX)) {
        issues.push({
          path: `rules.${rule.id}.amount`,
          ruleId: rule.id,
          message: `按最大实际袋数计算时超过可保存上限 ${EXTERNAL_SALES_PRICE_LIMITS.subtotal} 元`,
        });
      }
    }
    if (['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(rule.category.code)) {
      issues.push({
        path: `rules.${rule.id}.categoryId`,
        ruleId: rule.id,
        message: `加工费价目簿不能使用物流专属类目“${rule.category.name}”`,
      });
    }
    if (rule.productId !== null) {
      const condition = isRecord(rule.triggerCondition)
        ? rule.triggerCondition
        : null;
      const productCodes = condition?.productCodes;
      if (
        Array.isArray(productCodes) &&
        rule.product &&
        !productCodes.includes(rule.product.code)
      ) {
        issues.push({
          path: `rules.${rule.id}.triggerCondition`,
          ruleId: rule.id,
          message: '所选报价产品与适用范围不一致，请重新选择产品',
        });
      }
    }
    const amount = parsedDecimal(rule.amount);
    if (rule.calculationType === 'PER_PIECE' && amount) {
      const unitContribution = amount.times(processingColorMultiplier(rule));
      if (unitContribution.gt(PROCESSING_UNIT_PRICE_MAX)) {
        issues.push({
          path: `rules.${rule.id}.amount`,
          ruleId: rule.id,
          message: `按个单价超过工单可保存上限 ${EXTERNAL_SALES_PRICE_LIMITS.unitPrice} 元`,
        });
      }
    }
    const maximumComponent = maximumProcessingComponent(rule);
    if (maximumComponent?.gt(PROCESSING_SUBTOTAL_MAX)) {
      issues.push({
        path: `rules.${rule.id}.amount`,
        ruleId: rule.id,
        message: `收费项目在数量上限处的金额超过款式可保存上限 ${EXTERNAL_SALES_PRICE_LIMITS.subtotal} 元`,
      });
    }
  }
  const engineErrors = validateExternalSalesPriceRules(
    itemRules.map(
      (rule): ExternalSalesPriceRuleForValidation => ({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        kind: rule.kind as ExternalSalesPriceRuleForValidation['kind'],
        calculationType:
          rule.calculationType as ExternalSalesPriceRuleForValidation['calculationType'],
        amount: rule.amount === null ? null : String(rule.amount),
        minQty: rule.minQty,
        maxQty: rule.maxQty,
        triggerCondition: rule.triggerCondition,
        exclusiveGroup: rule.exclusiveGroup,
        priority: rule.priority,
        blocksAutomaticQuote: rule.blocksAutomaticQuote,
        sourceSheet: rule.sourceSheet,
        sourceRange: rule.sourceRange,
        note: rule.note,
        productId: rule.productId,
        category: {
          code: rule.category.code,
          name: rule.category.name,
        },
      }),
    ),
  );
  issues.push(
    ...engineErrors.map((message) => ({ path: 'rules', message })),
  );
  issues.push(...processingAggregateIssues(itemRules));

  for (const [mode, modeLabel] of [
    ['SINGLE_STYLE', '单款装'],
    ['MIXED_STYLE', '混装'],
  ] as const) {
    const matches = packagingGroupRules.filter(({ modes }) =>
      modes.includes(mode),
    );
    if (matches.length > 1) {
      for (const { rule } of matches.slice(1)) {
        issues.push({
          path: `rules.${rule.id}.triggerCondition`,
          ruleId: rule.id,
          message: `${modeLabel}同时命中多条入袋规则`,
        });
      }
    }
  }

  const bases = itemRules.filter((rule) => rule.kind === 'BASE');
  if (bases.length === 0) {
    issues.push({ path: 'rules', message: '加工费价目簿至少需要一条启用的基础报价规则' });
  }
  for (let i = 0; i < bases.length; i += 1) {
    for (let j = i + 1; j < bases.length; j += 1) {
      const left = bases[i]!;
      const right = bases[j]!;
      if (
        left.productId === right.productId &&
        rangeOverlaps(left.minQty, left.maxQty, right.minQty, right.maxQty)
      ) {
        issues.push({
          path: `rules.${right.id}.minQty`,
          ruleId: right.id,
          message: `基础报价数量区间与“${left.name}”重叠`,
        });
      }
    }
  }

  const grouped = new Map<string, DraftPriceRuleForValidation[]>();
  for (const rule of itemRules) {
    const group = rule.exclusiveGroup?.trim();
    if (!group || rule.kind !== 'ADD_ON') continue;
    const key = `${group}\u0000${rule.priority}`;
    const candidates = grouped.get(key) ?? [];
    candidates.push(rule);
    grouped.set(key, candidates);
  }
  for (const candidates of grouped.values()) {
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const left = candidates[i]!;
        const right = candidates[j]!;
        const productScopesOverlap =
          left.productId === null ||
          right.productId === null ||
          left.productId === right.productId;
        if (
          productScopesOverlap &&
          rangeOverlaps(left.minQty, left.maxQty, right.minQty, right.maxQty) &&
          conditionsCanOverlap(left.triggerCondition, right.triggerCondition)
        ) {
          issues.push({
            path: `rules.${right.id}.exclusiveGroup`,
            ruleId: right.id,
            message: `收费项目“${right.name}”与“${left.name}”在同一适用范围和顺序下冲突`,
          });
        }
      }
    }
  }
  return issues;
}

function logisticsIssues(
  rules: DraftPriceRuleForValidation[],
): DraftPriceBookValidationIssue[] {
  const issues: DraftPriceBookValidationIssue[] = [];
  const active = rules.filter((rule) => rule.isActive);
  const shipping = active.filter((rule) => rule.category.code === 'SHIPPING_FEE');
  const packaging = active.filter(
    (rule) => rule.category.code === 'PACKING_MATERIAL',
  );
  const unsupported = active.filter(
    (rule) => !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(rule.category.code),
  );

  if (shipping.length === 0) {
    issues.push({ path: 'rules', message: '物流价目簿至少需要一条启用的快递费规则' });
  }
  if (packaging.length === 0) {
    issues.push({ path: 'rules', message: '物流价目簿至少需要一条启用的打包耗材规则' });
  }
  for (const rule of unsupported) {
    issues.push({
      path: `rules.${rule.id}.categoryId`,
      ruleId: rule.id,
      message: `物流计算器尚不支持收费类目“${rule.category.name}”`,
    });
  }

  const provinceOwner = new Map<string, DraftPriceRuleForValidation>();
  for (const rule of shipping) {
    const prefix = `rules.${rule.id}`;
    const condition = isRecord(rule.triggerCondition)
      ? rule.triggerCondition
      : null;
    const provinces = condition?.provinces;
    const carrierCode = condition?.carrierCode;
    if (
      carrierCode !== 'ZTO' ||
      !Array.isArray(provinces) ||
      provinces.length === 0 ||
      provinces.some(
        (province) => typeof province !== 'string' || province.trim() === '',
      )
    ) {
      issues.push({
        path: `${prefix}.triggerCondition`,
        ruleId: rule.id,
        message: '快递费规则必须配置中通承运商和至少一个省份',
      });
    }
    if (
      condition !== null &&
      !hasExactlyKeys(condition, ['carrierCode', 'provinces'])
    ) {
      issues.push({
        path: `${prefix}.triggerCondition`,
        ruleId: rule.id,
        message: '快递费的适用范围只能包含承运商和省份',
      });
    }
    if (rule.kind !== 'ADD_ON' || rule.calculationType !== 'FIXED_AMOUNT') {
      issues.push({
        path: `${prefix}.kind`,
        ruleId: rule.id,
        message: '快递费必须使用自动固定金额计价',
      });
    }
    if (rule.productId !== null) {
      issues.push({
        path: `${prefix}.productId`,
        ruleId: rule.id,
        message: '快递费规则不能绑定产品',
      });
    }
    if (rule.minQty !== null || rule.maxQty !== null) {
      issues.push({
        path: `${prefix}.minQty`,
        ruleId: rule.id,
        message: '快递费规则不能配置数量区间',
      });
    }
    if (rule.exclusiveGroup !== 'ZTO_PROVINCE_RATE') {
      issues.push({
        path: `${prefix}.exclusiveGroup`,
        ruleId: rule.id,
        message: '快递费的地区范围设置不完整，请重新选择承运商和省份',
      });
    }
    if (rule.priority !== 100) {
      issues.push({
        path: `${prefix}.priority`,
        ruleId: rule.id,
        message: '快递费的应用顺序设置不正确',
      });
    }
    if (rule.blocksAutomaticQuote) {
      issues.push({
        path: `${prefix}.blocksAutomaticQuote`,
        ruleId: rule.id,
        message: '快递费规则必须允许自动报价',
      });
    }
    const amountError = decimal(rule.amount, {
      label: '首重金额',
      maximum: LOGISTICS_MONEY_MAX,
      decimalPlaces: 4,
    });
    const includedError = decimal(rule.includedUnits, {
      label: '首重重量',
      maximum: UNIT_MAX,
      decimalPlaces: 3,
      positive: true,
    });
    const incrementError = decimal(rule.incrementUnits, {
      label: '续重单位',
      maximum: UNIT_MAX,
      decimalPlaces: 3,
      positive: true,
    });
    const incrementAmountError = decimal(rule.incrementAmount, {
      label: '续重金额',
      maximum: LOGISTICS_MONEY_MAX,
      decimalPlaces: 4,
    });
    for (const [path, message] of [
      ['amount', amountError],
      ['includedUnits', includedError],
      ['incrementUnits', incrementError],
      ['incrementAmount', incrementAmountError],
    ] as const) {
      if (message) {
        issues.push({ path: `${prefix}.${path}`, ruleId: rule.id, message });
      }
    }
    const firstFee = parsedDecimal(rule.amount);
    const firstWeight = parsedDecimal(rule.includedUnits);
    const incrementUnit = parsedDecimal(rule.incrementUnits);
    const incrementFee = parsedDecimal(rule.incrementAmount);
    if (
      !amountError &&
      !includedError &&
      !incrementError &&
      !incrementAmountError &&
      firstFee &&
      firstWeight &&
      incrementUnit &&
      incrementFee
    ) {
      const additionalUnits = Decimal.max(
        0,
        LOGISTICS_WEIGHT_MAX.minus(firstWeight).div(incrementUnit).floor(),
      );
      const maximumCharge = firstFee.plus(
        incrementFee.times(additionalUnits),
      );
      if (maximumCharge.gt(LOGISTICS_MONEY_MAX)) {
        issues.push({
          path: `${prefix}.incrementAmount`,
          ruleId: rule.id,
          message: `收费项目在最大计费重量下超过可保存上限 ${EXTERNAL_ORDER_CHARGE_MONEY_MAX} 元`,
        });
      }
    }
    if (Array.isArray(provinces)) {
      for (const provinceValue of provinces) {
        if (typeof provinceValue !== 'string') continue;
        const province = provinceValue.trim();
        const normalizedProvince = normalizeZtoProvince(province);
        if (
          provinceValue !== province ||
          normalizedProvince === null ||
          normalizedProvince !== province
        ) {
          issues.push({
            path: `${prefix}.triggerCondition`,
            ruleId: rule.id,
            message: `省份“${provinceValue}”不是受支持的规范名称`,
          });
          continue;
        }
        const owner = provinceOwner.get(province);
        if (owner) {
          issues.push({
            path: `${prefix}.triggerCondition`,
            ruleId: rule.id,
            message: `省份“${province}”已由规则“${owner.name}”计价`,
          });
        } else {
          provinceOwner.set(province, rule);
        }
      }
    }
  }

  const sortedPackaging = [...packaging].sort(
    (left, right) => (left.minQty ?? 0) - (right.minQty ?? 0),
  );
  for (const rule of sortedPackaging) {
    const prefix = `rules.${rule.id}`;
    const amount = parsedDecimal(rule.amount);
    const amountError = decimal(rule.amount, {
      label: '耗材金额',
      maximum: LOGISTICS_MONEY_MAX,
      decimalPlaces: 4,
    });
    if (amountError) {
      issues.push({
        path: `${prefix}.amount`,
        ruleId: rule.id,
        message: amount?.gt(LOGISTICS_MONEY_MAX)
          ? `耗材金额超过收费可保存上限 ${EXTERNAL_ORDER_CHARGE_MONEY_MAX} 元`
          : amountError,
      });
    }
    if (
      rule.kind !== 'REFERENCE' ||
      rule.calculationType !== 'FIXED_AMOUNT' ||
      !rule.blocksAutomaticQuote ||
      rule.minQty === null ||
      rule.maxQty === null
    ) {
      issues.push({
        path: `${prefix}.kind`,
        ruleId: rule.id,
        message: '耗材规则必须是带完整数量区间的人工确认参考价',
      });
    }
    const condition = isRecord(rule.triggerCondition)
      ? rule.triggerCondition
      : null;
    if (
      condition === null ||
      !hasExactlyKeys(condition, ['scope', 'advisory']) ||
      condition.scope !== 'SHIPMENT_QUANTITY' ||
      condition.advisory !== true
    ) {
      issues.push({
        path: `${prefix}.triggerCondition`,
        ruleId: rule.id,
        message:
          '耗材规则触发条件必须固定为每票数量的人工确认参考价',
      });
    }
    if (rule.productId !== null) {
      issues.push({
        path: `${prefix}.productId`,
        ruleId: rule.id,
        message: '耗材规则不能绑定产品',
      });
    }
    if (rule.exclusiveGroup !== 'PACKING_MATERIAL_QUANTITY_TIER') {
      issues.push({
        path: `${prefix}.exclusiveGroup`,
        ruleId: rule.id,
        message: '打包耗材的数量范围设置不完整，请重新选择适用数量',
      });
    }
    if (rule.priority !== 100) {
      issues.push({
        path: `${prefix}.priority`,
        ruleId: rule.id,
        message: '打包耗材的应用顺序设置不正确',
      });
    }
    if (rule.includedUnits !== null || rule.incrementUnits !== null || rule.incrementAmount !== null) {
      issues.push({
        path: `${prefix}.includedUnits`,
        ruleId: rule.id,
        message: '耗材规则不能配置首重或续重字段',
      });
    }
  }
  for (let index = 1; index < sortedPackaging.length; index += 1) {
    const previous = sortedPackaging[index - 1]!;
    const current = sortedPackaging[index]!;
    if (
      previous.minQty !== null &&
      previous.maxQty !== null &&
      current.minQty !== null &&
      current.maxQty !== null &&
      rangeOverlaps(
        previous.minQty,
        previous.maxQty,
        current.minQty,
        current.maxQty,
      )
    ) {
      issues.push({
        path: `rules.${current.id}.minQty`,
        ruleId: current.id,
        message: `耗材数量区间与“${previous.name}”重叠`,
      });
    }
  }
  return issues;
}

export function validateDraftPriceBookRules(args: {
  purpose: DraftPriceBookPurpose;
  rules: DraftPriceRuleForValidation[];
}): DraftPriceBookValidationIssue[] {
  const active = args.rules.filter((rule) => rule.isActive);
  const issues = commonRuleIssues(active);
  issues.push(
    ...(args.purpose === 'PROCESSING'
      ? processingIssues(args.rules)
      : logisticsIssues(args.rules)),
  );
  return issues.map((issue) => ({
    ...issue,
    message: externalPriceBusinessText(issue.message),
  }));
}
