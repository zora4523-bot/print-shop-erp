import { NextResponse } from 'next/server';
import { computeHourlyForAllInMonth, HourlyAggregateError } from '@/lib/salary/hourly-aggregate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC §3.9 "月底定时任务" — scan every active hourly worker and
// settle the given month's HourlyWorkerPayroll. Same shared-secret
// Bearer pattern as /api/cron/daily-salary and /api/cron/cs-settle
// (DECISIONS 2026-04-24). When `month` is omitted, defaults to the
// previous Shanghai calendar month — typical pattern is "run on the
// 1st of each month at 00:05 to settle the month that just ended."
//
// Usage:
//   curl -X POST https://host/api/cron/hourly-payroll \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -d '{"month":"2026-05"}'
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

  const month = extractMonth(body) ?? previousShanghaiMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: `invalid month: ${month}` }, { status: 400 });
  }

  try {
    const { settled, errors } = await computeHourlyForAllInMonth(month);
    // Return COUNTS ONLY — both the `settled` rows (full salary
    // breakdown) AND the `errors` messages (paid-row refusal embeds
    // existing totalSalary) would leak
    // payroll figures into scheduler / pg_cron logs. Owner sees the
    // per-row state at /owner/salary/hourly; operator sees whether
    // the cron succeeded at all via counts.
    return NextResponse.json({
      status: 'ok',
      month,
      workerCount: settled.length,
      errorCount: errors.length,
    });
  } catch (err) {
    // 领域错误消息是安全文案（如"已发放行拒绝重算"），可回显；意外错误
    // （Prisma 等）可能 embed 金额/内部细节，scrub 后只留服务端日志——
    // 与其余 6 个 cron 的 COUNTS-ONLY / scrub 约定一致（DECISIONS 2026-04-24）。
    if (err instanceof HourlyAggregateError) {
      return NextResponse.json(
        { status: 'error', month, message: err.message },
        { status: 500 },
      );
    }
    console.error(
      '[cron:hourly-payroll] unexpected error:',
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return NextResponse.json(
      {
        status: 'error',
        month,
        message: '批处理失败；查看 owner /owner/salary/hourly 页面确认',
      },
      { status: 500 },
    );
  }
}

function extractMonth(body: unknown): string | null {
  if (body && typeof body === 'object' && 'month' in body) {
    const v = (body as { month: unknown }).month;
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

// Previous month in Shanghai time. We get today's month, subtract 1
// (carrying over year boundary via Date.UTC which handles it for us).
function previousShanghaiMonth(): string {
  const todayShanghai = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [yStr, mStr] = todayShanghai.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}
