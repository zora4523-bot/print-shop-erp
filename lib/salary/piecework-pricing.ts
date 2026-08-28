import Decimal from 'decimal.js';

export const PIECEWORK_OPERATION_TYPES = [
  'PARTIAL',
  'FULL',
  'PACKING',
] as const;

export type PieceworkOperationTypeValue =
  (typeof PIECEWORK_OPERATION_TYPES)[number];

export const PIECEWORK_RATE_UNITS = [
  'PER_PASS',
  'PER_PIECE',
  'PER_BAG',
] as const;

export type PieceworkRateUnitValue = (typeof PIECEWORK_RATE_UNITS)[number];

export const PIECEWORK_UNIT_BY_OPERATION = {
  PARTIAL: 'PER_PASS',
  FULL: 'PER_PIECE',
  PACKING: 'PER_BAG',
} as const satisfies Record<
  PieceworkOperationTypeValue,
  PieceworkRateUnitValue
>;

export type PieceworkRate = {
  operationType: PieceworkOperationTypeValue;
  unit: PieceworkRateUnitValue;
  amount: Decimal.Value | null;
};

export type PieceworkPricingInput = {
  operationType: PieceworkOperationTypeValue;
  completedQty: Decimal.Value;
  defectQty?: Decimal.Value;
  reworkQty?: Decimal.Value;
  /** PARTIAL 的正面颜色数 + 反面颜色数。 */
  passCount?: Decimal.Value;
};

export type PieceworkPricingResult = {
  operationType: PieceworkOperationTypeValue;
  unit: PieceworkRateUnitValue;
  completedQty: string;
  excludedDefectQty: string;
  excludedReworkQty: string;
  passCount: string;
  chargeableQty: string;
  rate: string;
  amount: string;
};

export type PieceworkPricingErrorCode =
  | 'INVALID_PIECEWORK_INPUT'
  | 'PIECEWORK_RATE_UNAVAILABLE';

export class PieceworkPricingError extends Error {
  constructor(
    public readonly code: PieceworkPricingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PieceworkPricingError';
  }
}

const MAX_QUANTITY = new Decimal('99999999999.999');
const MAX_RATE = new Decimal('9999999999.9999');
const MAX_AMOUNT = new Decimal('999999999999.99');

function nonNegativeWholeQuantity(
  value: Decimal.Value | undefined,
  label: string,
): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value ?? 0);
  } catch {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      `${label}必须是有限非负整数`,
    );
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    !parsed.isInteger() ||
    parsed.gt(MAX_QUANTITY)
  ) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      `${label}必须是有限非负整数`,
    );
  }
  return parsed;
}

function rateAmount(value: Decimal.Value | null): Decimal {
  if (value === null) {
    throw new PieceworkPricingError(
      'PIECEWORK_RATE_UNAVAILABLE',
      '工价尚未发布，禁止按 0 元结算',
    );
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '工价必须是有限非负数',
    );
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    parsed.decimalPlaces() > 4 ||
    parsed.gt(MAX_RATE)
  ) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '工价必须是最多 4 位小数的有限非负数',
    );
  }
  return parsed;
}

/**
 * 新计件域的无 IO 纯函数。工价键只是 operationType；人员、机型、
 * 工单行都不参与取价。本期工资只计 completedQty，defect/rework
 * 仅作质量事实返回，不进入 chargeableQty。
 */
export function calculatePieceworkAmount(
  input: PieceworkPricingInput,
  rate: PieceworkRate,
): PieceworkPricingResult {
  if (rate.operationType !== input.operationType) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '工价工序与报工工序不一致',
    );
  }
  const expectedUnit = PIECEWORK_UNIT_BY_OPERATION[input.operationType];
  if (rate.unit !== expectedUnit) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '工序与工价单位不一致',
    );
  }

  const completedQty = nonNegativeWholeQuantity(
    input.completedQty,
    '合格完成数',
  );
  const defectQty = nonNegativeWholeQuantity(input.defectQty, '缺陷数');
  const reworkQty = nonNegativeWholeQuantity(input.reworkQty, '返工数');

  let passCount = new Decimal(1);
  if (input.operationType === 'PARTIAL') {
    passCount = nonNegativeWholeQuantity(input.passCount, '过版次数');
    if (passCount.lte(0)) {
      throw new PieceworkPricingError(
        'INVALID_PIECEWORK_INPUT',
        '局部烫金过版次数必须大于 0',
      );
    }
  } else if (input.passCount !== undefined) {
    const submittedPassCount = nonNegativeWholeQuantity(
      input.passCount,
      '过版次数',
    );
    if (!submittedPassCount.eq(1)) {
      throw new PieceworkPricingError(
        'INVALID_PIECEWORK_INPUT',
        '只有局部烫金可按多次过版计件',
      );
    }
  }

  const chargeableQty = completedQty.mul(passCount);
  if (chargeableQty.gt(MAX_QUANTITY)) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '计薪数量超出可存储范围',
    );
  }
  const parsedRate = rateAmount(rate.amount);
  const amount = chargeableQty
    .mul(parsedRate)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (amount.gt(MAX_AMOUNT)) {
    throw new PieceworkPricingError(
      'INVALID_PIECEWORK_INPUT',
      '计件金额超出可存储范围',
    );
  }

  return {
    operationType: input.operationType,
    unit: expectedUnit,
    completedQty: completedQty.toString(),
    excludedDefectQty: defectQty.toString(),
    excludedReworkQty: reworkQty.toString(),
    passCount: passCount.toString(),
    chargeableQty: chargeableQty.toString(),
    rate: parsedRate.toFixed(4),
    amount: amount.toFixed(2),
  };
}
