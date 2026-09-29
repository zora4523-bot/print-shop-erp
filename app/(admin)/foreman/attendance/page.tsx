import Form from 'next/form';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { EmploymentType, WorkerType } from '@/generated/prisma/enums';
import {
  listActiveAttendanceEmployees,
  listMonthlyAttendance,
  parseShanghaiMonth,
} from '@/lib/attendance';
import { getActiveWorkHours } from '@/lib/salary/rules';
import { roleLabel, workerTypeLabel } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { AttendanceRecordDialog } from '@/components/business/attendance/AttendanceRecordDialog';
import { EmptyState, PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { currentShanghaiMonth } from '@/lib/dashboard/shanghai-clock';
import { formatDateInputShanghai } from '@/lib/format/dates';
import { NativeSelect } from '@/components/ui/native-select';

export const metadata = { title: '工时录入' };

type PageProps = {
  searchParams: Promise<{
    month?: string;
    workerId?: string;
    workerType?: string;
  }>;
};

// [start, end) → array of YYYY-MM-DD strings
function monthDates(month: string): string[] {
  const { start, end } = parseShanghaiMonth(month);
  const out: string[] = [];
  const cur = new Date(start);
  while (cur.getTime() < end.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Compute the "full-day" normal hours from WORK_HOURS rule. Used only
// as a UI hint for the quick-fill button — does NOT affect any saved
// numbers.
function computeFullDayNormalHours(rule: {
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
} | null): number | null {
  if (!rule) return null;
  const diff = (start: string, end: string): number => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em - sh * 60 - sm) / 60;
  };
  return diff(rule.morning.start, rule.morning.end) +
    diff(rule.afternoon.start, rule.afternoon.end);
}

export default async function ForemanAttendancePage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('attendance:manage');
  const sp = await searchParams;
  const selectedMonth =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentShanghaiMonth();

  // Selected worker drives the calendar view. Default: first hourly worker.
  const hourlyWorkers = await listActiveAttendanceEmployees();

  const selectedWorkerId = sp.workerId ?? hourlyWorkers[0]?.id ?? null;
  const selectedWorker = selectedWorkerId
    ? hourlyWorkers.find((w) => w.id === selectedWorkerId)
    : undefined;

  const [workHours, attendance] = await Promise.all([
    getActiveWorkHours(),
    selectedWorkerId
      ? listMonthlyAttendance(selectedWorkerId, selectedMonth)
      : Promise.resolve([]),
  ]);
  const fullDayNormal = computeFullDayNormalHours(workHours);
  const attendanceByDate = new Map(
    attendance.map((a) => [
      formatDateInputShanghai(a.date),
      a,
    ]),
  );

  const dates = monthDates(selectedMonth);
  const workedDays = attendance.reduce(
    (total, row) => total + Number(row.workUnits),
    0,
  );
  const leaveDays = attendance.reduce(
    (total, row) => total + Number(row.leaveUnits),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="工时录入"
        subtitle={
          <>
            按半天记录上班和请假；时薪岗位另填工时。
            {workHours ? (
              <>
                {' · '}当前工时段:{' '}
                <span className="font-sans tabular-nums">
                  {workHours.morning.start}–{workHours.morning.end} +{' '}
                  {workHours.afternoon.start}–{workHours.afternoon.end}
                </span>
                ，加班 <span className="font-sans tabular-nums">{workHours.otStart}</span> 起
              </>
            ) : (
              <span className="text-destructive">
                {' '}
                · 未配置工时规则，暂不能快速填&ldquo;全勤&rdquo;
              </span>
            )}
          </>
        }
      />

      <FilterBar
        selectedMonth={selectedMonth}
        selectedWorkerId={selectedWorkerId}
        workers={hourlyWorkers}
      />

      {!selectedWorker ? (
        <EmptyState
          icon={Users}
          title="没有可录考勤的在职员工"
          description={
            <>
              先在
              <Link href="/owner/accounts" className="mx-1 underline">
                账号管理
              </Link>
              里创建或启用员工，并设置用工类型。
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">
              {selectedWorker.displayName}
              <span className="ml-2 text-xs text-muted-foreground">
                ({roleLabel(selectedWorker.role)}
                {selectedWorker.workerType
                  ? ` · ${workerTypeLabel(selectedWorker.workerType)}`
                  : ''}
                {' · '}
                {selectedWorker.username})
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">实际上班 {workedDays} 天</Badge>
              <Badge variant="outline">请假 {leaveDays} 天</Badge>
              <Badge variant="outline">
                {EMPLOYMENT_LABELS[selectedWorker.employmentType]}
              </Badge>
            </div>
            {/* 员工筛选走 next/form 软导航，React 会按位置复用日历。key 带上员工与月份，
                切换员工后所有日卡（展开态）与录入面板（useState 初值）整体重建，
                杜绝用 A 的输入值、B 的 workerId 保存（服务端按 workerId_date upsert）。 */}
            <div
              key={`${selectedWorker.id}|${selectedMonth}`}
              className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7"
            >
              {dates.map((d) => {
                const att = attendanceByDate.get(d);
                const dayOfWeek = new Date(d + 'T00:00:00Z').getUTCDay();
                return (
                  <Disclosure
                    key={`${selectedWorker.id}|${d}`}
                    className={`min-w-0 rounded-md border p-2 text-xs open:col-span-full ${
                      att ? 'bg-muted/40' : 'bg-background'
                    }`}
                  >
                    <DisclosureSummary className="block font-normal">
                      <span className="flex items-center justify-between">
                        <span className="font-sans tabular-nums">{d.slice(8)}</span>
                        <span className="text-muted-foreground">
                          {['日', '一', '二', '三', '四', '五', '六'][dayOfWeek]}
                        </span>
                      </span>
                      {att ? (
                        <span className="mt-1 block font-sans tabular-nums text-xs leading-tight">
                          上班 {String(att.workUnits)} 天
                          {Number(att.leaveUnits) > 0 ? (
                            <>
                              <br />请假 {String(att.leaveUnits)} 天
                            </>
                          ) : null}
                          {Number(att.normalHours) > 0 ? (
                            <>
                              <br />N {String(att.normalHours)}
                            </>
                          ) : null}
                          {Number(att.otHours) > 0 ? (
                            <>
                              <br />O {String(att.otHours)}
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <Badge variant="outline" className="mt-1 text-xs">
                          未录
                        </Badge>
                      )}
                    </DisclosureSummary>
                    <AttendanceRecordDialog
                      workerId={selectedWorker.id}
                      workerName={selectedWorker.displayName}
                      workerType={selectedWorker.workerType}
                      date={d}
                      existing={
                        att
                          ? {
                              normalHours: String(att.normalHours),
                              otHours: String(att.otHours),
                              workUnits: String(att.workUnits),
                              leaveUnits: String(att.leaveUnits),
                              leaveType: att.leaveType,
                              remark: att.remark,
                            }
                          : undefined
                      }
                      quickFill={
                        selectedWorker.workerType === WorkerType.PACKER &&
                        fullDayNormal !== null &&
                        workHours
                          ? {
                              normalHours: fullDayNormal,
                              otStartHour: workHours.otStart,
                            }
                          : undefined
                      }
                    />
                  </Disclosure>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  selectedMonth,
  selectedWorkerId,
  workers,
}: {
  selectedMonth: string;
  selectedWorkerId: string | null;
  workers: Array<{
    id: string;
    displayName: string;
    workerType: WorkerType | null;
    role: Parameters<typeof roleLabel>[0];
    employmentType: EmploymentType;
    username: string;
  }>;
}) {
  return (
    // next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。
    <Form key={JSON.stringify([selectedMonth, selectedWorkerId ?? ''])} action="/foreman/attendance" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex min-w-0 max-w-full flex-col">
        <label
          htmlFor="attendance-month"
          className="text-xs text-muted-foreground"
        >
          月份
        </label>
        <input
          id="attendance-month"
          type="month"
          name="month"
          defaultValue={selectedMonth}
          className="min-w-0 max-w-full rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex min-w-0 max-w-full flex-col">
        <label
          htmlFor="attendance-worker"
          className="text-xs text-muted-foreground"
        >
          员工
        </label>
        <NativeSelect
          id="attendance-worker"
          name="workerId"
          defaultValue={selectedWorkerId ?? ''}
          className="w-auto min-w-0 max-w-full"
        >
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}（
              {roleLabel(w.role)}
              {w.workerType
                ? ` · ${workerTypeLabel(w.workerType)}`
                : ''}
              ）
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="sm">
        切换
      </Button>
    </Form>
  );
}

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  [EmploymentType.FULL_TIME]: '正式员工',
  [EmploymentType.PART_TIME]: '兼职',
  [EmploymentType.TEMPORARY]: '临时工',
};
