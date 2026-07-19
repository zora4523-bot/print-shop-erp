import Link from 'next/link';
import { Calculator, CalendarClock, Clock } from 'lucide-react';
import { getSalaryIndexSummary } from '@/lib/salary/summary';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader, StatCard } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = { title: '薪资总览' };

export default async function SalaryIndexPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const s = await getSalaryIndexSummary();

  return (
    <div className="space-y-6">
      <PageHeader
        title="薪资总览"
        subtitle={
          <>
            今日：<span className="font-sans tabular-nums">{s.today}</span> · 所有金额按 Asia/Shanghai 日历。
          </>
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">生产师傅计件工资</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="今日记录"
            value={`${s.dailyToday.count} 条`}
            icon={Calculator}
            tone="info"
            hint={`合计 ¥${s.dailyToday.actualTotal}`}
          />
          <StatCard
            label="今日未发"
            value={`¥${s.dailyToday.unpaidTotal}`}
            icon={Calculator}
            tone="warning"
          />
          <StatCard
            label="累计未发（所有日期）"
            value={`¥${s.dailyUnpaidAllTime.actualTotal}`}
            icon={Calculator}
            tone="primary"
            hint={`${s.dailyUnpaidAllTime.count} 条`}
          />
        </div>
        <div>
          <Link
            href="/owner/salary/daily"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看计件工资明细 →
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">客服周期 / 提成</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="活跃周期"
            value={`${s.csActivePeriods} 个`}
            icon={CalendarClock}
            tone="info"
            hint="每位客服一条 IN_PROGRESS"
          />
          <StatCard
            label="待结算（已到期）"
            value={`${s.csReadyToSettle} 个`}
            icon={CalendarClock}
            tone={s.csReadyToSettle > 0 ? 'warning' : 'neutral'}
            hint="periodEnd 已过"
          />
          <StatCard
            label="未发提成合计"
            value={`¥${s.csUnpaid.totalIncome}`}
            icon={CalendarClock}
            tone="primary"
            hint={`${s.csUnpaid.count} 条`}
          />
        </div>
        <div>
          <Link
            href="/owner/salary/cs"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看客服周期 →
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          时薪工月结（打包 / 清废 / 厨师）
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label={`${s.currentMonth} 记录`}
            value={`${s.hourlyCurrentMonth.count} 条`}
            icon={Clock}
            tone="info"
            hint={`合计 ¥${s.hourlyCurrentMonth.totalSalary}`}
          />
          <StatCard
            label={`${s.currentMonth} 未发`}
            value={`¥${s.hourlyCurrentMonth.unpaidTotal}`}
            icon={Clock}
            tone="warning"
          />
          <StatCard
            label="累计未发（所有月份）"
            value={`¥${s.hourlyUnpaidAllTime.totalSalary}`}
            icon={Clock}
            tone="primary"
            hint={`${s.hourlyUnpaidAllTime.count} 条`}
          />
        </div>
        <div>
          <Link
            href="/owner/salary/hourly"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看时薪工月结 →
          </Link>
        </div>
      </section>
    </div>
  );
}
