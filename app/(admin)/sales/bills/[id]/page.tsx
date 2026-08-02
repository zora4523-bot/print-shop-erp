import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBillDetail } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import { BILL_STATUS_LABELS } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { requirePermission } from '@/lib/auth/permissions';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import {
  calculateCsBillAttribution,
  hasCustomerServiceAttribution,
} from '@/lib/bill/cs-attribution';
import { BillCostEntryList } from '@/components/business/bill/BillCostEntryList';
import { isLegacyOpeningBillPayment } from '@/lib/bill/payment-display';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `账单 · ${id.slice(0, 8)}` };
}

export default async function SalesBillDetailPage({ params }: PageProps) {
  const user = await requirePermission('bill:view:self');
  const { id } = await params;
  const bill = await getBillDetail(id);
  // 资源所有权双闸：404 而非 403 —— 不要泄露&ldquo;这个 id 存在但你没权看&rdquo;
  // 的信息（避免侧信道枚举）。
  if (!bill || bill.salesUserId !== user.id) notFound();

  const total = new Decimal(bill.totalAmount as unknown as Decimal.Value);
  const openingAmount = new Decimal(
    bill.openingAmount as unknown as Decimal.Value,
  );
  const paid = new Decimal(bill.paidAmount as unknown as Decimal.Value);
  const remaining = total.minus(paid);
  const paidPercent = total.isZero()
    ? 0
    : Math.min(100, Math.max(0, paid.div(total).times(100).toNumber()));
  const csAttribution = calculateCsBillAttribution(bill.items);
  const isCsAttributedBill = hasCustomerServiceAttribution(bill.items);
  const settledRateLabel = csAttribution.settledRates.length
    ? csAttribution.settledRates
        .map((rate) => `${new Decimal(rate).times(100).toFixed(2)}%`)
        .join('、')
    : '待周期结算';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            账单 · {bill.period}
          </h1>
          <p className="text-sm text-muted-foreground">
            {bill.issuedAt ? `发单 ${formatDateTimeShanghai(bill.issuedAt)}` : '尚未发单'}
            {bill.paidAt ? ` · 结清 ${formatDateTimeShanghai(bill.paidAt)}` : ''}
          </p>
        </div>
        <StatusBadge status={bill.status} />
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Row label="总额" value={`¥ ${String(bill.totalAmount)}`} tabular />
          <Row label="已收" value={`¥ ${String(bill.paidAmount)}`} tabular />
          <Row
            label="未收"
            value={`¥ ${remaining.toFixed(2)}`}
            tabular
            highlight={remaining.gt(0)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>收款进度</span>
            <span className="font-sans tabular-nums">{paidPercent.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${paidPercent}%` }}
            />
          </div>
        </div>
      </section>

      {openingAmount.isZero() ? null : (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">历史期初/手工差额</h2>
          <p className="mt-2 text-muted-foreground">
            ¥ {openingAmount.toFixed(2)}；该金额用于解释逐单账单启用前的历史账面差额。
          </p>
        </section>
      )}

      {isCsAttributedBill ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">销售额与提成</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Row
              label="本账单业绩流水"
              value={
                csAttribution.entryCount > 0
                  ? `¥ ${csAttribution.ledgerSales.toFixed(2)}`
                  : '无逐单历史流水'
              }
              tabular
            />
            <Row
              label="实际命中周期比例"
              value={settledRateLabel}
              tabular
            />
            <Row
              label="已结算提成估算"
              value={
                csAttribution.settledRates.length
                  ? `¥ ${csAttribution.attributedCommission.toFixed(2)}`
                  : '待周期结算'
              }
              tabular
            />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            提成按工单销售额计入客服周期，不按收款金额或收款次数重复计算。
            {csAttribution.settledRates.length
              ? ' 本账单提成按业绩流水与所属周期最终费率估算；分币尾差及实际发放以客服周期工资记录为准。'
              : ''}
            {csAttribution.pendingSales.isZero()
              ? ''
              : ` 尚有 ¥ ${csAttribution.pendingSales.toFixed(2)} 等待周期结算。`}
            {csAttribution.entryCount === 0
              ? ' 本账单来自逐单业绩流水启用前，系统不会按账单月份猜测历史比例。'
              : ''}
          </p>
        </section>
      ) : null}

      {bill.status === BillStatus.DRAFT ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            该账单仍是草稿，管理员尚未发单。发单后会变为 ISSUED 并支持收款。
          </p>
        </section>
      ) : null}

      {bill.status === BillStatus.FULLY_PAID ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            ✓ 已结清。如有退款 / 折扣，请联系管理员由财务线下核对原工单和已收流水；
            系统不支持以负数账单冲账，该账单状态也不会回退。
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          结款明细（{bill.payments.length}）
        </h2>
        {bill.payments.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
            暂无收款流水。
          </p>
        ) : (
          <ol className="divide-y">
            {bill.payments.map((payment) => (
              <li
                key={payment.id}
                className="grid min-w-0 gap-2 px-4 py-3 text-sm sm:grid-cols-[160px_100px_1fr_auto] sm:px-6"
              >
                <span className="font-sans tabular-nums">
                  {isLegacyOpeningBillPayment(payment)
                    ? '历史期初 · 时间未知'
                    : formatDateTimeShanghai(payment.paidAt)}
                </span>
                <span>{payment.paymentMethod ?? '未填方式'}</span>
                <span className="admin-wrap-anywhere text-muted-foreground">
                  {payment.remark || payment.referenceNo || '—'}
                </span>
                <span className="font-sans font-medium tabular-nums">
                  ¥ {String(payment.amount)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-6 py-3 text-base font-semibold">
          工单明细（{bill.items.length}）
        </h2>
        {bill.items.length === 0 ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            本账单无工单。
          </div>
        ) : (
          <div
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="账单工单明细"
            tabIndex={0}
          >
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单号</th>
                <th className="px-4 py-2 text-left">客户名称/简称</th>
                <th className="px-4 py-2 text-left">完工时间</th>
                <th className="px-4 py-2 text-center">工单状态</th>
                <th className="px-4 py-2 text-right">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bill.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-3 font-sans tabular-nums text-xs">
                    {it.order.orderNo}
                  </td>
                  <td className="px-4 py-3">{it.order.customerRef ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateShanghai(it.order.finishedAt)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    <OrderStatusBadge status={it.order.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(it.orderAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <BillCostEntryList items={bill.items} />

      {bill.remark ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <h2 className="text-base font-semibold">备注</h2>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
            {bill.remark}
          </p>
        </section>
      ) : null}

      <Link
        href="/sales/bills"
        className="text-sm text-muted-foreground underline"
      >
        ← 返回账单列表
      </Link>
    </div>
  );
}

function Row({
  label,
  value,
  tabular,
  highlight,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`${tabular ? 'font-sans tabular-nums' : ''} ${
          highlight ? 'text-destructive font-semibold' : ''
        } text-base`}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const label = BILL_STATUS_LABELS[status] ?? status;
  switch (status) {
    case BillStatus.FULLY_PAID:
      return <Badge>{label}</Badge>;
    case BillStatus.PARTIAL_PAID:
      return <Badge variant="secondary">{label}</Badge>;
    case BillStatus.ISSUED:
      return <Badge variant="destructive">{label}</Badge>;
    case BillStatus.DRAFT:
      return <Badge variant="outline">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}
