import { NextResponse } from 'next/server';
import { settleReadyCsPeriods } from '@/lib/salary/cs';
import { db } from '@/lib/db';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { formatMoneyPlain } from '@/lib/dashboard/format';

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

    // Slice D wire ─ CS_PERIOD_SETTLED（per-period notify；payload 含
    // csName/totalSales/commission，模板渲染&ldquo;客服 张三 周期业绩 ¥X
    // 提成 ¥Y&rdquo;。批量结算时一次发 N 条群消息——SPEC §8.1 没要求合并，
    // 老板群也希望看到具体哪个客服结了多少）。csName 走一次 batch
    // user fetch 拼回（避免 N+1）。
    if (settled.length > 0) {
      const csIds = Array.from(new Set(settled.map((s) => s.csUserId)));
      const users = await db.user.findMany({
        where: { id: { in: csIds } },
        select: { id: true, displayName: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.displayName]));
      for (const s of settled) {
        const csName = nameById.get(s.csUserId) ?? s.csUserId;
        dispatchNotification('CS_PERIOD_SETTLED', {
          settledCount: settled.length,
          csName,
          totalSales: formatMoneyPlain(s.totalSales),
          commission: formatMoneyPlain(s.commissionAmount),
        });
      }
    }

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
