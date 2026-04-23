import Decimal from 'decimal.js';
import { listDailyWorkerSalaries } from '@/lib/salary/daily';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { MachineType } from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { RecomputeDailyForm } from '@/components/business/salary/RecomputeDailyForm';
import { MarkPaidForm } from '@/components/business/salary/MarkPaidForm';

export const metadata = { title: '师傅日薪' };

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

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export default async function DailySalaryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const selectedDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
    ? sp.date
    : todayShanghai();
  const isPaid =
    sp.paid === 'paid' ? true : sp.paid === 'unpaid' ? false : undefined;

  const rows = await listDailyWorkerSalaries({
    date: selectedDate,
    isPaid,
    workerId: sp.workerId,
  });

  // Aggregate in Decimal — rows are Prisma Decimal, and JS float
  // addition can drift by cents when summing 50+ rows (Codex round
  // 43 / P2).
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
      <div>
        <h1 className="text-xl font-semibold">师傅日薪</h1>
        <p className="text-sm text-muted-foreground">
          按 Asia/Shanghai 日历天汇总当日已完工的 `ProductionTask` 计件，取
          max(汇总, 当日保底)。
        </p>
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <RecomputeDailyForm defaultDate={selectedDate} />
      </section>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <StatCard label="记录数" value={rows.length.toString()} />
        <StatCard label="当日实发合计" value={`¥ ${totalActual}`} />
        <StatCard label="未发合计" value={`¥ ${unpaidActual}`} />
      </div>

      <FilterBar
        selectedDate={selectedDate}
        paid={sp.paid}
        workerId={sp.workerId}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {selectedDate} 暂无日薪记录。先&ldquo;重算该日全员日薪&rdquo;生成数据。
        </div>
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
                <th className="px-4 py-2 text-right">实发</th>
                <th className="px-4 py-2 text-center">任务 / 工单</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatDate(r.date)}
                  </td>
                  <td className="px-4 py-3">{r.worker.displayName}</td>
                  <td className="px-4 py-3 text-xs">
                    {MACHINE_TYPE_LABELS[r.machineType as MachineType] ??
                      r.machineType}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {String(r.totalPieceworkAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {String(r.baseSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    ¥ {String(r.actualSalary)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-mono">
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
                    <MarkPaidForm id={r.id} currentPaid={r.isPaid} />
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
    </div>
  );
}

function FilterBar({
  selectedDate,
  paid,
  workerId,
}: {
  selectedDate: string;
  paid: string | undefined;
  workerId: string | undefined;
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
        <label className="text-xs text-muted-foreground">师傅 id (可选)</label>
        <input
          type="text"
          name="workerId"
          defaultValue={workerId ?? ''}
          placeholder="留空=全部"
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
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
