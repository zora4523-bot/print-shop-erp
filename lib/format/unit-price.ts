import Decimal from 'decimal.js';

/** Format a Decimal(10, 4) unit price without routing through IEEE-754. */
export function formatUnitPrice(value: Decimal.Value): string {
  const [integer = '0', fraction = '0000'] = new Decimal(value)
    .toFixed(4)
    .split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥ ${groupedInteger}.${fraction}`;
}
