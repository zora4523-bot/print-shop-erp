import type { Prisma } from '../../generated/prisma/client';

// Generates GD-YYMMDD-XXX order numbers (for example GD-260719-001).
//
// Concurrency: two sales submitting at the same millisecond must not both
// read "today has N orders" → commit 0N+1. Takes a per-day advisory lock at
// the start of the transaction so the max-lookup + insert pair is
// serialized. The lock is released on tx commit, so the window is short
// even under heavy load.
//
// Format rationale:
//   GD       — 工单 (Gong Dan), so staff can identify the document type
//   YYMMDD   — compact business date that still carries the year
//   XXX      — short zero-padded daily serial, easy to read back by phone

const ORDER_SEQ_NAMESPACE = 'print-shop-erp:order-seq';
const ORDER_NUMBER_PREFIX = 'GD';
const SEQ_PAD = 3;
const MAX_DAILY_SEQUENCE = 999;

// The shop is in Foshan → Asia/Shanghai. Pin the "YYYYMMDD" calendar to
// that zone so a server in UTC (or any other region) still groups orders
// by the business day the operator filled them in. Using local-time
// getters on a `Date` would produce different prefixes depending on
// process TZ and silently split sequences across days around midnight.
const BUSINESS_TIMEZONE = 'Asia/Shanghai';
const DATE_PREFIX_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatDateParts(date: Date): {
  businessDate: string;
  displayDate: string;
} {
  // Using formatToParts (not format + dash-strip) because 'en-CA' is not a
  // contractual YYYY-MM-DD everywhere — some ICU/Node builds can return
  // other patterns like MM/DD/YYYY, and a blind strip would produce a
  // malformed prefix. Assembling from named parts is bulletproof.
  const parts = DATE_PREFIX_FORMATTER.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(
      `Failed to format business-timezone date via Intl.DateTimeFormat: ${date.toISOString()}`,
    );
  }
  const businessDate = `${year}${month}${day}`;
  return {
    businessDate,
    displayDate: `${year.slice(-2)}${month}${day}`,
  };
}

// Minimal shape of the Prisma tx client we need. Kept local so the module
// doesn't depend on the lib/account.ts TxClient declaration (different
// table surfaces).
export type OrderSeqTxClient = {
  $executeRaw: Prisma.TransactionClient['$executeRaw'];
  order: Pick<Prisma.TransactionClient['order'], 'findFirst'>;
};

export async function nextOrderNumber(
  tx: OrderSeqTxClient,
  date: Date,
): Promise<string> {
  const { businessDate, displayDate } = formatDateParts(date);
  const visiblePrefix = `${ORDER_NUMBER_PREFIX}-${displayDate}`;

  // Per-day advisory lock — concurrent creates on different days don't
  // block each other (different hash), but same-day creates serialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ORDER_SEQ_NAMESPACE}:${businessDate}`}))`;

  // Highest existing serial. We look at max rather than count because a
  // cancellation may leave holes (cancelled orders stay in the table with
  // their original orderNo for audit), and count+1 could collide with an
  // existing row.
  const latest = await tx.order.findFirst({
    where: { orderNo: { startsWith: `${visiblePrefix}-` } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });

  const lastSeq = latest ? parseSerial(latest.orderNo, visiblePrefix) : 0;
  const nextSeq = lastSeq + 1;
  if (nextSeq > MAX_DAILY_SEQUENCE) {
    // Unreachable in practice for this shop, but fail explicitly instead of
    // silently widening the serial and breaking lexicographic max ordering.
    throw new Error(
      `当日工单号已达上限 ${MAX_DAILY_SEQUENCE} 条，无法再开新单（date=${businessDate}）`,
    );
  }
  return `${visiblePrefix}-${String(nextSeq).padStart(SEQ_PAD, '0')}`;
}

function parseSerial(orderNo: string, visiblePrefix: string): number {
  // Tail after the date prefix is the serial. Any malformed input means
  // something upstream wrote a non-standard row; fail loudly so ops can
  // investigate, rather than silently emitting a colliding '-001'.
  const expectedStart = `${visiblePrefix}-`;
  if (!orderNo.startsWith(expectedStart)) {
    throw new Error(`无法解析工单号（前缀不匹配）：${orderNo}`);
  }
  const tail = orderNo.slice(expectedStart.length);
  if (!tail) throw new Error(`无法解析工单号（缺少序号段）：${orderNo}`);
  if (!/^\d+$/.test(tail)) {
    throw new Error(`无法解析工单号（序号段非纯数字）：${orderNo}`);
  }
  if (tail.length !== SEQ_PAD) {
    throw new Error(
      `无法解析工单号（序号段位数异常：${tail.length} != ${SEQ_PAD}）：${orderNo}`,
    );
  }
  const n = Number.parseInt(tail, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`无法解析工单号（序号非正整数）：${orderNo}`);
  }
  return n;
}
