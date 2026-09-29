import Link from 'next/link';
import { Archive, Calculator } from 'lucide-react';
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
              设置员工薪酬规则
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
            tone="neutral"
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
            tone="warning"
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
        <h2 className="text-base font-semibold">历史日薪档案</h2>
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
            tone="warning"
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

      <Link href="/owner/salary/hourly" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        历史时薪档案
      </Link>
    </div>
  );
}
