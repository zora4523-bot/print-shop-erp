import Decimal from 'decimal.js';
import { externalPriceRuleDisplayName } from './external-price-display';
import { parseCustomerRuleCondition } from './customer-rule-condition';

export type CustomerPriceRuleKindValue = 'BASE' | 'ADD_ON' | 'REFERENCE';

export type CustomerPriceCalculationTypeValue =
  | 'PER_PIECE'
  | 'FIXED_AMOUNT'
  | 'PER_SHEET'
  | 'PER_10K'
  | 'PER_ITEM';

/** Persisted processing-rule shape needed by the configuration publisher. */
export type ExternalSalesPriceRuleForValidation = {
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
  category: { code: string; name: string };
};

export const EXTERNAL_SALES_PRICE_LIMITS = {
  ruleAmount: '9999999999.9999',
  subtotal: '9999999999.99',
  unitPrice: '999999.9999',
} as const;

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
const RATE_MAX = new Decimal(EXTERNAL_SALES_PRICE_LIMITS.ruleAmount);

function ruleRateIsValid(
  rule: ExternalSalesPriceRuleForValidation,
): boolean {
  if (rule.amount === null) return false;
  try {
    const amount = new Decimal(rule.amount);
    return (
      amount.isFinite() &&
      !amount.isNegative() &&
      amount.decimalPlaces() <= 4 &&
      amount.lte(RATE_MAX)
    );
  } catch {
    return false;
  }
}

/**
 * Configuration-domain validation only. It intentionally has no quote input
 * and performs no customer calculation, so publishing a draft does not keep
 * the superseded runtime calculator alive.
 */
export function validateExternalSalesPriceRules(
  rules: ExternalSalesPriceRuleForValidation[],
): string[] {
  const errors: string[] = [];
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
    if (rule.kind === 'REFERENCE') continue;
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
    if (!ruleRateIsValid(rule)) {
      errors.push(`收费项目“${label}”的金额设置无效`);
    }
  }
  return errors;
}
