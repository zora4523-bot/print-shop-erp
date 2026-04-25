import { NextResponse } from 'next/server';
import { Role } from '@/generated/prisma/enums';
import { generateBillsForPeriod } from '@/lib/bill';

// Node runtime: Prisma + decimal.js aren't edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shared-secret endpoint for the "月初汇总上月销售应收账单" job (P0 #6
// Slice D / SPEC §3.1). Same shape as /api/cron/daily-salary —
// pg_cron-friendly POST, COUNTS-ONLY response so generated[] /
// errors[] don't leak金额 / 销售名 into pg_cron logs (Codex round 49
// pattern reused).
//
// Usage:
//   curl -X POST https://host/api/cron/generate-bills \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -d '{"period":"2026-04"}'
//
// When `period` is omitted, defaults to last month's Shanghai
// calendar month — that's the canonical "月初处理上月" pattern, so the
// scheduler doesn't need to know the period itself.
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

  // Distinguish "field absent → use default" from "field present but
  // malformed → reject 400". On a mutating endpoint, silently treating
  // {"period": ""} as &ldquo;run for last month&rdquo; would re-process the
  // previous period when the caller meant something specific (Codex
  // round 61 / P2).
  const extracted = extractPeriod(body);
  if (extracted.explicit && extracted.value === null) {
    return NextResponse.json(
      { error: 'invalid period: present but malformed' },
      { status: 400 },
    );
  }
  const period = extracted.value ?? lastMonthShanghai();
  // Strict YYYY-MM + month-range validation. generateBillsForPeriod →
  // parseShanghaiMonth would throw on month > 12, but doing the check
  // here keeps the response a clean 400 instead of a generic 500.
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    return NextResponse.json(
      { error: `invalid period: ${period}` },
      { status: 400 },
    );
  }

  try {
    const r = await generateBillsForPeriod(period, {
      id: 'system',
      role: Role.OWNER,
    });
    // COUNTS ONLY — generated[] embeds salesUserId + totalAmount,
    // errors[] can embed BillError messages with period + status.
    // Owner sees details at /owner/bills.
    return NextResponse.json({
      status: 'ok',
      period: r.period,
      generatedCount: r.generated.length,
      errorCount: r.errors.length,
    });
  } catch (err) {
    void err;
    return NextResponse.json(
      {
        status: 'error',
        period,
        message: '账单生成批处理失败；查看 owner 页面确认',
      },
      { status: 500 },
    );
  }
}

// `explicit=true` means the caller sent a `period` field; `value=null`
// in that case means the value was malformed (empty / non-string). The
// caller turns that into a 400 instead of silently defaulting.
function extractPeriod(
  body: unknown,
): { value: string | null; explicit: boolean } {
  if (body && typeof body === 'object' && 'period' in body) {
    const v = (body as { period: unknown }).period;
    if (typeof v === 'string' && v.trim() !== '') {
      return { value: v.trim(), explicit: true };
    }
    return { value: null, explicit: true };
  }
  return { value: null, explicit: false };
}

function lastMonthShanghai(): string {
  // Take "now in Shanghai", then back up to the 1st of last month.
  // Build via Intl parts so we don't drift on UTC-vs-Shanghai dates.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  // 1月 → 上月是去年12月。
  const lastYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  return `${lastYear}-${String(lastMonth).padStart(2, '0')}`;
}
