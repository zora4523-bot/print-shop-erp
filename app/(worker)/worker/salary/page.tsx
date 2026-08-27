import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WalletCards } from 'lucide-react';
import { Role, WorkerType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listWorkerHourlyPayrolls,
  listWorkerSalaries,
  type WorkerSalaryActor,
} from '@/lib/worker-portal';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui-business';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { Button } from '@/components/ui/button';

import { formatMoney } from '@/lib/dashboard/format';
export const metadata = { title: '我的工资' };

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

const HOURLY_WORKER_TYPES = new Set<WorkerType>([
  WorkerType.PACKER,
  WorkerType.CLEANER,
  WorkerType.COOK,
]);

export default async function WorkerSalaryPage({ searchParams }: PageProps) {
  const user = await requirePermission('salary:view:self');
  if (user.role !== Role.WORKER || !user.workerType) notFound();

  const actor: WorkerSalaryActor = {
    id: user.id,
    role: user.role,
    workerType: user.workerType,
  };
  const sp = await searchParams;

  if (user.workerType === WorkerType.MACHINE) {
    return <PieceworkSalaryContent actor={actor} searchParams={sp} />;
  }
  if (HOURLY_WORKER_TYPES.has(user.workerType)) {
    return (
      <HourlySalaryContent
        actor={actor}
        workerType={user.workerType}
        searchParams={sp}
      />
    );
  }
  notFound();
}

