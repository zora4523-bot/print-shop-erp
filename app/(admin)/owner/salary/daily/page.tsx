import Decimal from 'decimal.js';
import { Calculator, Download, FileText, Settings } from 'lucide-react';
import {
  listDailyWorkerSalaries,
  listMachineWorkersForSalary,
} from '@/lib/salary/daily';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { MachineType } from '@/generated/prisma/enums';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { RecomputeDailyForm } from '@/components/business/salary/RecomputeDailyForm';
import { MarkPaidForm } from '@/components/business/salary/MarkPaidForm';
import { formatDateShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import {
  EmptyState,
  PageHeader,
  StatCard as UiStatCard,
} from '@/components/ui-business';

export const metadata = { title: '计件工资' };

// URL filters travel as plain query params. `date` defaults to today's
// Shanghai calendar date; `paid` accepts "paid" | "unpaid" | anything
// else (show all).
type PageProps = {
  searchParams: Promise<{ date?: string; paid?: string; workerId?: string }>;
};

function todayShanghai(): string {
  // Intl is the cheapest way to get YYYY-MM-DD in a timezone — we just
  // build the parts explicitly so the format doesn't drift on locale.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

export default async function DailySalaryPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  // Strict calendar validation on the filter path: `?date=2026-02-31`
  // must not silently normalize to March 3 .
  // Fall back to today when the query is malformed.
  const selectedDate =
    sp.date && parseStrictYmd(sp.date) ? sp.date : todayShanghai();
  const isPaid =
    sp.paid === 'paid' ? true : sp.paid === 'unpaid' ? false : undefined;

  const [rows, workers] = await Promise.all([
    listDailyWorkerSalaries({
      date: selectedDate,
      isPaid,
      workerId: sp.workerId,
    }),
    listMachineWorkersForSalary(),
  ]);

  // Aggregate in Decimal — rows are Prisma Decimal, and JS float
  // addition can drift by cents when summing 50+ rows.
  const totalActual = rows
    .reduce(
      (acc, r) => acc.plus(new Decimal(r.actualSalary as unknown as string)),
      new Decimal(0),
    )
    .toFixed(2);
  const unpaidActual = rows
    .filter((r) => !r.isPaid)
    .reduce(
      (acc, r) => acc.plus(new Decimal(r.actualSalary as unknown as string)),
      new Decimal(0),
    )
    .toFixed(2);

  return (
    <div className="space-y-6">
      <PageHeader
        title="计件工资"
        subtitle="按上海日历天汇总已完工任务，逐项关联工单；工资取计件合计与当日保底较高者，再加人工调整。"
        actions={
          <div className="flex gap-2">
            <Link
              href="/owner/salary/piecework-rules"
              className={buttonVariants({ variant: 'outline' })}
            >
              <Settings className="mr-2 size-4" />
              计件规则
            </Link>
            <Link
              href={`/api/salary/piecework/export?date=${selectedDate}${sp.workerId ? `&workerId=${encodeURIComponent(sp.workerId)}` : ''}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className="mr-2 size-4" />
              导出 Excel
            </Link>
          </div>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <RecomputeDailyForm defaultDate={selectedDate} />
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UiStatCard
          label="记录数"
          value={rows.length.toString()}
          icon={FileText}
          tone="info"
        />
        <UiStatCard
          label="当日实发合计"
          value={`¥ ${totalActual}`}
          icon={Calculator}
          tone="primary"
        />
        <UiStatCard
          label="未发合计"
          value={`¥ ${unpaidActual}`}
          icon={Calculator}
          tone="warning"
        />
      </div>

      <FilterBar
        selectedDate={selectedDate}
        paid={sp.paid}
        workerId={sp.workerId}
        workers={workers}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`${selectedDate} 暂无日薪记录`}
          description="先点击上方&ldquo;重算该日全员日薪&rdquo;生成数据。"
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">日期</th>
                <th className="px-4 py-2 text-left">师傅</th>
                <th className="px-4 py-2 text-left">机型</th>
                <th className="px-4 py-2 text-right">计件合计</th>
                <th className="px-4 py-2 text-right">保底</th>
                <th className="px-4 py-2 text-right">调整</th>
                <th className="px-4 py-2 text-right">实发</th>
                <th className="px-4 py-2 text-center">任务 / 工单</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-sans tabular-nums text-xs">
                    {formatDateShanghai(r.date)}
                  </td>
                  <td className="px-4 py-3">{r.worker.displayName}</td>
                  <td className="px-4 py-3 text-xs">
                    {MACHINE_TYPE_LABELS[r.machineType as MachineType] ??
                      r.machineType}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(r.totalPieceworkAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs text-muted-foreground">
                    {String(r.baseSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {Number(r.adjustmentAmount) > 0 ? '+' : ''}
                    {String(r.adjustmentAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                    ¥ {String(r.actualSalary)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-sans tabular-nums">
                    {r.taskCount} / {r.orderCount}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.isPaid ? (
                      <Badge>已发</Badge>
                    ) : (
                      <Badge variant="outline">未发</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/owner/salary/daily/${r.id}`}
                        className={buttonVariants({ size: 'sm', variant: 'outline' })}
                      >
                        核对明细
                      </Link>
                      <MarkPaidForm id={r.id} currentPaid={r.isPaid} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  selectedDate,
  paid,
  workerId,
  workers,
}: {
  selectedDate: string;
  paid: string | undefined;
  workerId: string | undefined;
  workers: Array<{ id: string; displayName: string; username: string }>;
}) {
  // Plain GET form — the searchParams round-trip is server-rendered
  // so filtering doesn't need any client JS. No form action attribute
  // means "submit to the same URL", exactly what we want.
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">日期</label>
        <input
          type="date"
          name="date"
          defaultValue={selectedDate}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">状态</label>
        <select
          name="paid"
          defaultValue={paid ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部</option>
          <option value="unpaid">仅未发</option>
          <option value="paid">仅已发</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">师傅</label>
        <select
          name="workerId"
          defaultValue={workerId ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部师傅</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName}（{worker.username}）
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className={buttonVariants({ size: 'sm' })}
      >
        筛选
      </button>
      <Link
        href="/owner/salary/daily"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}
