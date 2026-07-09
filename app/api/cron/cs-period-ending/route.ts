import { NextResponse } from 'next/server';
import { getEndingPeriods } from '@/lib/dashboard/owner-watchlist';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { formatMoneyPlain } from '@/lib/dashboard/format';
import { requireCronAuth } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC §8.1 CS_PERIOD_ENDING — 每日扫 7 天内将到期的客服周期（status
// = IN_PROGRESS, periodEnd 在 [今日 0:00, 今日 + 7d)）每条触发一次
// 推送。同 Bearer 认证 + COUNTS ONLY 响应。
//
// 路由限制：notify 按 eventType 单 rule 取
// channelIds 全发；当前 schema 没 per-user 路由字段，所以 SPEC §8.1
// &ldquo;老板群 + 对应客服&rdquo;只能落&ldquo;老板群&rdquo;那部分——owner 在
// /owner/notifications 给 CS_PERIOD_ENDING rule 绑老板群 channel
// 即可。&ldquo;对应客服&rdquo; 1:1 推送等 per-user channel 字段进 schema 后再
// 加（P2 / 不阻 MVP）。本路由不会把单条消息分发给某个客服的私群——
// fan-out 是 rule 配置的所有 channel 一视同仁。
//
// 复用 lib/dashboard/owner-watchlist:getEndingPeriods（P1 #1 Slice B
// 已写，含 7 天 window + active CS_TIERS 预测提成）。本 cron 走相同
// 数据但只用其中的 csName / salesForTier / daysLeft 字段。
//
// 重复触发说明：到期 7 天 → 7 个工作日里每天都触发一次。SPEC 没要求
// 去重。owner 一般会在最后两天采取行动（结算 / 审核）。
//
// Usage:
//   curl -X POST https://host/api/cron/cs-period-ending \
//     -H "Authorization: Bearer $CRON_SECRET"
export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const rows = await getEndingPeriods();
    for (const r of rows) {
      dispatchNotification('CS_PERIOD_ENDING', {
        periodId: r.id,
        csName: r.csDisplayName,
        daysLeft: r.daysUntilEnd,
        // **用 salesForTier**（= totalSales + initialSales），不是
        // 单纯 totalSales。提成档位是按合计算的，dashboard 同款 bug
        // 在 round 99 已修过（owner-page 用 salesForTier 显示&ldquo;业绩
        // 合计&rdquo;）。这里 cron 推送同口径——否则有 initialSales 的客服
        // 推送出来的&ldquo;当前业绩&rdquo;会比命中档位的业绩低，老板看不出为什么
        // 提成是这么多。formatMoneyPlain 千分位
        // 不带 ¥（DECISIONS 2026-04-27 + round 109 P2）。
        totalSales: formatMoneyPlain(r.salesForTier),
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
