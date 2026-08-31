import Decimal from 'decimal.js';

const MAX_MONEY = new Decimal('9999999999.99');

export function decimalValue(value: string | number): Decimal | null {
  try {
    const result = new Decimal(value);
    return result.isFinite() && !result.isNegative() ? result : null;
  } catch {
    return null;
  }
}

export function money(value: Decimal.Value): string {
  return new Decimal(value)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export function unitPrice(value: Decimal.Value): string {
  return new Decimal(value)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

export function safeMoney(value: Decimal): string | null {
  return value.lte(MAX_MONEY) ? money(value) : null;
}

export function sumMoney(values: readonly (string | null)[]): string {
  return money(
    values.reduce(
      (total, value) =>
        value === null ? total : total.plus(value),
      new Decimal(0),
    ),
  );
}
