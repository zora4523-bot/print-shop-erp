import Decimal from 'decimal.js';

// Money formatter for the owner dashboard. Renders 千分位 + 2-decimal +
// `¥ ` prefix, e.g. `1234567.89` → `¥ 1,234,567.89`.
//
// Scoped to dashboard intentionally: existing pages (/owner/bills,
// /owner/salary/daily, …) use `¥ ${decimal.toFixed(2)}` without 千分位
// and the user explicitly asked for 千分位 only on the dashboard. Keep
// this file out of the salary / bill modules so a wider rollout has to
// be a deliberate change, not an accidental import.
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
