import { Suspense } from 'react';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import type { getCsPeriodDetail } from '@/lib/salary/cs';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { ContentSkeleton, ErrorBoundary } from '@/components/ui-business';
import { CsPeriodForecast } from './CsPeriodForecast';
import { formatMoney } from '@/lib/dashboard/format';

type PeriodSummary = Pick<
  NonNullable<Awaited<ReturnType<typeof getCsPeriodDetail>>>,
  | 'status'
  | 'monthlyBase'
  | 'initialSales'
  | 'totalSales'
  | 'durationMonths'
  | 'settledAt'
>;

type Props = {
  period: PeriodSummary;
  attendanceSummary: { workUnits: string; leaveUnits: string };
  baseTotal: string;
  tierSalesTotal: string;
};

export function CsPeriodSummary({
  period,
  attendanceSummary,
  baseTotal,
  tierSalesTotal,
}: Props) {
  return (
    <>
      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-3">
        <h2 className="text-base font-semibold">周期参数</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <SummaryRow label="月底薪" value={formatMoney(period.monthlyBase)} tabular />
          <SummaryRow label="期初业绩" value={String(period.initialSales)} tabular />
          <SummaryRow label="本期累计业绩" value={String(period.totalSales)} tabular />
          <SummaryRow label="业绩合计（算档用）" value={tierSalesTotal} tabular />
          <SummaryRow label="底薪合计" value={formatMoney(baseTotal)} tabular />
          <SummaryRow label="结算时间" value={formatDateTimeShanghai(period.settledAt)} />
          <SummaryRow
            label="实际上班天数"
            value={`${attendanceSummary.workUnits} 天`}
            tabular
          />
          <SummaryRow
            label="请假天数"
            value={`${attendanceSummary.leaveUnits} 天`}
            tabular
          />
        </dl>
        <p className="text-xs text-muted-foreground">
          上班/请假天数用于考勤核对；按当前工资制度不自动扣减客服周期底薪。
        </p>
      </section>

      {period.status === SalaryPeriodStatus.IN_PROGRESS ? (
        <ErrorBoundary
          scope="section"
          title="结算预测暂时无法加载"
          description="周期参数、业绩流水和工资发放仍可查看。"
        >
          <Suspense
            fallback={<ContentSkeleton variant="card" rows={1} label="正在加载结算预测" />}
          >
            <CsPeriodForecast
              status={period.status}
              totalSales={String(period.totalSales)}
              initialSales={String(period.initialSales)}
              monthlyBase={String(period.monthlyBase)}
              durationMonths={period.durationMonths}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </>
  );
}

function SummaryRow({
  label,
  value,
  tabular,
}: {
  label: string;
  value: string;
  tabular?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tabular ? 'font-sans tabular-nums' : undefined}>{value}</dd>
    </div>
  );
}
