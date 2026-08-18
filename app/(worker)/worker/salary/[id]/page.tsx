import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Role,
  SalaryAdjustmentType,
  WorkerType,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getWorkerHourlyPayrollDetail,
  getWorkerSalaryDetail,
  type WorkerSalaryActor,
} from '@/lib/worker-portal';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import Decimal from 'decimal.js';
import { getAttendanceSummaries } from '@/lib/attendance';

import { formatMoney } from '@/lib/dashboard/format';
type PageProps = { params: Promise<{ id: string }> };

const ADJUSTMENT_LABELS: Record<SalaryAdjustmentType, string> = {
  BONUS: '奖金',
  DEDUCTION: '扣款',
  CORRECTION: '差错修正',
};

export default async function WorkerSalaryDetailPage({ params }: PageProps) {
  const user = await requirePermission('salary:view:self');
  if (user.role !== Role.WORKER || !user.workerType) notFound();
  const { id } = await params;
  const actor: WorkerSalaryActor = {
    id: user.id,
    role: user.role,
    workerType: user.workerType,
  };

  if (user.workerType !== WorkerType.MACHINE) {
    const payroll = await getWorkerHourlyPayrollDetail(id, actor);
    if (!payroll) notFound();
    return <HourlySalaryDetail payroll={payroll} />;
  }

  const salary = await getWorkerSalaryDetail(id, actor);
  if (!salary) notFound();
  const attendanceEnd = new Date(salary.date);
  attendanceEnd.setUTCDate(attendanceEnd.getUTCDate() + 1);
  const attendance =
    (
      await getAttendanceSummaries([user.id], {
        start: salary.date,
        end: attendanceEnd,
      })
    ).get(user.id) ?? { workUnits: '0', leaveUnits: '0' };
  const pieceworkVsBase = new Decimal(
    salary.totalPieceworkAmount as Decimal.Value,
  ).cmp(new Decimal(salary.baseSalary as Decimal.Value));

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="worker-wrap-anywhere min-w-0 text-lg font-semibold">
            {formatDateShanghai(salary.date)} 工资明细
          </h1>
          {salary.isPaid ? (
            <Badge variant="secondary">已发</Badge>
          ) : (
            <Badge variant="outline">未发</Badge>
          )}
          <Badge variant={pieceworkVsBase > 0 ? 'secondary' : 'outline'}>
            {pieceworkVsBase > 0
              ? '计件高于保底'
              : pieceworkVsBase === 0
                ? '计件等于保底'
                : '按保底补足'}
          </Badge>
          <Badge variant="outline">上班 {attendance.workUnits} 天</Badge>
          <Badge variant="outline">请假 {attendance.leaveUnits} 天</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {MACHINE_TYPE_LABELS[salary.machineType]} ·
          只展示当前账号自己的计件记录
        </p>
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <Money label="计件合计" value={salary.totalPieceworkAmount} />
        <Money label="每日保底" value={salary.baseSalary} />
        <Money label="人工调整" value={salary.adjustmentAmount} />
        <Money label="实发工资" value={salary.actualSalary} strong />
      </section>
      {pieceworkVsBase < 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          当日计件工资未达到每日底薪，因此本日工资按底薪计算，再叠加人工调整。
        </p>
      ) : null}

      {salary.adjustments.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">工资调整</h2>
          <ul className="mt-2 divide-y text-sm">
            {salary.adjustments.map((entry) => (
              <li key={entry.id} className="py-2">
                <div className="flex min-w-0 flex-wrap gap-3 sm:flex-nowrap">
                  <span className="worker-wrap-anywhere min-w-0 flex-1">
                    {ADJUSTMENT_LABELS[entry.type]} · {entry.reason}
                  </span>
                  <span className="ml-auto shrink-0 font-sans tabular-nums">
                    {Number(entry.amount) > 0 ? '+' : ''}
                    {String(entry.amount)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeShanghai(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">计件任务（{salary.items.length}）</h2>
        <ul className="mt-2 divide-y">
          {salary.items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/worker/orders/${item.orderId}`}
                    className="worker-wrap-anywhere inline-flex min-h-11 min-w-11 items-center font-sans tabular-nums text-foreground underline decoration-primary"
                  >
                    {item.orderNo}
                  </Link>
                  <p className="worker-wrap-anywhere mt-1">
                    {item.orderItemName} · {item.craftName}
                  </p>
                  <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                    良品 {item.completedQty} · 次品 {item.defectQty} · 返工{' '}
                    {item.reworkQty} · 板 {item.boardCount} · 下{' '}
                    {item.pressCount}
                  </p>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="font-sans tabular-nums font-medium">
                    {formatMoney(item.pieceworkAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeShanghai(item.completedAt)}
                  </p>
                </div>
              </div>
            </li>
          ))}
          {salary.items.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">
              该日没有任务明细。
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

type HourlySalaryDetailData = NonNullable<
  Awaited<ReturnType<typeof getWorkerHourlyPayrollDetail>>
>;

function HourlySalaryDetail({
  payroll,
}: {
  payroll: HourlySalaryDetailData;
}) {
  const workerType = payroll.payrollWorkerType;
  const isCook = workerType === WorkerType.COOK;
  const dailyDetails = parseHourlyDailyDetails(payroll.dailyDetail);

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="worker-wrap-anywhere min-w-0 text-lg font-semibold">
            {payroll.month} 工资明细
          </h1>
          {payroll.isPaid ? (
            <Badge variant="secondary">已发</Badge>
          ) : (
            <Badge variant="outline">未发</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {workerType ? WORKER_TYPE_LABELS[workerType] : '历史岗位未知'} ·
          只展示当前账号自己的月结记录
        </p>
        {payroll.isPaid && payroll.paidAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            发放时间：{formatDateTimeShanghai(payroll.paidAt)}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <Metric label="正常工时" value={`${String(payroll.totalWorkHours)} 小时`} />
        <Metric
          label={isCook ? '代班工时' : '加班工时'}
          value={`${String(
            isCook ? payroll.totalSpareHours : payroll.totalOtHours,
          )} 小时`}
        />
        <Metric
          label={isCook ? '代班时薪' : '正常时薪'}
          value={`¥ ${String(payroll.hourlyRate)} / 小时`}
        />
        {isCook ? null : (
          <Metric
            label="加班倍率"
            value={`${String(payroll.otMultiplier)} 倍`}
          />
        )}
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <Money
          label={isCook ? '月薪' : '正常工时工资'}
          value={payroll.baseSalary}
        />
        <Money
          label={isCook ? '代班工资' : '加班工资'}
          value={isCook ? payroll.spareSalary : payroll.otSalary}
        />
        <Money label="实发工资" value={payroll.totalSalary} strong />
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">每日工时（{dailyDetails.length}）</h2>
        {dailyDetails.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            该月没有每日工时明细。
          </p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {dailyDetails.map((detail) => (
              <li key={detail.date} className="py-3">
                <p className="font-sans tabular-nums font-medium">
                  {detail.date}
                </p>
                <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                  正常 {detail.normalHours} 小时 ·{' '}
                  {isCook
                    ? `代班 ${detail.spareHours} 小时`
                    : `加班 ${detail.otHours} 小时`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/worker/salary"
        className="inline-flex min-h-11 items-center text-sm underline decoration-primary"
      >
        返回我的工资
      </Link>
    </div>
  );
}

type HourlyDailyDetail = {
  date: string;
  normalHours: string;
  otHours: string;
  spareHours: string;
};

function parseHourlyDailyDetails(value: unknown): HourlyDailyDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.date !== 'string') return [];
    return [
      {
        date: row.date,
        normalHours: String(row.normalHours ?? '0'),
        otHours: String(row.otHours ?? '0'),
        spareHours: String(row.spareHours ?? '0'),
      },
    ];
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="worker-wrap-anywhere mt-1 font-sans tabular-nums font-medium">
        {value}
      </p>
    </div>
  );
}

function Money({
  label,
  value,
  strong = false,
}: {
  label: string;
  // Prisma 的金额列在这一层是 Decimal；之前写 unknown 是因为直接
  // String() 渲染，换成 formatMoney 后需要真实类型才能保证格式化正确。
  value: Decimal.Value;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`worker-wrap-anywhere mt-1 font-sans tabular-nums ${
          strong ? 'text-lg font-semibold text-foreground' : 'font-medium'
        }`}
      >
        {formatMoney(value)}
      </p>
    </div>
  );
}
