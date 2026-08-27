import Link from 'next/link';
import Decimal from 'decimal.js';
import { CalendarClock } from 'lucide-react';
import { isCsPeriodDue, listCsPeriods } from '@/lib/salary/cs';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { SettleReadyCsButton } from '@/components/business/salary/SettleReadyCsButton';
import { SalaryPeriodStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { EmptyState, PageHeader } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = { title: '客服周期与提成' };

type PageProps = {
  searchParams: Promise<{ status?: string; csUserId?: string }>;
};

export default async function CsSalaryListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  const status =
    sp.status === 'IN_PROGRESS'
      ? SalaryPeriodStatus.IN_PROGRESS
      : sp.status === 'SETTLED'
        ? SalaryPeriodStatus.SETTLED
        : undefined;
  // 页面筛选只影响下方列表；批量结算扫描的是全部已到期周期。
  // 因此单独读取全部进行中周期，避免确认层被 URL 筛选缩小影响范围。
  const [periods, inProgressPeriods] = await Promise.all([
    listCsPeriods({
      status,
      csUserId: sp.csUserId,
    }),
    listCsPeriods({ status: SalaryPeriodStatus.IN_PROGRESS }),
  ]);
  const previewNow = new Date();
  const duePeriods = inProgressPeriods
    .filter((period) => isCsPeriodDue(period.periodEnd, previewNow))
    .sort((left, right) => left.periodEnd.getTime() - right.periodEnd.getTime());
  const tierSalesTotal = duePeriods.reduce(
    (sum, period) =>
      sum
        .plus(new Decimal(period.totalSales as Decimal.Value))
        .plus(new Decimal(period.initialSales as Decimal.Value)),
    new Decimal(0),
  );
  const baseTotal = duePeriods.reduce(
    (sum, period) =>
      sum.plus(
        new Decimal(period.monthlyBase as Decimal.Value).times(
          period.durationMonths,
        ),
      ),
    new Decimal(0),
  );
  const settlementPreview = {
    duePeriodCount: duePeriods.length,
    csUserCount: new Set(duePeriods.map((period) => period.csUserId)).size,
    tierSalesTotal: tierSalesTotal.toFixed(2),
    baseTotal: baseTotal.toFixed(2),
    earliestPeriodEnd:
      duePeriods.length > 0
        ? formatDateShanghai(duePeriods[0]!.periodEnd)
        : null,
    latestPeriodEnd:
      duePeriods.length > 0
        ? formatDateShanghai(duePeriods[duePeriods.length - 1]!.periodEnd)
        : null,
    samplePeriods: duePeriods.slice(0, 5).map((period) => ({
      periodId: period.id,
      csUserName: period.csUser.displayName,
      periodLabel: `${formatDateShanghai(period.periodStart)} ~ ${formatDateShanghai(period.periodEnd)}`,
      tierSalesTotal: new Decimal(period.totalSales as Decimal.Value)
        .plus(new Decimal(period.initialSales as Decimal.Value))
        .toFixed(2),
      baseTotal: new Decimal(period.monthlyBase as Decimal.Value)
        .times(period.durationMonths)
        .toFixed(2),
    })),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="客服周期与提成"
        subtitle="查看客服周期、结算状态和提成。"
        actions={
          <Link
            href="/owner/salary/cs/new"
            className={buttonVariants({ size: 'sm' })}
          >
            + 新建周期
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <SettleReadyCsButton preview={settlementPreview} />
      </section>

      {periods.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="暂无周期数据"
          description="点击右上角&ldquo;新建周期&rdquo;为客服开启首个业绩周期。"
        />
      ) : (
        <div
          className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="客服提成周期列表"
          tabIndex={0}
        >
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">客服</th>
                <th className="px-4 py-2 text-left">周期</th>
                <th className="px-4 py-2 text-center">月数</th>
                <th className="px-4 py-2 text-right">期初业绩</th>
                <th className="px-4 py-2 text-right">本期累计</th>
                <th className="px-4 py-2 text-right">月底薪</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {periods.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.csUser.displayName}</td>
                  <td className="px-4 py-3 text-xs font-sans tabular-nums">
                    {formatDateShanghai(p.periodStart)} ~ {formatDateShanghai(p.periodEnd)}
                  </td>
                  <td className="px-4 py-3 text-center">{p.durationMonths}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {String(p.initialSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(p.totalSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {String(p.monthlyBase)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <SalaryPeriodStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/salary/cs/${p.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      详情
                    </Link>
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
