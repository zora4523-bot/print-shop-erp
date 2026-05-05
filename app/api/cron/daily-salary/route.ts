import Decimal from 'decimal.js';
import { NextResponse } from 'next/server';
import { computeDailyForAllMachineWorkers } from '@/lib/salary/daily';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { formatMoneyPlain } from '@/lib/dashboard/format';

// Node runtime: Prisma + decimal.js aren't edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared-secret endpoint for the "每日 24:00" daily-salary job (SPEC
// §3.8). The caller is either:
//   1. Local pg_cron → curl with the Authorization header
//      (Pigsty has pg_cron enabled, DECISIONS 2026-04-22).
//   2. An external scheduler (Alibaba Cloud Function Compute, etc.)
//      that POSTs on a 24-hour cadence.
//
// Usage:
//   curl -X POST https://host/api/cron/daily-salary \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -d '{"date":"2026-04-23"}'
//
// When `date` is omitted, defaults to yesterday's Shanghai calendar
// day — that's the usual "process yesterday's shift at 00:00 today"
// pattern, so the cron call doesn't need to know the date itself.
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }

  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const date = extractDate(body) ?? yesterdayShanghai();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: `invalid date: ${date}` },
      { status: 400 },
    );
  }

  try {
    const { settled, errors } = await computeDailyForAllMachineWorkers(date);

    // Slice D wire ─ DAILY_WORKER_SALARY（仅在有 settled 行时触发；
    // dispatchNotification 走 after() + 单测降级）。totalAmount 是
    // settled 行 actualSalary 的 sum——这条消息发到&ldquo;车间群&rdquo;的认证
    // WeCom，含金额是预期（DECISIONS 2026-04-24 限定的&ldquo;cron stdout
    // 不含金额&rdquo;只是 cron 响应 / pg_cron 日志侧）。
    if (settled.length > 0) {
      const totalAmount = settled
        .reduce<Decimal>(
          (acc, r) => acc.plus(new Decimal(r.actualSalary)),
          new Decimal(0),
        )
        .toFixed(2);
      dispatchNotification('DAILY_WORKER_SALARY', {
        date,
        workerCount: settled.length,
        totalAmount: formatMoneyPlain(totalAmount),
      });
    }

    // COUNTS ONLY — full per-worker salary amounts would leak into
    // scheduler / pg_cron logs (Codex round 49 / P2). Per-worker
    // errors likewise embed salary amounts in the paid-row refusal
    // path (Codex round 50 / P2). Owner sees details at
    // /owner/salary/daily.
    return NextResponse.json({
      status: 'ok',
      date,
      workerCount: settled.length,
      errorCount: errors.length,
    });
  } catch (err) {
    // Infrastructure failure (DB down, etc.) — per-worker errors are
    // captured inside computeDailyForAllMachineWorkers now. Scrub
    // err.message to avoid leaking any salary figures that a future
    // wrapping error might carry.
    void err;
    return NextResponse.json(
      { status: 'error', date, message: '批处理失败；查看 owner 页面确认' },
      { status: 500 },
    );
  }
}

function extractDate(body: unknown): string | null {
  if (body && typeof body === 'object' && 'date' in body) {
    const v = (body as { date: unknown }).date;
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function yesterdayShanghai(): string {
  const now = new Date();
  // Shift 24h back, then format in Shanghai tz.
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(y);
}
