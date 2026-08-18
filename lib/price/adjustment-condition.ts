import {
  AdjustmentType,
  OrderSettlementType,
} from '../../generated/prisma/enums';

export const PRICE_ADJUSTMENT_CONDITION_KEYS = [
  'productIds',
  'craftIds',
  'craftMode',
  'specifications',
  'paperTypes',
  'foilColors',
  'isDoubleSided',
  'isDoubleColor',
  'minQty',
  'maxQty',
  'settlementTypes',
  'unitsPerSheet',
  'perFoilColor',
] as const;

export type PriceAdjustmentConditionKey =
  (typeof PRICE_ADJUSTMENT_CONDITION_KEYS)[number];

export type PriceAdjustmentTriggerCondition = {
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

const KNOWN_KEYS = new Set<string>(PRICE_ADJUSTMENT_CONDITION_KEYS);
const STRING_ARRAY_KEYS = [
  'productIds',
  'craftIds',
  'specifications',
  'paperTypes',
  'foilColors',
  'settlementTypes',
] as const;
const BOOLEAN_KEYS = [
  'isDoubleSided',
  'isDoubleColor',
  'perFoilColor',
] as const;
const POSITIVE_INTEGER_KEYS = ['minQty', 'maxQty', 'unitsPerSheet'] as const;
const ORDER_SETTLEMENT_TYPES = new Set<string>(
  Object.values(OrderSettlementType),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Save-time contract for PriceAdjustment.triggerCondition.
 *
 * Keep this deliberately aligned with the quote engine's fail-closed parser:
 * an active rule that reaches quoting with an unknown key or wrong value type
 * makes the whole quote incomplete. Rejecting it here prevents one bad admin
 * edit from disabling suggested prices for every order.
 */
export function validatePriceAdjustmentTriggerCondition(
  value: unknown,
  adjustmentType: AdjustmentType,
): string[] {
  if (value === null || value === undefined) {
    return adjustmentType === AdjustmentType.PER_SHEET
      ? ['按张计价必须提供正整数 unitsPerSheet（每张可生产数量）']
      : [];
  }
  if (!isRecord(value)) return ['触发条件必须是 JSON object'];

  const errors: string[] = [];
  const unknownKeys = Object.keys(value).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    errors.push(
      `包含未知字段：${unknownKeys.join('、')}；请只使用页面列出的支持键`,
    );
  }

  for (const key of STRING_ARRAY_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (
      !Array.isArray(candidate) ||
      candidate.length === 0 ||
      candidate.some(
        (entry) => typeof entry !== 'string' || entry.trim() === '',
      )
    ) {
      errors.push(`${key}必须是至少含一项的非空字符串数组`);
    }
  }

  if (
    Array.isArray(value.settlementTypes) &&
    value.settlementTypes.some(
      (entry) =>
        typeof entry === 'string' && !ORDER_SETTLEMENT_TYPES.has(entry.trim()),
    )
  ) {
    errors.push(
      `settlementTypes 只能使用：${Object.values(OrderSettlementType).join('、')}`,
    );
  }

  for (const key of BOOLEAN_KEYS) {
    if (key in value && typeof value[key] !== 'boolean') {
      errors.push(`${key}必须是布尔值 true 或 false`);
    }
  }

  for (const key of POSITIVE_INTEGER_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 1) {
      errors.push(`${key}必须是正整数`);
    }
  }

  if (
    'craftMode' in value &&
    value.craftMode !== 'ANY' &&
    value.craftMode !== 'ALL'
  ) {
    errors.push('craftMode 只能是 ANY 或 ALL');
  }
  if ('craftMode' in value && !('craftIds' in value)) {
    errors.push('craftMode 必须与 craftIds 一起使用');
  }
  if (
    typeof value.minQty === 'number' &&
    Number.isSafeInteger(value.minQty) &&
    typeof value.maxQty === 'number' &&
    Number.isSafeInteger(value.maxQty) &&
    value.minQty > value.maxQty
  ) {
    errors.push('minQty 不能大于 maxQty');
  }
  if (
    adjustmentType === AdjustmentType.PER_SHEET &&
    !('unitsPerSheet' in value)
  ) {
    errors.push(
      '按张计价必须提供正整数 unitsPerSheet（每张可生产数量）',
    );
  }

  return errors;
}
