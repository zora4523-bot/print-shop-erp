import Decimal from 'decimal.js';

/**
 * 物料用量等 Decimal 数量：千分位 + 去掉末尾零（ui-规范 §4.2），不经 IEEE-754。
 * `1000.0000` → `1,000`，`12.5000` → `12.5`，`0.0070` → `0.007`。
 */
export function formatDecimalQuantity(value: Decimal.Value): string {
  const fixed = new Decimal(value).toFixed();
  const [integer = '0', fraction = ''] = fixed.split('.');
  const negative = integer.startsWith('-');
  const digits = negative ? integer.slice(1) : integer;
  const groupedInteger = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${groupedInteger}${trimmed ? `.${trimmed}` : ''}`;
}
