import { NextResponse } from 'next/server';
import { getOverdueOutsourcing } from '@/lib/dashboard/owner-watchlist';
import { dispatchNotification } from '@/lib/notification/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC §8.1 OUTSOURCE_OVERDUE — 每日扫超期外协（status ∈ SENT/IN_PROGRESS
// 且 expectedDate < 今日 0:00 Shanghai）每条触发一次推送到管理群。
// 同 /api/cron/daily-salary / cs-settle 的 Bearer 认证 + COUNTS ONLY
// 响应（DECISIONS 2026-04-24）。
//
// 复用 lib/dashboard/owner-watchlist:getOverdueOutsourcing（P1 #1
// Slice B 已写）：同一查询逻辑（NOT null filter / shanghaiDayBoundary
// / daysOverdue 计算）—— dashboard 显示和 cron 推送共用一份事实。
//
// 重复触发说明：每天跑一次 cron，同一个超期外协会每天触发一条群
// 消息（SPEC §8 没说去重；提醒不嫌多）。如未来要&ldquo;一条外协一周只
// 报一次&rdquo;，加 NotificationLog 去重表 per-(event,relatedRefId,
// 日期) —— 本 Slice 不做。
//
// Usage:
//   curl -X POST https://host/api/cron/outsource-overdue \
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
    const rows = await getOverdueOutsourcing();
    for (const r of rows) {
      dispatchNotification('OUTSOURCE_OVERDUE', {
        outsourceId: r.id,
        supplierName: r.supplierName,
        orderNo: r.orderNo,
        daysOverdue: r.daysOverdue,
        expectedDate: formatDateShanghai(r.expectedDate),
      });
    }
    return NextResponse.json({
      status: 'ok',
      overdueCount: rows.length,
    });
  } catch {
    // notify 永不抛（dispatch 兜底），到这里只可能是 getOverdueOutsourcing
    // 自己挂（DB 连接断）。返通用错误，不泄露 message。
    return NextResponse.json(
      { status: 'error', message: '批处理失败；查看 owner /owner 页面确认' },
      { status: 500 },
    );
  }
}

function formatDateShanghai(d: Date): string {
  // 与 owner watchlist 显示一致：YYYY/MM/DD
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
