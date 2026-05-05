import { NextResponse } from 'next/server';
import { getEndingPeriods } from '@/lib/dashboard/owner-watchlist';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { formatMoneyPlain } from '@/lib/dashboard/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC §8.1 CS_PERIOD_ENDING — 每日扫 7 天内将到期的客服周期（status
// = IN_PROGRESS, periodEnd 在 [今日 0:00, 今日 + 7d)）每条触发一次
// 推送到老板群 + 对应客服。同 Bearer 认证 + COUNTS ONLY 响应。
//
// 复用 lib/dashboard/owner-watchlist:getEndingPeriods（P1 #1 Slice B
// 已写，含 7 天 window + active CS_TIERS 预测提成）。本 cron 走相同
// 数据但只用其中的 csName / totalSales / daysLeft 字段。
//
// 重复触发说明：到期 7 天 → 7 个工作日里每天都触发一次。SPEC 没要求
// 去重。owner 一般会在最后两天采取行动（结算 / 审核）。
//
// Usage:
//   curl -X POST https://host/api/cron/cs-period-ending \
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
    const rows = await getEndingPeriods();
    for (const r of rows) {
      dispatchNotification('CS_PERIOD_ENDING', {
        periodId: r.id,
        csName: r.csDisplayName,
        daysLeft: r.daysUntilEnd,
        // owner-watchlist.totalSales 已是 Decimal-string toFixed(2)
        // 但**带过来还是要走 formatMoneyPlain** 拿千分位（template 同
        // 其他事件的金额字段一致；DECISIONS 2026-04-27 + round 110 P2）。
        totalSales: formatMoneyPlain(r.totalSales),
      });
    }
    return NextResponse.json({
      status: 'ok',
      endingCount: rows.length,
    });
  } catch {
    return NextResponse.json(
      { status: 'error', message: '批处理失败；查看 owner /owner 页面确认' },
      { status: 500 },
    );
  }
}
