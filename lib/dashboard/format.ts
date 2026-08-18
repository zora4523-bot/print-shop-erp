import Decimal from 'decimal.js';

// Shared business-money formatter. Renders 千分位 + 2-decimal + `¥ `
// prefix, e.g. `1234567.89` → `¥ 1,234,567.89`. Use this for user-facing
// totals; fields whose schema intentionally keeps finer precision (such as
// OrderItem.unitPrice Decimal(10, 4)) retain their own dedicated formatter.
//
// Accepts Decimal | string | number — Prisma money columns surface as
// Decimal at the lib boundary; callers that already converted via
// .toFixed(2) hand us a string. We funnel both through Decimal.js so
// rounding stays half-away-from-zero (banker's rounding is *not* what
// our PG numeric rounding does).
const FORMATTER = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: Decimal.Value): string {
  const d = new Decimal(value);
  // Decimal.js → number is safe here: we only need 2 fraction digits and
  // the magnitude is bounded by Prisma column types (Decimal(12, 2)).
  // Going via .toFixed(2) → Number() keeps half-up rounding consistent
  // with what `${decimal}` does in the rest of the app.
  return `¥ ${FORMATTER.format(Number(d.toFixed(2)))}`;
}

// 同上但不带 `¥ ` 前缀——给 NotificationRule.messageTemplate 用，
// 模板自己决定要不要加货币符号（seed.ts 默认 template 已写
// `金额：¥{totalAmount}`，再加前缀会双 ¥¥）。
export function formatMoneyPlain(value: Decimal.Value): string {
  const d = new Decimal(value);
  return FORMATTER.format(Number(d.toFixed(2)));
}
