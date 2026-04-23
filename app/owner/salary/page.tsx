import Link from 'next/link';
import { getSalaryIndexSummary } from '@/lib/salary/summary';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '薪资总览' };

export default async function SalaryIndexPage() {
  const s = await getSalaryIndexSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">薪资总览</h1>
        <p className="text-sm text-muted-foreground">
          今日：<span className="font-mono">{s.today}</span> · 所有金额按 Asia/Shanghai 日历。
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">师傅日薪</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="今日记录"
            value={`${s.dailyToday.count} 条`}
            hint={`合计 ¥${s.dailyToday.actualTotal}`}
          />
          <StatCard
            label="今日未发"
            value={`¥${s.dailyToday.unpaidTotal}`}
          />
          <StatCard
            label="累计未发（所有日期）"
            value={`¥${s.dailyUnpaidAllTime.actualTotal}`}
            hint={`${s.dailyUnpaidAllTime.count} 条`}
          />
        </div>
        <div>
          <Link
            href="/owner/salary/daily"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看日薪列表 →
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">客服周期 / 提成</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="活跃周期"
            value={`${s.csActivePeriods} 个`}
            hint="每位客服一条 IN_PROGRESS"
          />
          <StatCard
            label="待结算（已到期）"
            value={`${s.csReadyToSettle} 个`}
            hint="periodEnd 已过"
            highlight={s.csReadyToSettle > 0}
          />
          <StatCard
            label="未发提成合计"
            value={`¥${s.csUnpaid.totalIncome}`}
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

      <p className="text-xs text-muted-foreground">
        时薪工月薪（打包 / 清废 / 厨师）模块 P0 #5 Slice C 还未落地。考勤表尚未建表。
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 shadow-sm ${
        highlight ? 'border-destructive/60' : ''
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
