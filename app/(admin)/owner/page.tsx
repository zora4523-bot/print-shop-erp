import { requirePermission } from '@/lib/auth/permissions';
import {
  getMonthlyBillStats,
  getTodayOrderStats,
} from '@/lib/dashboard/owner-stats';
import { formatMoney } from '@/lib/dashboard/format';
import { StatCard } from '@/components/business/dashboard/StatCard';

export const metadata = { title: '老板 Dashboard' };

// /owner is the OWNER landing page. Layered build (P1 #1):
//   - Slice A: 4 KPI cards (this commit)
//   - Slice B: watchlist tables (待发货 / 超期外协 / 即将结算客服周期)
//   - Slice C: charts (近 30 天产量 / 销售业绩 / 产品分布)
//
// Permission: `report:all` is OWNER-only; matches the (admin)/owner
// layout gate but keeps the page-level guard as defense in depth (the
// layout could be bypassed if a future Server Action reuses this page
// as a fragment — defensive habit, no measurable cost).
export default async function OwnerDashboardPage() {
  await requirePermission('report:all');

  const [today, monthly] = await Promise.all([
    getTodayOrderStats(),
    getMonthlyBillStats(),
  ]);

  // 完工同比：今日 vs 昨日。差值正→上升，负→下降，0→持平。
  const completedDiff = today.completedToday - today.completedYesterday;
  const completedDiffLabel =
    completedDiff > 0
      ? `较昨日 +${completedDiff}`
      : completedDiff < 0
        ? `较昨日 ${completedDiff}`
        : '与昨日持平';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          今日 <span className="font-mono">{today.date}</span> · 本月{' '}
          <span className="font-mono">{monthly.month}</span> · 时区
          Asia/Shanghai
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="今日提交工单"
          value={`${today.submittedToday} 单`}
          hint={
            today.urgentSubmittedToday > 0
              ? `其中急单 ${today.urgentSubmittedToday}`
              : '无急单'
          }
        />
        <StatCard
          label="今日完工"
          value={`${today.completedToday} 单`}
          hint={completedDiffLabel}
        />
        <StatCard label="今日发货" value={`${today.shippedToday} 单`} />
        <StatCard
          label="本月应收"
          value={formatMoney(monthly.total)}
          hint={
            <>
              已收 {formatMoney(monthly.paid)} · 未收{' '}
              <span className="font-mono">{formatMoney(monthly.outstanding)}</span>
            </>
          }
        />
      </section>
    </div>
  );
}
