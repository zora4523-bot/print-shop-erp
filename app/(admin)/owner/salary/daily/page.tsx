import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import Decimal from 'decimal.js';
import Form from 'next/form';
import Link from 'next/link';
import { Archive, Calculator, Download, FileText } from 'lucide-react';
import { MachineType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateShanghai } from '@/lib/format/dates';
import {
  listDailyWorkerSalaries,
  listMachineWorkersForSalary,
} from '@/lib/salary/daily';
import { getAttendanceSummaries } from '@/lib/attendance';
import { Button, buttonVariants } from '@/components/ui/button';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { SalaryFloorBadge } from '@/components/business/salary/SalaryFloorBadge';
import { EmptyState, PageHeader, StatCard, TableScrollArea } from '@/components/ui-business';

export const metadata = { title: '历史日薪档案' };

type PageProps = {
  searchParams: Promise<{
    date?: string;
    paid?: string;
    workerId?: string;
    page?: string | string[];
    pageSize?: string | string[];
  }>;
};

export default async function DailySalaryPage({ searchParams }: PageProps) {
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  const selectedDate =
    sp.date && parseStrictYmd(sp.date) ? sp.date : todayShanghai();
  const isPaid =
    sp.paid === 'paid' ? true : sp.paid === 'unpaid' ? false : undefined;
  const [salaryPage, workers] = await Promise.all([
    listDailyWorkerSalaries({
      date: selectedDate,
      isPaid,
      page: sp.page,
      pageSize: sp.pageSize,
      workerId: sp.workerId,
    }),
    listMachineWorkersForSalary(),
  ]);
  const { rows } = salaryPage;
  const attendanceStart = parseStrictYmd(selectedDate)!;
  const attendanceEnd = new Date(attendanceStart);
  attendanceEnd.setUTCDate(attendanceEnd.getUTCDate() + 1);
  const attendanceSummaries = await getAttendanceSummaries(
    rows.map((row) => row.workerId),
    { start: attendanceStart, end: attendanceEnd },
  );
  const totalActual = salaryPage.totalSalary;
  const unpaidActual = salaryPage.unpaidSalary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="历史日薪档案"
        subtitle="历史日薪记录"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/owner/salary/piecework"
              className={buttonVariants({ variant: 'outline' })}
            >
              <Archive className="mr-2 size-4" />
              工序计件结算
            </Link>
            <a
              href={`/api/salary/piecework/export?date=${selectedDate}${sp.workerId ? `&workerId=${encodeURIComponent(sp.workerId)}` : ''}`}
              className={buttonVariants({ variant: 'outline' })}
              download
            >
              <Download className="mr-2 size-4" />
              导出历史记录
            </a>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="历史记录"
          value={`${salaryPage.total} 条`}
          icon={FileText}
          tone="neutral"
        />
        <StatCard
          label="历史实发合计"
          value={formatMoney(totalActual)}
          icon={Calculator}
          tone="neutral"
        />
        <StatCard
          label="历史未发合计"
          value={formatMoney(unpaidActual)}
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
          title={`${selectedDate} 暂无历史日薪记录`}
          description="该页不再生成或重算日薪。"
        />
      ) : (
        <TableScrollArea label="历史日薪记录" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full min-w-[960px] text-sm">
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
                <th className="px-4 py-2 text-center">上班 / 请假</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-sans tabular-nums text-xs">
                    {formatDateShanghai(row.date)}
                  </td>
                  <td className="px-4 py-3">{row.worker.displayName}</td>
                  <td className="px-4 py-3 text-xs">
                    {MACHINE_TYPE_LABELS[row.machineType as MachineType] ??
                      '未识别机型'}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(row.totalPieceworkAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs text-muted-foreground">
                    {String(row.baseSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {Number(row.adjustmentAmount) > 0 ? '+' : ''}
                    {String(row.adjustmentAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                    {formatMoney(row.actualSalary)}
                  </td>
                  <td className="px-4 py-3 text-center font-sans tabular-nums text-xs">
                    {row.taskCount} / {row.orderCount}
                  </td>
                  <td className="px-4 py-3 text-center font-sans tabular-nums text-xs">
                    {attendanceSummaries.get(row.workerId)?.workUnits ?? '0'} /{' '}
                    {attendanceSummaries.get(row.workerId)?.leaveUnits ?? '0'} 天
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <PaymentStatusBadge isPaid={row.isPaid} />
                      <SalaryFloorBadge
                        piecework={row.totalPieceworkAmount as Decimal.Value}
                        base={row.baseSalary as Decimal.Value}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/salary/daily/${row.id}`}
                      className={buttonVariants({
                        size: 'sm',
                        variant: 'outline',
                      })}
                    >
                      查看明细
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}
      <AdminPagination
        basePath="/owner/salary/daily"
        {...salaryPage}
        queryParams={{ date: selectedDate, paid: sp.paid, workerId: sp.workerId, pageSize: salaryPage.pageSize }}
      />
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
  paid?: string;
  workerId?: string;
  workers: Array<{ id: string; displayName: string; username: string }>;
}) {
  return (
    <Form action="/owner/salary/daily" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <label className="min-w-0 max-w-full space-y-1">
        <span className="block text-xs text-muted-foreground">日期</span>
        <input
          type="date"
          name="date"
          defaultValue={selectedDate}
          className="min-w-0 max-w-full rounded-md border bg-background px-3 py-1 text-sm"
        />
      </label>
      <label className="min-w-0 max-w-full space-y-1">
        <span className="block text-xs text-muted-foreground">历史发放状态</span>
        <select
          name="paid"
          defaultValue={paid ?? ''}
          className="min-w-0 max-w-full rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部</option>
          <option value="unpaid">仅未发</option>
          <option value="paid">仅已发</option>
        </select>
      </label>
      <label className="min-w-0 max-w-full space-y-1">
        <span className="block text-xs text-muted-foreground">师傅</span>
        <select
          name="workerId"
          defaultValue={workerId ?? ''}
          className="min-w-0 max-w-full rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部师傅</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName}（{worker.username}）
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <Link
        href="/owner/salary/daily"
        scroll={false}
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除筛选
      </Link>
    </Form>
  );
}
