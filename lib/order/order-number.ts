// Generates YYYYMMDD-XXXX order numbers (SPEC §4.1 orderNo field).
//
// Concurrency: two sales submitting at the same millisecond must not both
// read "today has N orders" → commit 0N+1. Takes a per-day advisory lock at
// the start of the transaction so the max-lookup + insert pair is
// serialized. The lock is released on tx commit, so the window is short
// even under heavy load.
//
// Format rationale:
//   YYYYMMDD — easy manual scanning, sorts lexicographically
//   XXXX     — zero-padded 4-digit serial, fits ≤ 9999 orders / day
//              (far above realistic factory throughput)

const ORDER_SEQ_NAMESPACE = 'print-shop-erp:order-seq';
const SEQ_PAD = 4;

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

function formatDatePrefix(date: Date): string {
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
  return `${year}${month}${day}`;
}

// Minimal shape of the Prisma tx client we need. Kept local so the module
// doesn't depend on the lib/account.ts TxClient declaration (different
// table surfaces).
export type OrderSeqTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    findFirst: (args: {
      where: unknown;
      orderBy?: unknown;
      select?: unknown;
    }) => Promise<{ orderNo: string } | null>;
  };
};

export async function nextOrderNumber(
  tx: OrderSeqTxClient,
  date: Date,
): Promise<string> {
  const prefix = formatDatePrefix(date);

  // Per-day advisory lock — concurrent creates on different days don't
  // block each other (different hash), but same-day creates serialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ORDER_SEQ_NAMESPACE}:${prefix}`}))`;

  // Highest existing serial. We look at max rather than count because a
  // cancellation may leave holes (cancelled orders stay in the table with
  // their original orderNo for audit), and count+1 could collide with an
  // existing row.
  const latest = await tx.order.findFirst({
    where: { orderNo: { startsWith: `${prefix}-` } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });

  const lastSeq = latest ? parseSerial(latest.orderNo) : 0;
  const nextSeq = lastSeq + 1;
  if (nextSeq > 9999) {
    // Unreachable in practice (no shop takes 10k orders in a day) but
    // worth surfacing instead of producing a malformed "XXXXX" tail.
    throw new Error(`当日工单号已达上限 9999 条，无法再开新单（prefix=${prefix}）`);
  }
  return `${prefix}-${String(nextSeq).padStart(SEQ_PAD, '0')}`;
}

function parseSerial(orderNo: string): number {
  // Tail after the first "-" is the serial. Any malformed input means
  // something upstream wrote a non-standard row; fail loudly so ops can
  // investigate, rather than silently emitting a colliding '-0001'.
  const tail = orderNo.split('-', 2)[1];
  if (!tail) throw new Error(`无法解析工单号（缺少序号段）：${orderNo}`);
  if (!/^\d+$/.test(tail)) {
    throw new Error(`无法解析工单号（序号段非纯数字）：${orderNo}`);
  }
  // A serial longer than 4 digits is data corruption (we generate them
  // ourselves), not "capacity exceeded". Surface it distinctly from the
  // regular 9999 cap so the message isn't misleading.
  if (tail.length > SEQ_PAD) {
    throw new Error(
      `无法解析工单号（序号段位数异常：${tail.length} > ${SEQ_PAD}）：${orderNo}`,
    );
  }
  const n = Number.parseInt(tail, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`无法解析工单号（序号非正整数）：${orderNo}`);
  }
  return n;
}
