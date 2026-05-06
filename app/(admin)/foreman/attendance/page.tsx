import Link from 'next/link';
import { Users } from 'lucide-react';
import { db } from '@/lib/db';
import { Role, WorkerType } from '@/generated/prisma/enums';
import { listMonthlyAttendance, parseShanghaiMonth } from '@/lib/attendance';
import { getActiveWorkHours } from '@/lib/salary/rules';
import { WORKER_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { AttendanceRecordDialog } from '@/components/business/attendance/AttendanceRecordDialog';
import { EmptyState, PageHeader } from '@/components/ui-business';

export const metadata = { title: '时薪工考勤' };

type PageProps = {
  searchParams: Promise<{
    month?: string;
    workerId?: string;
    workerType?: string;
  }>;
};

function currentShanghaiMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

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
  const sp = await searchParams;
  const selectedMonth =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentShanghaiMonth();

  // Selected worker drives the calendar view. Default: first hourly worker.
  const rawHourlyWorkers = await db.user.findMany({
    where: {
      role: Role.WORKER,
      isActive: true,
      workerType: {
        in: [WorkerType.PACKER, WorkerType.CLEANER, WorkerType.COOK],
      },
    },
    orderBy: [{ workerType: 'asc' }, { displayName: 'asc' }],
    select: { id: true, displayName: true, workerType: true, username: true },
  });
  // workerType is nullable at the schema level; the `in` filter above
  // guarantees non-null but TS's narrowing doesn't see through Prisma
  // filters. Cast once here so downstream props stay cleanly typed.
  const hourlyWorkers = rawHourlyWorkers as Array<{
    id: string;
    displayName: string;
    workerType: WorkerType;
    username: string;
  }>;

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
      a.date.toISOString().slice(0, 10),
      a,
    ]),
  );

  const dates = monthDates(selectedMonth);

  return (
    <div className="space-y-6">
      <PageHeader
        title="时薪工考勤"
        subtitle={
          <>
            PACKER / CLEANER / COOK 每日录入工时。未录 = 请假。月底
            &ldquo;时薪工月结&rdquo; 按此汇总计算工资。
            {workHours ? (
              <>
                {' · '}当前工时段:{' '}
                <span className="font-mono">
                  {workHours.morning.start}–{workHours.morning.end} +{' '}
                  {workHours.afternoon.start}–{workHours.afternoon.end}
                </span>
                ，加班 <span className="font-mono">{workHours.otStart}</span> 起
              </>
            ) : (
              <span className="text-destructive">
                {' '}
                · WORK_HOURS 规则未配置，快速填&ldquo;全勤&rdquo;不可用
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
          title="没有活跃的时薪工"
          description={
            <>
              先在
              <Link href="/owner/accounts" className="mx-1 underline">
                账号管理
              </Link>
              里创建或启用 PACKER / CLEANER / COOK。
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-sm font-semibold">
              {selectedWorker.displayName}
              <span className="ml-2 text-xs text-muted-foreground">
                ({WORKER_TYPE_LABELS[selectedWorker.workerType as WorkerType]} ·{' '}
                {selectedWorker.username})
              </span>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2 text-xs">
              {dates.map((d) => {
                const att = attendanceByDate.get(d);
                const dayOfWeek = new Date(d + 'T00:00:00Z').getUTCDay();
                return (
                  <details
                    key={d}
                    className={`rounded-md border p-2 text-xs ${
                      att ? 'bg-muted/40' : 'bg-background'
                    }`}
                  >
                    <summary className="cursor-pointer">
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{d.slice(8)}</span>
                        <span className="text-muted-foreground">
                          {['日', '一', '二', '三', '四', '五', '六'][dayOfWeek]}
                        </span>
                      </div>
                      {att ? (
                        <div className="mt-1 font-mono text-[10px] leading-tight">
                          N {String(att.normalHours)}
                          {Number(att.otHours) > 0 ? (
                            <>
                              <br />O {String(att.otHours)}
                            </>
                          ) : null}
                          {Number(att.spareHours) > 0 ? (
                            <>
                              <br />S {String(att.spareHours)}
                            </>
                          ) : null}
                        </div>
                      ) : (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          未录
                        </Badge>
                      )}
                    </summary>
                    <AttendanceRecordDialog
                      workerId={selectedWorker.id}
                      workerName={selectedWorker.displayName}
                      workerType={selectedWorker.workerType as WorkerType}
                      date={d}
                      existing={
                        att
                          ? {
                              normalHours: String(att.normalHours),
                              otHours: String(att.otHours),
                              spareHours: String(att.spareHours),
                              remark: att.remark,
                            }
                          : undefined
                      }
                      quickFill={
                        fullDayNormal !== null && workHours
                          ? {
                              normalHours: fullDayNormal,
                              otStartHour: workHours.otStart,
                            }
                          : undefined
                      }
                    />
                  </details>
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
    workerType: WorkerType;
    username: string;
  }>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">月份</label>
        <input
          type="month"
          name="month"
          defaultValue={selectedMonth}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">工人</label>
        <select
          name="workerId"
          defaultValue={selectedWorkerId ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayName}（
              {WORKER_TYPE_LABELS[w.workerType] ?? w.workerType}）
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className={buttonVariants({ size: 'sm' })}
      >
        切换
      </button>
    </form>
  );
}
