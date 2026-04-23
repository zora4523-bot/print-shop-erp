import { NextResponse } from 'next/server';
import {
  computeDailyForAllMachineWorkers,
  DailySalaryError,
} from '@/lib/salary/daily';

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
    const results = await computeDailyForAllMachineWorkers(date);
    return NextResponse.json({
      status: 'ok',
      date,
      workerCount: results.length,
      results,
    });
  } catch (err) {
    const message =
      err instanceof DailySalaryError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json(
      { status: 'error', date, message },
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
