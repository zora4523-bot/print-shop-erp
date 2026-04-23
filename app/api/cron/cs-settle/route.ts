import { NextResponse } from 'next/server';
import { settleReadyCsPeriods } from '@/lib/salary/cs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC §3.7 "周期结束当日（定时任务）" — scan every IN_PROGRESS period
// whose periodEnd has passed and settle each. Same shared-secret
// Bearer pattern as /api/cron/daily-salary (DECISIONS 2026-04-23 on
// CRON_SECRET + pg_cron / external scheduler).
//
// Usage:
//   curl -X POST https://host/api/cron/cs-settle \
//     -H "Authorization: Bearer $CRON_SECRET"
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

  try {
    const { settled, errors } = await settleReadyCsPeriods();
    // COUNTS ONLY — per-commission totals / tier rates would leak via
    // scheduler logs (Codex round 49 / P2 rationale applied across
    // all three cron endpoints). Owner sees details at
    // /owner/salary/cs.
    return NextResponse.json({
      status: 'ok',
      settledCount: settled.length,
      errorCount: errors.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', message }, { status: 500 });
  }
}
