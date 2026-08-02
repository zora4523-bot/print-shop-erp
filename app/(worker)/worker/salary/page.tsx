import Decimal from 'decimal.js';
import Link from 'next/link';
import { WalletCards } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerSalaries } from '@/lib/worker-portal';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui-business';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { Button } from '@/components/ui/button';

export const metadata = { title: '我的计件工资' };

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function WorkerSalaryPage({ searchParams }: PageProps) {
  const user = await requirePermission('salary:view:self');
  const sp = await searchParams;
  const from = sp.from ? parseStrictYmd(sp.from) : null;
  const to = sp.to ? parseStrictYmd(sp.to) : null;
  const salaries = await listWorkerSalaries(
    { id: user.id, role: user.role },
    { from: from ?? undefined, to: to ?? undefined },
  );
  const total = salaries.reduce(
    (sum, salary) => sum.plus(new Decimal(salary.actualSalary as Decimal.Value)),
    new Decimal(0),
  );
  const unpaid = salaries
    .filter((salary) => !salary.isPaid)
    .reduce(
      (sum, salary) => sum.plus(new Decimal(salary.actualSalary as Decimal.Value)),
      new Decimal(0),
    );

  return (
    <div className="min-w-0 space-y-4">
      <header className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">我的计件工资</h1>
        <p className="text-xs text-muted-foreground">
          只显示当前登录师傅自己的日薪；点击日期核对关联工单和每项计件。
        </p>
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">累计工资</p>
          <p className="worker-wrap-anywhere mt-1 font-sans tabular-nums text-lg font-semibold">
            ¥ {total.toFixed(2)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">尚未发放</p>
          <p className="worker-wrap-anywhere mt-1 font-sans tabular-nums text-lg font-semibold">
            ¥ {unpaid.toFixed(2)}
          </p>
        </div>
      </section>

      <form className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-3 text-sm min-[360px]:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">开始日期</span>
          <input
            type="date"
            name="from"
            defaultValue={from ? sp.from : ''}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">结束日期</span>
          <input
            type="date"
            name="to"
            defaultValue={to ? sp.to : ''}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          />
        </label>
        <div className="flex flex-wrap gap-2 min-[360px]:col-span-2">
          <Button type="submit" className="min-h-11">
            查询日期
          </Button>
          <Link
            href="/worker/salary"
            className="inline-flex min-h-11 items-center px-3 text-sm underline"
          >
            清除
          </Link>
        </div>
      </form>

      {salaries.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="暂无计件工资"
          description="任务报工并由系统生成日薪后，记录会显示在这里。"
        />
      ) : (
        <ul className="space-y-3">
          {salaries.map((salary) => (
            <li key={salary.id}>
              <Link
                href={`/worker/salary/${salary.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong>{formatDateShanghai(salary.date)}</strong>
                      {salary.isPaid ? (
                        <Badge variant="secondary">已发</Badge>
                      ) : (
                        <Badge variant="outline">未发</Badge>
                      )}
                      {salaryFloorBadge(
                        new Decimal(
                          salary.totalPieceworkAmount as Decimal.Value,
                        ),
                        new Decimal(salary.baseSalary as Decimal.Value),
                      )}
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-xs text-muted-foreground">
                      {MACHINE_TYPE_LABELS[salary.machineType]} ·{' '}
                      {salary.taskCount} 项任务 / {salary.orderCount} 个工单
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      计件 ¥{String(salary.totalPieceworkAmount)} · 保底 ¥
                      {String(salary.baseSalary)} · 调整{' '}
                      {Number(salary.adjustmentAmount) > 0 ? '+' : ''}
                      {String(salary.adjustmentAmount)}
                    </p>
                    {new Decimal(
                      salary.totalPieceworkAmount as Decimal.Value,
                    ).lt(new Decimal(salary.baseSalary as Decimal.Value)) ? (
                      <p className="worker-wrap-anywhere mt-1 text-xs text-warning-foreground">
                        原因：当日计件未达到保底，按每日底薪计算。
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">实发</p>
                    <p className="font-sans tabular-nums text-lg font-semibold text-foreground">
                      ¥ {String(salary.actualSalary)}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function salaryFloorBadge(piecework: Decimal, base: Decimal) {
  if (piecework.gt(base)) {
    return <Badge variant="secondary">计件高于保底</Badge>;
  }
  if (piecework.eq(base)) {
    return <Badge variant="outline">计件等于保底</Badge>;
  }
  return <Badge variant="outline">按保底补足</Badge>;
}
