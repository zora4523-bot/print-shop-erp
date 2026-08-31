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

const CONDITION_FIELD_LABELS: Record<PriceAdjustmentConditionKey, string> = {
  productIds: '限定产品',
  craftIds: '限定工艺',
  craftMode: '多工艺匹配方式',
  specifications: '规格',
  paperTypes: '纸张',
  foilColors: '烫金颜色',
  isDoubleSided: '单双面',
  isDoubleColor: '单双色',
  minQty: '最小数量',
  maxQty: '最大数量',
  settlementTypes: '结算类型',
  unitsPerSheet: '每张可生产数量',
  perFoilColor: '按烫金颜色数量计费',
};

const TECHNICAL_CONDITION_ERROR_PATTERN =
  /(?:json|unknown\s+keys?|未知字段|[a-z][a-z0-9_]*)/i;
const GENERIC_CONDITION_ERROR =
  '适用条件设置无效，请按页面选项重新设置。';

/**
 * Prevent stale server or database validation messages from exposing stored
 * condition keys and enum tokens in the business-facing form.
 */
export function priceAdjustmentConditionErrorForDisplay(
  message: string,
): string {
  const normalized = message.trim();
  return normalized !== '' && !TECHNICAL_CONDITION_ERROR_PATTERN.test(normalized)
    ? normalized
    : GENERIC_CONDITION_ERROR;
}

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
      ? ['按张计价必须填写“每张可生产数量”。']
      : [];
  }
  if (!isRecord(value)) return ['旧条件格式无法识别，请清空后重新设置。'];

  const errors: string[] = [];
  const unknownKeys = Object.keys(value).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    errors.push('旧条件包含页面不支持的设置，请清空后重新设置。');
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
      errors.push(
        `“${CONDITION_FIELD_LABELS[key]}”必须至少选择或填写一项有效内容。`,
      );
    }
  }

  if (
    Array.isArray(value.settlementTypes) &&
    value.settlementTypes.some(
      (entry) =>
        typeof entry === 'string' && !ORDER_SETTLEMENT_TYPES.has(entry.trim()),
    )
  ) {
    errors.push('结算类型包含不支持的选项，请重新选择。');
  }

  for (const key of BOOLEAN_KEYS) {
    if (key in value && typeof value[key] !== 'boolean') {
      errors.push(`“${CONDITION_FIELD_LABELS[key]}”设置无效，请重新选择。`);
    }
  }

  for (const key of POSITIVE_INTEGER_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 1) {
      errors.push(`“${CONDITION_FIELD_LABELS[key]}”必须填写正整数。`);
    }
  }

  if (
    'craftMode' in value &&
    value.craftMode !== 'ANY' &&
    value.craftMode !== 'ALL'
  ) {
    errors.push('多工艺匹配方式无效，请重新选择。');
  }
  if ('craftMode' in value && !('craftIds' in value)) {
    errors.push('设置多工艺匹配方式前，请先选择至少一项工艺。');
  }
  if (
    typeof value.minQty === 'number' &&
    Number.isSafeInteger(value.minQty) &&
    typeof value.maxQty === 'number' &&
    Number.isSafeInteger(value.maxQty) &&
    value.minQty > value.maxQty
  ) {
    errors.push('最小数量不能大于最大数量。');
  }
  if (
    adjustmentType === AdjustmentType.PER_SHEET &&
    !('unitsPerSheet' in value)
  ) {
    errors.push('按张计价必须填写“每张可生产数量”。');
  }

  return errors;
}
