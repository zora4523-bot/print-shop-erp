import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCsPeriodDetail } from '@/lib/salary/cs';
import {
  CsSalesEntryType,
  SalaryPeriodStatus,
} from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { SettleCsPeriodButton } from '@/components/business/salary/SettleCsPeriodButton';
import { MarkCsPaidForm } from '@/components/business/salary/MarkCsPaidForm';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import { getAttendanceSummaries } from '@/lib/attendance';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `客服周期 · ${id.slice(0, 8)}` };
}

export default async function CsPeriodDetailPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const { id } = await params;
  const period = await getCsPeriodDetail(id);
  if (!period) notFound();
  const attendanceSummary =
    (
      await getAttendanceSummaries([period.csUserId], {
        start: period.periodStart,
        end: period.periodEnd,
        inclusiveEnd: true,
      })
    ).get(period.csUserId) ?? { workUnits: '0', leaveUnits: '0' };

  const now = new Date();
  const ready =
    period.status === SalaryPeriodStatus.IN_PROGRESS &&
    period.periodEnd.getTime() < now.getTime();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            客服周期 · {period.csUser.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateShanghai(period.periodStart)} ~ {formatDateShanghai(period.periodEnd)} ·
            月数 {period.durationMonths}
          </p>
        </div>
        {period.status === SalaryPeriodStatus.SETTLED ? (
          <Badge>已结算</Badge>
        ) : ready ? (
          <Badge variant="destructive">待结算</Badge>
        ) : (
          <Badge variant="outline">进行中</Badge>
        )}
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-3">
        <h2 className="text-base font-semibold">周期参数</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Row label="月底薪" value={`¥ ${String(period.monthlyBase)}`} tabular />
          <Row label="期初业绩" value={String(period.initialSales)} tabular />
          <Row label="本期累计业绩" value={String(period.totalSales)} tabular />
          <Row
            label="业绩合计（算档用）"
            value={String(
              Number(period.totalSales) + Number(period.initialSales),
            )}
            tabular
          />
          <Row
            label="底薪合计"
            value={`¥ ${(Number(period.monthlyBase) * period.durationMonths).toFixed(
              2,
            )}`}
            tabular
          />
          <Row label="结算时间" value={formatDateTimeShanghai(period.settledAt)} />
          <Row
            label="实际上班天数"
            value={`${attendanceSummary.workUnits} 天`}
            tabular
          />
          <Row
            label="请假天数"
            value={`${attendanceSummary.leaveUnits} 天`}
            tabular
          />
        </dl>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          销售额流水（{period.salesEntries.length}）
        </h2>
        {period.salesEntries.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
            暂无逐单销售额流水；旧周期可能只有期初/累计汇总。
          </p>
        ) : (
          <ol className="divide-y text-sm">
            {period.salesEntries.map((entry) => (
              <li
                key={entry.id}
                className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[160px_120px_1fr_auto] sm:px-6"
              >
                <span className="font-sans tabular-nums">
                  {formatDateTimeShanghai(entry.createdAt)}
                </span>
                <span>{CS_SALES_ENTRY_LABELS[entry.type]}</span>
                <span className="admin-wrap-anywhere">
                  {entry.order ? (
                    <Link
                      href={`/orders/${entry.order.id}`}
                      className="font-sans text-primary underline"
                    >
                      {entry.order.orderNo}
                    </Link>
                  ) : (
                    entry.remark ?? '手工调整'
                  )}
                  {entry.orderRevision
                    ? ` · 第 ${entry.orderRevision} 版`
                    : ''}
                </span>
                <span className="font-sans font-medium tabular-nums">
                  {Number(entry.amount) > 0 ? '+' : ''}¥ {String(entry.amount)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {period.status === SalaryPeriodStatus.IN_PROGRESS ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">结算</h2>
          <p className="text-xs text-muted-foreground">
            周期 {ready ? '已到期' : '未到期'}；到期后可手动立即结算，或由
            cron 自动扫描结算。结算后会自动开启下一个周期。
          </p>
          <SettleCsPeriodButton periodId={period.id} />
        </section>
      ) : null}

      {period.commissions.length > 0 ? (
        <section
          className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="客服提成记录"
          tabIndex={0}
        >
          <h2 className="border-b px-6 py-3 text-base font-semibold">
            提成记录
          </h2>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">结算时间</th>
                <th className="px-4 py-2 text-right">业绩合计</th>
                <th className="px-4 py-2 text-right">档位费率</th>
                <th className="px-4 py-2 text-right">提成金额</th>
                <th className="px-4 py-2 text-right">底薪合计</th>
                <th className="px-4 py-2 text-right">总收入</th>
                <th className="px-4 py-2 text-center">发放状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {period.commissions.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-xs">
                    {formatDateTimeShanghai(c.settledAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(c.totalSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(c.tierRate)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(c.commissionAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    ¥ {String(c.monthlyBaseTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                    ¥ {String(c.totalIncome)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.isFullyPaid ? (
                      <Badge>已发</Badge>
                    ) : (
                      <Badge variant="outline">未发</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MarkCsPaidForm id={c.id} currentPaid={c.isFullyPaid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <Link
        href="/owner/salary/cs"
        className="text-sm text-muted-foreground underline"
      >
        ← 返回列表
      </Link>
    </div>
  );
}

const CS_SALES_ENTRY_LABELS: Record<CsSalesEntryType, string> = {
  [CsSalesEntryType.ORDER_SUBMITTED]: '工单提交',
  [CsSalesEntryType.ORDER_CHANGED]: '工单变更',
  [CsSalesEntryType.ORDER_CANCELLED]: '工单取消',
  [CsSalesEntryType.MANUAL_ADJUSTMENT]: '手工调整',
};

function Row({
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
