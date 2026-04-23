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

function formatDatePrefix(date: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${z(date.getMonth() + 1)}${z(date.getDate())}`;
}

// Minimal shape of the Prisma tx client we need. Kept local so the module
// doesn't depend on the lib/account.ts TxClient declaration (different
// table surfaces).
export type OrderSeqTxClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
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
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ORDER_SEQ_NAMESPACE}:${prefix}`}))`;

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
  // Tail after the first "-" is the serial. Tolerate unexpected shapes by
  // falling back to 0 (safer: the next number starts at 1).
  const tail = orderNo.split('-', 2)[1];
  if (!tail) return 0;
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
