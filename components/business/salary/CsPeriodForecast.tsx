import Decimal from 'decimal.js';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { formatMoney } from '@/lib/dashboard/format';
import { calcCsCommission } from '@/lib/salary/cs-commission';
import { getActiveCsTiers } from '@/lib/salary/rules';

export type CsPeriodForecastProps = {
  status: SalaryPeriodStatus;
  totalSales: string;
  initialSales: string;
  monthlyBase: string;
  durationMonths: number;
};

/** Ongoing periods use today's active rules; settled periods keep their stored snapshot. */
export async function CsPeriodForecast({
  status,
  totalSales,
  initialSales,
  monthlyBase,
  durationMonths,
}: CsPeriodForecastProps) {
  if (status !== SalaryPeriodStatus.IN_PROGRESS) return null;

  const tiers = await getActiveCsTiers();
  // Same projection as getEndingPeriods: include the imported opening balance,
  // then add the whole period's base salary to the unrounded commission.
  const tierSales = new Decimal(totalSales).plus(initialSales);
  const baseTotal = new Decimal(monthlyBase).times(durationMonths);
  const breakdown = tiers ? calcCsCommission(tierSales, tiers) : null;
  const totalIncome = breakdown ? baseTotal.plus(breakdown.commissionAmount) : null;

  return (
    <section
      data-slot="cs-period-forecast"
      className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-base font-semibold">结算预测</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">业绩合计（含期初）</dt>
          <dd className="mt-1 font-sans font-medium tabular-nums">{formatMoney(tierSales)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">预测提成</dt>
          <dd className="mt-1 font-sans font-medium tabular-nums">
            {breakdown ? formatMoney(breakdown.commissionAmount) : '暂无法预测'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">预测总收入</dt>
          <dd className="mt-1 font-sans font-medium tabular-nums">
            {totalIncome ? formatMoney(totalIncome) : '暂无法预测'}
          </dd>
        </div>
      </dl>
      {!tiers ? (
        <p className="text-sm text-warning-foreground">未配置生效的客服提成规则。</p>
      ) : breakdown?.belowAllTiers ? (
        <p className="text-sm text-muted-foreground">当前业绩未达到最低提成档位，预测提成为零。</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        按当前提成档位预测，含整个周期的底薪；最终金额以结算为准。
      </p>
    </section>
  );
}
