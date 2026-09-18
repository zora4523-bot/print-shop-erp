import { formatRate } from '@/lib/format/unit-price';
import { reportWageLines } from '@/lib/salary/report-display';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import {
  Role,
  SalaryAdjustmentType,
  PieceworkOperationType,
  ProductionReportEntryType,
  PieceworkSettlementStatus,
  WorkerType,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import {
  getWorkerHourlyPayrollDetail,
  getWorkerPieceworkSettlementDetail,
  getWorkerSalaryDetail,
} from '@/lib/worker-portal';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { SalaryFloorBadge } from '@/components/business/salary/SalaryFloorBadge';
import Decimal from 'decimal.js';
import { getAttendanceSummaries } from '@/lib/attendance';

import { formatMoney } from '@/lib/dashboard/format';

type PageProps = { params: Promise<{ id: string }> };

const getWorkerPieceworkSalaryPageData = cache(
  (id: string, actorId: string, actorRole: Role, workerType: WorkerType) =>
    getWorkerSalaryDetail(id, {
      id: actorId,
      role: actorRole,
      workerType,
    }),
);

const getWorkerHourlySalaryPageData = cache(
  (id: string, actorId: string, actorRole: Role, workerType: WorkerType) =>
    getWorkerHourlyPayrollDetail(id, {
      id: actorId,
      role: actorRole,
      workerType,
    }),
);

const getWorkerOperationSettlementPageData = cache(
  (id: string, actorId: string, actorRole: Role, workerType: WorkerType) =>
    getWorkerPieceworkSettlementDetail(id, {
      id: actorId,
      role: actorRole,
      workerType,
    }),
);

const ADJUSTMENT_LABELS: Record<SalaryAdjustmentType, string> = {
  BONUS: '奖金',
  DEDUCTION: '扣款',
  CORRECTION: '差错修正',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const session = await getSession();
  const user = session?.user;
  if (!user || user.role !== Role.WORKER || !user.workerType) {
    return { title: '我的工资' };
  }

  const { id } = await params;
  if (
    user.workerType === WorkerType.MACHINE ||
    user.workerType === WorkerType.PACKER
  ) {
    const settlement = await getWorkerOperationSettlementPageData(
      id,
      user.id,
      user.role,
      user.workerType,
    );
    if (settlement) {
      return {
        title: `${formatDateShanghai(settlement.workDate)} · 我的工序计件`,
      };
    }
  }
  if (user.workerType === WorkerType.MACHINE) {
    const salary = await getWorkerPieceworkSalaryPageData(
      id,
      user.id,
      user.role,
      user.workerType,
    );
    return {
      title: salary
        ? `${formatDateShanghai(salary.date)} · 我的工资`
        : '工资记录不存在',
    };
  }

  const payroll = await getWorkerHourlySalaryPageData(
    id,
    user.id,
    user.role,
    user.workerType,
  );
  return {
    title: payroll ? `${payroll.month} · 我的工资` : '工资记录不存在',
  };
}

export default async function WorkerSalaryDetailPage({ params }: PageProps) {
  const user = await requirePermission('salary:view:self');
  if (user.role !== Role.WORKER || !user.workerType) notFound();
  const { id } = await params;

  if (
    user.workerType === WorkerType.MACHINE ||
    user.workerType === WorkerType.PACKER
  ) {
    const settlement = await getWorkerOperationSettlementPageData(
      id,
      user.id,
      user.role,
      user.workerType,
    );
    if (settlement) {
      return <OperationSettlementDetail settlement={settlement} />;
    }
  }

  if (user.workerType !== WorkerType.MACHINE) {
    const payroll = await getWorkerHourlySalaryPageData(
      id,
      user.id,
      user.role,
      user.workerType,
    );
    if (!payroll) notFound();
    return <HourlySalaryDetail payroll={payroll} />;
  }

  const salary = await getWorkerPieceworkSalaryPageData(
    id,
    user.id,
    user.role,
    user.workerType,
  );
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
          <PaymentStatusBadge isPaid={salary.isPaid} />
          <SalaryFloorBadge
            piecework={salary.totalPieceworkAmount as Decimal.Value}
            base={salary.baseSalary as Decimal.Value}
          />
          <Badge variant="outline">上班 {attendance.workUnits} 天</Badge>
          <Badge variant="outline">请假 {attendance.leaveUnits} 天</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {MACHINE_TYPE_LABELS[salary.machineType]}
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
                  <Link
                    href={`/worker/tasks/${item.productionTaskId}`}
                    className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-primary underline"
                  >
                    查看任务 / 提出计件异议
                  </Link>
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

type OperationSettlementDetailData = NonNullable<
  Awaited<ReturnType<typeof getWorkerPieceworkSettlementDetail>>
>;

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  PARTIAL: '局部烫金',
  FULL: '专版烫金',
  PACKING: '打包入袋',
};

function OperationSettlementDetail({
  settlement,
}: {
  settlement: OperationSettlementDetailData;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="worker-wrap-anywhere min-w-0 text-lg font-semibold">
            {formatDateShanghai(settlement.workDate)} 工序计件明细
          </h1>
          <PaymentStatusBadge
            isPaid={settlement.status === PieceworkSettlementStatus.PAID}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          按报工和调整记录查看本人工资。
        </p>
        {settlement.paidAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            发放时间：{formatDateTimeShanghai(settlement.paidAt)}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <Money label="报工金额" value={settlement.reportAmount} />
        <Money label="调整" value={settlement.adjustmentAmount} />
        <Money label="应发工资" value={settlement.payableAmount} strong />
        <Metric label="报工明细" value={`${settlement.items.length} 条`} />
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">工序报工（{settlement.items.length}）</h2>
        <ul className="mt-2 divide-y">
          {settlement.items.map(({ report }) => (
            <li key={report.id} className="py-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/worker/orders/${report.operation.order.id}`}
                    className="worker-wrap-anywhere inline-flex min-h-11 min-w-11 items-center font-sans tabular-nums text-foreground underline decoration-primary"
                  >
                    {report.operation.order.orderNo}
                  </Link>
                  <p className="worker-wrap-anywhere mt-1">
                    {OPERATION_LABELS[report.operation.operationType]}
                    {report.entryType === ProductionReportEntryType.ADJUSTMENT ? ' · 人工调整' : report.entryType === ProductionReportEntryType.REVERSAL
                      ? ' · 冲正'
                      : ''}
                  </p>
                  <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                    合格 {String(report.reportedCompletedQty)} · 缺陷{' '}
                    {String(report.defectQty)} · 返工 {String(report.reworkQty)}
                  </p>
                  {reportWageLines({ ...report, operationType: report.operation.operationType, chargeableQty: String(report.chargeableQty), rate: String(report.rate), amount: String(report.amount) }).map((line, index) => <p key={index} className="mt-1 text-sm">{line}</p>)}
                  <Link href={`/worker/reports/${report.id}`} className="inline-flex min-h-11 items-center text-sm underline">报工明细与问题反馈</Link>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="font-sans tabular-nums font-medium">
                    {formatMoney(report.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeShanghai(report.reportedAt)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
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
          <PaymentStatusBadge isPaid={payroll.isPaid} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {workerType ? WORKER_TYPE_LABELS[workerType] : '历史岗位未知'}
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
          value={`${formatRate(payroll.hourlyRate)} / 小时`}
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
