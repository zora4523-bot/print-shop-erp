import { NextResponse } from 'next/server';
import { getDueOrders } from '@/lib/dashboard/owner-watchlist';
import { orderStatusZh } from '@/lib/order/log-format';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { formatDateShanghai } from '@/lib/format/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ORDER_OVERDUE（业主 2026-07-07 新增）——每日扫"承诺交期已过仍未
// 发货"的工单，每条推送一次到管理群。查询复用 dashboard 交期预警的
// getDueOrders（同一口径：PROMISE_ALERT_STATUSES + 上海日历日），这里
// 只取 daysLeft < 0 的逾期子集——"3 天内到期"留在 dashboard 提醒，
// 不进群刷屏。
//
// Bearer 认证 + COUNTS ONLY 响应（DECISIONS 2026-04-24：cron 输出可
// 落 pg_cron 日志，不得含客户/金额明细）。
//
// 重复触发：每天一条直至发货或改期——同 OUTSOURCE_OVERDUE 的语义，
// 提醒不嫌多。
//
// Usage:
//   curl -X POST https://host/api/cron/order-overdue \
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
    const rows = (await getDueOrders()).filter((r) => r.daysLeft < 0);
    for (const r of rows) {
      dispatchNotification('ORDER_OVERDUE', {
        orderId: r.id,
        orderNo: r.orderNo,
        customerRef: r.customerRef ?? '未填',
        promisedDate: formatDateShanghai(r.promisedDate),
        daysOverdue: -r.daysLeft,
        status: orderStatusZh(r.status),
      });
    }
    return NextResponse.json({
      status: 'ok',
      overdueCount: rows.length,
    });
  } catch {
    // notify 永不抛（dispatch 兜底），到这里只可能是 getDueOrders 自己
    // 挂（DB 连接断）。返通用错误，不泄露 message。
    return NextResponse.json(
      { status: 'error', message: '批处理失败；查看 owner /owner 页面确认' },
      { status: 500 },
    );
  }
}

