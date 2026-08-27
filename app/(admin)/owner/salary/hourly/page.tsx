import Decimal from 'decimal.js';
import Link from 'next/link';
import { Calculator, FileText } from 'lucide-react';
import { listHourlyPayrolls } from '@/lib/salary/hourly-aggregate';
import { listUsers } from '@/lib/account';
import { WORKER_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Role, WorkerType } from '@/generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { RecomputeHourlyForm } from '@/components/business/salary/RecomputeHourlyForm';
import { MarkHourlyPaidForm } from '@/components/business/salary/MarkHourlyPaidForm';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { requirePermission } from '@/lib/auth/permissions';
import {
  ActionNotice,
  EmptyState,
  PageHeader,
  StatCard as UiStatCard,
} from '@/components/ui-business';
import {
  getAttendanceSummaries,
  parseShanghaiMonth,
} from '@/lib/attendance';
import { currentShanghaiMonth } from '@/lib/dashboard/shanghai-clock';

import { formatMoney } from '@/lib/dashboard/format';
export const metadata = { title: '时薪工月结' };

type PageProps = {
  searchParams: Promise<{
    month?: string;
    paid?: string;
    workerId?: string;
    marked?: string;
    markedPaid?: string;
  }>;
};

export default async function HourlySalaryPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  const currentMonth = currentShanghaiMonth();
  const selectedMonth =
    sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month)
      ? sp.month
      : currentMonth;
  const isPaid =
    sp.paid === 'paid' ? true : sp.paid === 'unpaid' ? false : undefined;
  const filterQuery = new URLSearchParams();
  if (sp.month) filterQuery.set('month', sp.month);
  if (sp.paid) filterQuery.set('paid', sp.paid);
  if (sp.workerId) filterQuery.set('workerId', sp.workerId);
  const returnTo = filterQuery.size
    ? `/owner/salary/hourly?${filterQuery.toString()}`
    : '/owner/salary/hourly';
  const markedName = sp.marked?.trim();
  const markedPaid = sp.markedPaid === '1';

  // 重算影响不能被页面的「已发 / 师傅」筛选误导：操作会
  // 扫描整个月份，因此额外读取该月全部现有月结，只将真实快照
  // 传给客户端确认层。
  const [rows, allMonthRows, accounts] = await Promise.all([
    listHourlyPayrolls({
      month: selectedMonth,
      workerId: sp.workerId,
      isPaid,
    }),
    listHourlyPayrolls({ month: selectedMonth }),
    listUsers(),
  ]);
  const payrollWorkerIds = new Set(allMonthRows.map((row) => row.workerId));
  const workers = accounts.filter(
    (account) =>
      account.id === sp.workerId ||
      payrollWorkerIds.has(account.id) ||
      (account.role === Role.WORKER &&
        (account.workerType === WorkerType.PACKER ||
          account.workerType === WorkerType.CLEANER ||
          account.workerType === WorkerType.COOK)),
  );
  const monthRange = parseShanghaiMonth(selectedMonth);
  const attendanceSummaries = await getAttendanceSummaries(
    rows.map((row) => row.workerId),
    monthRange,
  );

  const totalSalary = rows
    .reduce(
      (acc, r) => acc.plus(new Decimal(r.totalSalary as unknown as string)),
      new Decimal(0),
    )
    .toFixed(2);
  const unpaidSalary = rows
    .filter((r) => !r.isPaid)
    .reduce(
      (acc, r) => acc.plus(new Decimal(r.totalSalary as unknown as string)),
      new Decimal(0),
    )
    .toFixed(2);
  const allMonthUnpaidRows = allMonthRows.filter((row) => !row.isPaid);
  const recomputeContext = {
    existingRecordCount: allMonthRows.length,
    unpaidRecordCount: allMonthUnpaidRows.length,
    paidRecordCount: allMonthRows.length - allMonthUnpaidRows.length,
    unpaidTotal: allMonthUnpaidRows
      .reduce(
        (sum, row) =>
          sum.plus(new Decimal(row.totalSalary as unknown as string)),
        new Decimal(0),
      )
      .toFixed(2),
    sampleRows: allMonthRows.slice(0, 5).map((row) => ({
      workerName: row.worker.displayName,
      totalSalary: String(row.totalSalary),
      isPaid: row.isPaid,
    })),
  };

  return (
    <div className="space-y-6">
      {markedName ? (
        <ActionNotice
          tone="success"
          title={markedPaid ? '已标记发放' : '已撤销发放标记'}
          description={`${markedName} 的时薪月结已${markedPaid ? '标记为已发放' : '解除发放锁定'}。`}
          action={
            <Link
              href={returnTo}
              prefetch={false}
              className="text-sm font-medium underline underline-offset-2"
            >
              关闭提示
            </Link>
          }
        />
      ) : null}
      <PageHeader
        title="时薪工月结"
        subtitle="按上海日历月汇总打包、清废和厨师工资；已发放记录不可重算。"
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <RecomputeHourlyForm
          month={selectedMonth}
          maxMonth={currentMonth}
          context={recomputeContext}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UiStatCard
          label="记录数"
          value={`${rows.length} 条`}
          icon={FileText}
          tone="info"
        />
        <UiStatCard
          label="实发合计"
          value={`¥${totalSalary}`}
          icon={Calculator}
          tone="primary"
        />
        <UiStatCard
          label="未发合计"
          value={`¥${unpaidSalary}`}
          icon={Calculator}
          tone="warning"
        />
      </div>

      <FilterBar
        selectedMonth={selectedMonth}
        paid={sp.paid}
        workerId={sp.workerId}
        workers={workers}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`${selectedMonth} 暂无月结记录`}
          description="先点击上方&ldquo;重算该月全员时薪工月结&rdquo;生成数据。"
        />
      ) : (
        <div
          className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="时薪月结列表"
          tabIndex={0}
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">月份</th>
                <th className="px-4 py-2 text-left">师傅</th>
                <th className="px-4 py-2 text-left">类型</th>
                <th className="px-4 py-2 text-right">正常工时</th>
                <th className="px-4 py-2 text-right">加班 / 代班</th>
                <th className="px-4 py-2 text-right">上班 / 请假</th>
                <th className="px-4 py-2 text-right">底薪</th>
                <th className="px-4 py-2 text-right">加班费 / 代班费</th>
                <th className="px-4 py-2 text-right">实发</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                // Render the immutable payroll snapshot, never the employee's
                // current account type. A later transfer must not relabel a
                // historical PACKER row as COOK and swap overtime for spare pay.
                const wt = r.payrollWorkerType;
                const isCook = wt === WorkerType.COOK;
                const attendance = attendanceSummaries.get(r.workerId) ?? {
                  workUnits: '0',
                  leaveUnits: '0',
                };
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-sans tabular-nums text-xs">{r.month}</td>
                    <td className="px-4 py-3">{r.worker.displayName}</td>
                    <td className="px-4 py-3 text-xs">
                      {wt ? (WORKER_TYPE_LABELS[wt] ?? '未识别岗位') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {String(r.totalWorkHours)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {isCook
                        ? `${String(r.totalSpareHours)} (代班)`
                        : `${String(r.totalOtHours)} (加班)`}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {attendance.workUnits} / {attendance.leaveUnits} 天
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      {String(r.baseSalary)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs text-muted-foreground">
                      {isCook ? String(r.spareSalary) : String(r.otSalary)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                      {formatMoney(r.totalSalary)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PaymentStatusBadge isPaid={r.isPaid} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MarkHourlyPaidForm
                        id={r.id}
                        currentPaid={r.isPaid}
                        workerName={r.worker.displayName}
                        month={r.month}
                        totalSalary={String(r.totalSalary)}
                        returnTo={returnTo}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  selectedMonth,
  paid,
  workerId,
  workers,
}: {
  selectedMonth: string;
  paid: string | undefined;
  workerId: string | undefined;
  workers: Array<{
    id: string;
    username: string;
    displayName: string;
    isActive: boolean;
  }>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label htmlFor="hourly-month" className="text-xs text-muted-foreground">月份</label>
        <input
          id="hourly-month"
          type="month"
          name="month"
          defaultValue={selectedMonth}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="hourly-paid" className="text-xs text-muted-foreground">状态</label>
        <select
          id="hourly-paid"
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
        <label htmlFor="hourly-workerId" className="text-xs text-muted-foreground">师傅</label>
        <select
          id="hourly-workerId"
          name="workerId"
          defaultValue={workerId ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部师傅</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName}（{worker.username}
              {worker.isActive ? '' : ' · 已停用'}）
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <Link
        href="/owner/salary/hourly"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}
