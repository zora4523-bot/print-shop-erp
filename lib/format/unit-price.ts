import Decimal from 'decimal.js';

/** Format a Decimal(10, 4) unit price without routing through IEEE-754. */
export function formatUnitPrice(value: Decimal.Value): string {
  const [integer = '0', fraction = '0000'] = new Decimal(value)
    .toFixed(4)
    .split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥ ${groupedInteger}.${fraction}`;
}

/**
 * 费率 / 阶梯价：`¥ ` + 千分位 + 2–4 位小数（去尾零、至少两位）。
 * 用于计件费率（每下 0.007 元）、时薪、阶梯价标签等既非两位小数金额、
 * 又不需要固定四位对齐的场景；固定四位对齐的单价列仍用 `formatUnitPrice`。
 */
export function formatRate(value: Decimal.Value): string {
  const fixed = new Decimal(value).toFixed(4);
  const [integer = '0', fraction = '0000'] = fixed.split('.');
  const negative = integer.startsWith('-');
  const digits = negative ? integer.slice(1) : integer;
  const groupedInteger = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '');
  const decimals = trimmed.length < 2 ? fraction.slice(0, 2) : trimmed;
  return `${negative ? '-' : ''}¥ ${groupedInteger}.${decimals}`;
}
