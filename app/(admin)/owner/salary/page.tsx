import Link from 'next/link';
import { Archive, Calculator, CalendarClock, Clock } from 'lucide-react';
import { getSalaryIndexSummary } from '@/lib/salary/summary';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader, StatCard } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { formatMoney } from '@/lib/dashboard/format';

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
            今日：<span className="font-sans tabular-nums">{s.today}</span> · 按上海日历统计。
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={RULE_CENTER_HREFS.employeePay}
              className={buttonVariants({ variant: 'outline' })}
            >
              设置员工工资规则
            </Link>
          </div>
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">工序计件结算</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="今日已锁定"
            value={`${s.pieceworkToday.count} 条`}
            icon={Calculator}
            tone="info"
            hint={`合计 ${formatMoney(s.pieceworkToday.payableTotal)}`}
          />
          <StatCard
            label="今日未发"
            value={formatMoney(s.pieceworkToday.unpaidTotal)}
            icon={Calculator}
            tone="warning"
          />
          <StatCard
            label="累计未发（所有日期）"
            value={formatMoney(s.pieceworkUnpaidAllTime.payableTotal)}
            icon={Calculator}
            tone="primary"
            hint={`${s.pieceworkUnpaidAllTime.count} 条`}
          />
        </div>
        <div>
          <Link
            href="/owner/salary/piecework"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看工序计件结算 →
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">历史开机师傅日薪档案</h2>
        <p className="text-sm text-muted-foreground">
          历史日薪记录
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="今日历史记录"
            value={`${s.dailyToday.count} 条`}
            icon={Archive}
            tone="neutral"
            hint={`历史金额合计 ${formatMoney(s.dailyToday.actualTotal)}`}
          />
          <StatCard
            label="历史累计未发"
            value={formatMoney(s.dailyUnpaidAllTime.actualTotal)}
            icon={Archive}
            tone="neutral"
            hint={`${s.dailyUnpaidAllTime.count} 条`}
          />
        </div>
        <Link
          href="/owner/salary/daily"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          查看历史日薪档案 →
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">客服周期 / 提成</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="活跃周期"
            value={`${s.csActivePeriods} 个`}
            icon={CalendarClock}
            tone="info"
            hint="每位客服最多一条进行中周期"
          />
          <StatCard
            label="待结算（已到期）"
            value={`${s.csReadyToSettle} 个`}
            icon={CalendarClock}
            tone={s.csReadyToSettle > 0 ? 'warning' : 'neutral'}
            hint="周期已结束"
          />
          <StatCard
            label="已结算周期剩余未发"
            value={formatMoney(s.csUnpaid.totalIncome)}
            icon={CalendarClock}
            tone="primary"
            hint={`${s.csUnpaid.count} 个已结算但未全额发放周期（剩余底薪 + 提成）`}
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
          时薪工月结（清废 / 厨师）
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={`${s.currentMonth} 记录`}
            value={`${s.hourlyCurrentMonth.count} 条`}
            icon={Clock}
            tone="info"
            hint={`合计 ${formatMoney(s.hourlyCurrentMonth.totalSalary)}`}
          />
          <StatCard
            label={`${s.currentMonth} 未发`}
            value={formatMoney(s.hourlyCurrentMonth.unpaidTotal)}
            icon={Clock}
            tone="warning"
          />
          <StatCard
            label="累计未发（所有月份）"
            value={formatMoney(s.hourlyUnpaidAllTime.totalSalary)}
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
        <p className="text-xs text-muted-foreground">
          历史打包时薪记录
        </p>
      </section>
    </div>
  );
}
