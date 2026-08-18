import Link from 'next/link';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getCsPeriodDetail, isCsPeriodDue } from '@/lib/salary/cs';
import {
  CsSalesEntryType,
  SalaryPeriodStatus,
} from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { SettleCsPeriodButton } from '@/components/business/salary/SettleCsPeriodButton';
import { CsPayrollPaymentForm } from '@/components/business/salary/CsPayrollPaymentForm';
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

  const ready =
    period.status === SalaryPeriodStatus.IN_PROGRESS &&
    isCsPeriodDue(period.periodEnd);
  const baseTotal = new Decimal(period.monthlyBase as Decimal.Value).times(
    period.durationMonths,
  );
  const paidBase = period.payrollPayments.reduce(
    (sum, payment) =>
      sum.plus(new Decimal(payment.baseAmount as Decimal.Value)),
    new Decimal(0),
  );
  const paidCommission = period.payrollPayments.reduce(
    (sum, payment) =>
      sum.plus(new Decimal(payment.commissionAmount as Decimal.Value)),
    new Decimal(0),
  );
  const commission = period.commissions[0] ?? null;
  const commissionTotal = commission
    ? new Decimal(commission.commissionAmount as Decimal.Value)
    : new Decimal(0);
  const remainingBase = Decimal.max(baseTotal.minus(paidBase), 0);
  const remainingCommission = Decimal.max(
    commissionTotal.minus(paidCommission),
    0,
  );

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
            value={new Decimal(period.totalSales as Decimal.Value)
              .plus(new Decimal(period.initialSales as Decimal.Value))
              .toFixed(2)}
            tabular
          />
          <Row
            label="底薪合计"
            value={`¥ ${baseTotal.toFixed(2)}`}
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
        <p className="text-xs text-muted-foreground">
          上班/请假天数用于考勤核对；按当前工资制度不自动扣减客服周期底薪。
        </p>
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
                  {formatDateTimeShanghai(entry.occurredAt)}
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
                  {new Decimal(entry.amount).isPositive() ? '+' : ''}¥{' '}
                  {String(entry.amount)}
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
            周期 {ready ? '已到期' : '未到期'}；周期结束后的次日可手动结算，或由
            cron 自动扫描结算。结算后会自动开启下一个周期。
          </p>
          {ready ? <SettleCsPeriodButton periodId={period.id} /> : null}
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-semibold">工资发放</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            底薪可在周期内按月分次发放；提成须等周期结算并锁定最终档位后发放。
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Row label="已发底薪" value={`¥ ${paidBase.toFixed(2)}`} tabular />
          <Row
            label="剩余底薪"
            value={`¥ ${remainingBase.toFixed(2)}`}
            tabular
          />
          <Row
            label="已发提成"
            value={`¥ ${paidCommission.toFixed(2)}`}
            tabular
          />
          <Row
            label="剩余提成"
            value={
              commission
                ? `¥ ${remainingCommission.toFixed(2)}`
                : '待周期结算'
            }
            tabular
          />
        </dl>

        {remainingBase.gt(0) || remainingCommission.gt(0) ? (
          <CsPayrollPaymentForm
            periodId={period.id}
            remainingBase={remainingBase.toFixed(2)}
            remainingCommission={remainingCommission.toFixed(2)}
            commissionAvailable={commission !== null}
            initialIdempotencyKey={randomUUID()}
          />
        ) : (
          <p className="text-sm text-success-foreground">
            {commission ? '本周期底薪与提成已全部发放。' : '本周期底薪已全部发放。'}
          </p>
        )}

        <div className="rounded-lg border">
          <h3 className="border-b px-4 py-2 text-sm font-medium">
            发放流水（{period.payrollPayments.length}）
          </h3>
          {period.payrollPayments.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              暂无工资发放流水。
            </p>
          ) : (
            <ol className="divide-y text-sm">
              {period.payrollPayments.map((payment) => (
                <li
                  key={payment.id}
                  className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[160px_1fr_auto]"
                >
                  <span className="font-sans tabular-nums">
                    {formatDateTimeShanghai(payment.paidAt)}
                  </span>
                  <span className="admin-wrap-anywhere text-muted-foreground">
                    底薪 ¥ {String(payment.baseAmount)} · 提成 ¥{' '}
                    {String(payment.commissionAmount)}
                    {payment.paymentMethod ? ` · ${payment.paymentMethod}` : ''}
                    {payment.referenceNo ? ` · 流水号 ${payment.referenceNo}` : ''}
                    {payment.remark ? ` · ${payment.remark}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {payment.recordedBy.displayName}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

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
                <th className="px-4 py-2 text-right">已发底薪</th>
                <th className="px-4 py-2 text-right">已发提成</th>
                <th className="px-4 py-2 text-center">发放状态</th>
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
                    {new Decimal(c.tierRate as Decimal.Value)
                      .times(100)
                      .toFixed(2)}%
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
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(c.paidBase)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(c.paidCommission)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.isFullyPaid ? (
                      <Badge>已发</Badge>
                    ) : (
                      <Badge variant="outline">未发</Badge>
                    )}
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
