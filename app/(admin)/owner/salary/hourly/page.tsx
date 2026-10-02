import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import Form from 'next/form';
import { Calculator, FileText } from 'lucide-react';
import { listHourlyPayrolls, listHourlyPayrollWorkerIds } from '@/lib/salary/hourly-aggregate';
import { listUsers } from '@/lib/account';
import { WORKER_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { requirePermission } from '@/lib/auth/permissions';
import { EmptyState, PageHeader, StatCard as UiStatCard, TableScrollArea, FilterClearLink } from '@/components/ui-business';
import {
  getAttendanceSummaries,
  parseShanghaiMonth,
} from '@/lib/attendance';
import { currentShanghaiMonth } from '@/lib/dashboard/shanghai-clock';

import { formatMoney } from '@/lib/dashboard/format';
import { NativeSelect } from '@/components/ui/native-select';
export const metadata = { title: '历史时薪档案' };

type PageProps = {
  searchParams: Promise<{
    month?: string;
    paid?: string;
    workerId?: string;
    page?: string | string[];
    pageSize?: string | string[];
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
  const [salaryPage, archivedWorkerIds, accounts] = await Promise.all([
    listHourlyPayrolls({
      month: selectedMonth,
      workerId: sp.workerId,
      isPaid,
      page: sp.page,
      pageSize: sp.pageSize,
    }),
    listHourlyPayrollWorkerIds(selectedMonth),
    listUsers(),
  ]);
  const { rows } = salaryPage;
  const payrollWorkerIds = new Set(archivedWorkerIds);
  const workers = accounts.filter(
    (account) =>
      account.id === sp.workerId ||
      payrollWorkerIds.has(account.id),
  );
  const monthRange = parseShanghaiMonth(selectedMonth);
  const attendanceSummaries = await getAttendanceSummaries(
    rows.map((row) => row.workerId),
    monthRange,
  );

  const totalSalary = salaryPage.totalSalary;
  const unpaidSalary = salaryPage.unpaidSalary;

  return (
    <div className="space-y-6">
      <PageHeader title="历史时薪档案" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UiStatCard
          label="记录数"
          value={`${salaryPage.total} 条`}
          icon={FileText}
          tone="neutral"
        />
        <UiStatCard
          label="实发合计"
          value={formatMoney(totalSalary)}
          icon={Calculator}
          tone="neutral"
        />
        <UiStatCard
          label="未发合计"
          value={formatMoney(unpaidSalary)}
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
          description="可选择其他月份查看历史记录。"
        />
      ) : (
        <TableScrollArea label="时薪月结列表" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">月份</th>
                <th className="px-4 py-2 text-left">师傅</th>
                <th className="px-4 py-2 text-left">类型</th>
                <th className="px-4 py-2 text-right">正常工时</th>
                <th className="px-4 py-2 text-right">加班</th>
                <th className="px-4 py-2 text-right">上班 / 请假</th>
                <th className="px-4 py-2 text-right">底薪</th>
                <th className="px-4 py-2 text-right">加班费</th>
                <th className="px-4 py-2 text-right">实发</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                // Render the immutable payroll snapshot, never the employee's
                // current account type.
                const wt = r.payrollWorkerType;
                const attendance = attendanceSummaries.get(r.workerId) ?? {
                  workUnits: '0',
                  leaveUnits: '0',
                };
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-sans tabular-nums text-xs">{r.month}</td>
                    <td className="min-w-40 max-w-64 whitespace-normal break-words px-4 py-3">{r.worker.displayName}</td>
                    <td className="px-4 py-3 text-xs">
                      {wt ? (WORKER_TYPE_LABELS[wt] ?? '未识别岗位') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {String(r.totalWorkHours)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {String(r.totalOtHours)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                      {attendance.workUnits} / {attendance.leaveUnits} 天
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      {String(r.baseSalary)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums text-xs text-muted-foreground">
                      {String(r.otSalary)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                      {formatMoney(r.totalSalary)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PaymentStatusBadge isPaid={r.isPaid} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-muted-foreground">已归档</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollArea>
      )}
      <AdminPagination
        basePath="/owner/salary/hourly"
        {...salaryPage}
        queryParams={{ month: selectedMonth, paid: sp.paid, workerId: sp.workerId, pageSize: salaryPage.pageSize }}
      />
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
    // next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。
    <Form id="salary-hourly-filters" key={JSON.stringify([selectedMonth, paid ?? '', workerId ?? ''])} action="/owner/salary/hourly" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label htmlFor="hourly-month" className="text-xs text-muted-foreground">月份</label>
        <Input
          id="hourly-month"
          type="month"
          name="month"
          defaultValue={selectedMonth}
          className="w-auto"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="hourly-paid" className="text-xs text-muted-foreground">状态</label>
        <NativeSelect
          className="w-auto"
          id="hourly-paid"
          name="paid"
          defaultValue={paid ?? ''}
        >
          <option value="">全部</option>
          <option value="unpaid">仅未发</option>
          <option value="paid">仅已发</option>
        </NativeSelect>
      </div>
      <div className="flex min-w-0 max-w-full flex-col">
        <label htmlFor="hourly-workerId" className="text-xs text-muted-foreground">师傅</label>
        <NativeSelect
          id="hourly-workerId"
          name="workerId"
          defaultValue={workerId ?? ''}
          className="w-full min-w-0"
        >
          <option value="">全部师傅</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName}（{worker.username}
              {worker.isActive ? '' : ' · 已停用'}）
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <FilterClearLink formId="salary-hourly-filters"
        href="/owner/salary/hourly"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除筛选
      </FilterClearLink>
    </Form>
  );
}
