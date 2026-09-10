import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { BillStatusBadge } from '@/components/business/bill/BillStatusBadge';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSalesBillDetail } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { TableEmptyState, TableScrollArea } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getSalesBillTitleRef } from '@/lib/page-title/refs';
import { salesBillTitle } from '@/lib/page-title/titles';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { isLegacyOpeningBillPayment } from '@/lib/bill/payment-display';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import {
  parsePricingSnapshotComponents,
  PricingSnapshotBreakdown,
} from '@/components/business/price/PricingSnapshotBreakdown';

import { formatMoney } from '@/lib/dashboard/format';
type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('bill:view:self', session.user.role)) {
    return { title: '账单' };
  }
  // 所有权同样写进 where（与 getSalesBillDetail 一致），别人的账期
  // 不会出现在标签页上。
  const ref = await getSalesBillTitleRef(id, session.user.id);
  return { title: salesBillTitle(ref?.period ?? null) };
}

export default async function SalesBillDetailPage({ params }: PageProps) {
  const user = await requirePermission('bill:view:self');
  const { id } = await params;
  // 所有权和最小投影都在数据库查询中执行：不先读入别人账单，
  // 也不读入内部计件、外协、重做、补录成本或录入人。
  const bill = await getSalesBillDetail(id, user.id);
  if (!bill) notFound();

  const total = new Decimal(bill.totalAmount as unknown as Decimal.Value);
  const openingAmount = new Decimal(
    bill.openingAmount as unknown as Decimal.Value,
  );
  const paid = new Decimal(bill.paidAmount as unknown as Decimal.Value);
  const remaining = total.minus(paid);
  const paidPercent = total.isZero()
    ? 0
    : Math.min(100, Math.max(0, paid.div(total).times(100).toNumber()));
  const quotedOrderItems = bill.items.flatMap((billItem) =>
    billItem.order.items.flatMap((orderItem) =>
      parsePricingSnapshotComponents(orderItem.pricingSnapshot).length > 0
        ? [{ billItem, orderItem }]
        : [],
    ),
  );
  const orderRows = bill.items.map((item) => {
    const chargeAmount = (categoryCode: string) =>
      summarizeCustomerCharges(
        item.order.customerCharges.filter(
          (charge) => String(charge.category.code) === categoryCode,
        ),
      );
    const shipping = chargeAmount('SHIPPING_FEE');
    const packing = chargeAmount('PACKING_MATERIAL');
    const otherCharges = summarizeCustomerCharges(
      item.order.customerCharges.filter(
        (charge) =>
          !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
            String(charge.category.code),
          ),
      ),
    );
    return { ...item, shipping, packing, otherCharges };
  });

  return (
    <div className="space-y-6">
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的数据，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={`${bill.period} #${bill.sequence}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold">
            {bill.sequence > 1 ? '补充账单' : '账单'} #{bill.sequence} ·{' '}
            {bill.period}
          </h1>
          <p className="text-sm text-muted-foreground">
            {bill.issuedAt ? `发单 ${formatDateTimeShanghai(bill.issuedAt)}` : '尚未发单'}
            {bill.paidAt ? ` · 结清 ${formatDateTimeShanghai(bill.paidAt)}` : ''}
          </p>
        </div>
        <BillStatusBadge status={bill.status} />
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="应付总额" value={formatMoney(bill.totalAmount)} tabular />
          <Row label="已支付" value={formatMoney(bill.paidAmount)} tabular />
          <Row
            label="待支付"
            value={formatMoney(remaining)}
            tabular
            highlight={remaining.gt(0)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>支付进度</span>
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
            逐单账单启用前的历史差额：{formatMoney(openingAmount)}
          </p>
        </section>
      )}

      {bill.status === BillStatus.DRAFT ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            该账单仍是草稿，管理员尚未出账。出账后才会进入待支付状态。
          </p>
        </section>
      ) : null}

      {bill.status === BillStatus.FULLY_PAID ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            ✓ 已结清。退款或折扣请联系管理员核对；账单状态不会回退。
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          支付明细（{bill.payments.length}）
        </h2>
        {bill.payments.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="暂无支付流水"
            className="m-4 sm:m-6"
          />
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
                  {formatMoney(payment.amount)}
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
          <TableScrollArea label="账单工单明细">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">工单号</th>
                <th scope="col" className="px-4 py-2 text-left">客户名称/简称</th>
                <th scope="col" className="px-4 py-2 text-left">完工时间</th>
                <th scope="col" className="px-4 py-2 text-center">工单状态</th>
                <th scope="col" className="px-4 py-2 text-right">加工费</th>
                <th scope="col" className="px-4 py-2 text-right">快递费</th>
                <th scope="col" className="px-4 py-2 text-right">打包耗材</th>
                <th scope="col" className="px-4 py-2 text-right">其他收费</th>
                <th scope="col" className="px-4 py-2 text-right">应付合计</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orderRows.map((it) => (
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
                    {formatMoney(it.order.processingAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {formatCustomerChargeSummary(it.shipping)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {formatCustomerChargeSummary(it.packing)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {formatCustomerChargeSummary(it.otherCharges)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans font-medium tabular-nums">
                    {formatMoney(it.orderAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScrollArea>
        )}
      </section>

      {quotedOrderItems.length > 0 ? (
        <section className="min-w-0 rounded-xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3 sm:px-6">
            <h2 className="text-base font-semibold">加工费计价依据</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              人工调整后，以实际成交金额为账单依据。
            </p>
          </div>
          <ol className="min-w-0 divide-y">
            {quotedOrderItems.map(({ billItem, orderItem }) => (
              <li
                key={`${billItem.id}:${orderItem.id}`}
                className="min-w-0 px-4 py-4 sm:px-6"
              >
                <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <Link
                    href={`/orders/${billItem.order.id}`}
                    className="admin-wrap-anywhere font-sans font-medium tabular-nums text-primary underline"
                  >
                    {billItem.order.orderNo}
                  </Link>
                  <span className="admin-wrap-anywhere font-medium">
                    #{orderItem.sequence} ·{' '}
                    {externalPriceBusinessText(orderItem.name)}
                  </span>
                </h3>
                <PricingSnapshotBreakdown
                  pricingSnapshot={orderItem.pricingSnapshot}
                  title="加工费分项"
                  className="mt-3"
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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

type CustomerChargeAmount = {
  amount: Decimal.Value | null;
};

function summarizeCustomerCharges(
  charges: readonly CustomerChargeAmount[],
): { knownAmount: Decimal; hasPendingAmount: boolean } {
  return {
    knownAmount: charges.reduce(
      (sum, charge) =>
        charge.amount === null ? sum : sum.plus(charge.amount),
      new Decimal(0),
    ),
    hasPendingAmount: charges.some((charge) => charge.amount === null),
  };
}

function formatCustomerChargeSummary(summary: {
  knownAmount: Decimal;
  hasPendingAmount: boolean;
}): string {
  if (!summary.hasPendingAmount) return formatMoney(summary.knownAmount);
  if (summary.knownAmount.isZero()) return '待定';
  return `${formatMoney(summary.knownAmount)}（另有待定）`;
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