async function PieceworkSalaryContent({
  actor,
  searchParams: sp,
}: {
  actor: WorkerSalaryActor;
  searchParams: { from?: string; to?: string };
}) {
  const from = sp.from ? parseStrictYmd(sp.from) : null;
  const to = sp.to ? parseStrictYmd(sp.to) : null;
  const salaries = await listWorkerSalaries(actor, {
    from: from ?? undefined,
    to: to ?? undefined,
  });
  const { total, unpaid } = salaryTotals(salaries, 'actualSalary');

  return (
    <div className="min-w-0 space-y-4">
      <SalaryHeader description="开机师傅 · 点击日期查看工单和计件明细。" />
      <SalarySummary total={total} unpaid={unpaid} />
      <SalaryRangeFilter
        inputType="date"
        fromLabel="开始日期"
        toLabel="结束日期"
        from={from ? sp.from : undefined}
        to={to ? sp.to : undefined}
      />

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
                      <PaymentStatusBadge isPaid={salary.isPaid} />
                      {salaryFloorBadge(
                        new Decimal(
                          salary.totalPieceworkAmount as Decimal.Value,
                        ),
                        new Decimal(salary.baseSalary as Decimal.Value),
                      )}
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-xs text-muted-foreground">
                      {MACHINE_TYPE_LABELS[salary.machineType]} · {salary.taskCount}{' '}
                      项任务 / {salary.orderCount} 个工单
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      计件 {formatMoney(salary.totalPieceworkAmount)} · 保底 {formatMoney(salary.baseSalary)} · 调整{' '}
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
                  <SalaryAmount value={salary.actualSalary} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function HourlySalaryContent({
  actor,
  workerType,
  searchParams: sp,
}: {
  actor: WorkerSalaryActor;
  workerType: WorkerType;
  searchParams: { from?: string; to?: string };
}) {
  const fromMonth = validMonth(sp.from) ? sp.from : undefined;
  const toMonth = validMonth(sp.to) ? sp.to : undefined;
  const payrolls = await listWorkerHourlyPayrolls(actor, {
    fromMonth,
    toMonth,
  });
  const { total, unpaid } = salaryTotals(payrolls, 'totalSalary');

  return (
    <div className="min-w-0 space-y-4">
      <SalaryHeader
        description={`${WORKER_TYPE_LABELS[workerType]} · 点击月份查看工时和计薪明细。`}
      />
      <SalarySummary total={total} unpaid={unpaid} />
      <SalaryRangeFilter
        inputType="month"
        fromLabel="开始月份"
        toLabel="结束月份"
        from={fromMonth}
        to={toMonth}
      />

      {payrolls.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="暂无月结工资"
          description="管理员完成该月工资结算后，记录会显示在这里。"
        />
      ) : (
        <ul className="space-y-3">
          {payrolls.map((payroll) => {
            const payrollWorkerType = payroll.payrollWorkerType;
            const isCook = payrollWorkerType === WorkerType.COOK;
            return (
            <li key={payroll.id}>
              <Link
                href={`/worker/salary/${payroll.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="font-sans tabular-nums">
                        {payroll.month}
                      </strong>
                      <PaymentStatusBadge isPaid={payroll.isPaid} />
                      <Badge variant="outline">
                        {payrollWorkerType
                          ? WORKER_TYPE_LABELS[payrollWorkerType]
                          : '历史岗位未知'}
                      </Badge>
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-xs text-muted-foreground">
                      {isCook
                        ? `工作 ${String(payroll.totalWorkHours)} 小时 · 代班 ${String(payroll.totalSpareHours)} 小时`
                        : `正常 ${String(payroll.totalWorkHours)} 小时 · 加班 ${String(payroll.totalOtHours)} 小时`}
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      {isCook
                        ? `月薪 ¥${String(payroll.baseSalary)} · 代班费 ¥${String(payroll.spareSalary)}`
                        : `正常工资 ¥${String(payroll.baseSalary)} · 加班工资 ¥${String(payroll.otSalary)}`}
                    </p>
                  </div>
                  <SalaryAmount value={payroll.totalSalary} />
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SalaryHeader({ description }: { description: string }) {
  return (
    <header className="worker-wrap-anywhere">
      <h1 className="text-lg font-semibold">我的工资</h1>
      <p className="text-xs text-muted-foreground">{description}</p>
    </header>
  );
}

function SalarySummary({ total, unpaid }: { total: Decimal; unpaid: Decimal }) {
  return (
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
  );
}

function SalaryRangeFilter({
  inputType,
  fromLabel,
  toLabel,
  from,
  to,
}: {
  inputType: 'date' | 'month';
  fromLabel: string;
  toLabel: string;
  from?: string;
  to?: string;
}) {
  return (
    <form className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-3 text-sm min-[360px]:grid-cols-2">
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{fromLabel}</span>
        <input
          type={inputType}
          name="from"
          defaultValue={from ?? ''}
          className="min-h-11 w-full rounded-md border bg-background px-3"
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{toLabel}</span>
        <input
          type={inputType}
          name="to"
          defaultValue={to ?? ''}
          className="min-h-11 w-full rounded-md border bg-background px-3"
        />
      </label>
      <div className="flex flex-wrap gap-2 min-[360px]:col-span-2">
        <Button type="submit" className="min-h-11">
          查询范围
        </Button>
        <Link
          href="/worker/salary"
          className="inline-flex min-h-11 items-center px-3 text-sm underline"
        >
          清除
        </Link>
      </div>
    </form>
  );
}

// value 是 Prisma 的金额 Decimal；之前写 unknown 是因为直接 String()
// 渲染，换成 formatMoney 后需要真实类型。
function SalaryAmount({ value }: { value: Decimal.Value }) {
  return (
    <div className="ml-auto shrink-0 text-right">
      <p className="text-xs text-muted-foreground">实发</p>
      <p className="font-sans tabular-nums text-lg font-semibold text-foreground">
        {formatMoney(value)}
      </p>
    </div>
  );
}

function salaryTotals<T extends { isPaid: boolean }>(
  rows: T[],
  amountKey: keyof T,
) {
  const total = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row[amountKey] as Decimal.Value)),
    new Decimal(0),
  );
  const unpaid = rows
    .filter((row) => !row.isPaid)
    .reduce(
      (sum, row) => sum.plus(new Decimal(row[amountKey] as Decimal.Value)),
      new Decimal(0),
    );
  return { total, unpaid };
}

function validMonth(value: string | undefined): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '');
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
