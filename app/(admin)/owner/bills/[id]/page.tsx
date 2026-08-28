import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminBillDetail } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import { ROLE_LABELS } from '@/lib/auth/role-labels';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import {
  ActionNotice,
  StatusBadge as UiStatusBadge,
  TableEmptyState,
} from '@/components/ui-business';
import { IssueBillButton } from '@/components/business/bill/IssueBillButton';
import { RecordPaymentForm } from '@/components/business/bill/RecordPaymentForm';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getAdminBillTitleRef } from '@/lib/page-title/refs';
import { adminBillTitle } from '@/lib/page-title/titles';
import {
  calculateCsBillAttribution,
  hasCustomerServiceAttribution,
} from '@/lib/bill/cs-attribution';
import { calculateOrderCostBreakdown } from '@/lib/bill/costing';
import { BillCostEntryList } from '@/components/business/bill/BillCostEntryList';
import { isLegacyOpeningBillPayment } from '@/lib/bill/payment-display';
import { BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';

import { formatMoney } from '@/lib/dashboard/format';
type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ issued?: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  // 这张表没有行级 scope，唯一闸口就是权限。metadata 不抛错（流式
  // metadata 下抛不干净），无权时回落到模块名，不透露实体是否存在。
  const session = await getSession();
  if (!session || !hasPermission('bill:view:all', session.user.role)) {
    return { title: '账单' };
  }
  const ref = await getAdminBillTitleRef(id);
  return {
    title: adminBillTitle(
      ref
        ? { period: ref.period, salesUserName: ref.salesUser.displayName }
        : null,
    ),
  };
}

export default async function OwnerBillDetailPage({
  params,
  searchParams,
}: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('bill:view:all');
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const bill = await getAdminBillDetail(id);
  if (!bill) notFound();

  const total = new Decimal(bill.totalAmount as unknown as Decimal.Value);
  const openingAmount = new Decimal(
    bill.openingAmount as unknown as Decimal.Value,
  );
  const paid = new Decimal(bill.paidAmount as unknown as Decimal.Value);
  const remaining = total.minus(paid);
  // 进度条百分比：防 total=0 的除零。total=0 意味着 DRAFT 账单无订单，
  // 进度保持 0%。
  const paidPercent = total.isZero()
    ? 0
    : Math.min(100, Math.max(0, paid.div(total).times(100).toNumber()));
  const costingRows = bill.items.map((item) => {
    const costs = calculateOrderCostBreakdown(item.order);
    const customerChargeAmount = (categoryCode: string) =>
      summarizeCustomerCharges(
        item.order.customerCharges.filter(
          (charge) => String(charge.category.code) === categoryCode,
        ),
      );
    return {
      ...item,
      ...costs,
      shippingReceivable: customerChargeAmount('SHIPPING_FEE'),
      packingReceivable: customerChargeAmount('PACKING_MATERIAL'),
    };
  });
  const totalCost = costingRows.reduce(
    (sum, item) => sum.plus(item.totalCost),
    new Decimal(0),
  );
  const processingRevenue = costingRows.reduce(
    (sum, item) => sum.plus(item.order.processingAmount),
    new Decimal(0),
  );
  const grossProfit = total.minus(totalCost);
  const csAttribution = calculateCsBillAttribution(bill.items);
  const isCsAttributedBill = hasCustomerServiceAttribution(bill.items);
  const settledRateLabel = csAttribution.settledRates.length
    ? csAttribution.settledRates
        .map((rate) => `${new Decimal(rate).times(100).toFixed(2)}%`)
        .join('、')
    : '待周期结算';

  return (
    <div className="space-y-6">
      {sp.issued === '1' ? (
        <ActionNotice
          tone="success"
          title="账单已发布"
          description="账单已进入可收款状态，后续新完工工单不会再自动追加到本账单。"
          action={
            <Link
              href={`/owner/bills/${bill.id}`}
              prefetch={false}
              className="text-sm font-medium underline underline-offset-2"
            >
              关闭提示
            </Link>
          }
        />
      ) : null}
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的数据，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={`${bill.period} ${bill.salesUser.displayName}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold">
            账单 · {bill.salesUser.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            周期 <span className="font-sans tabular-nums">{bill.period}</span> ·{' '}
            当前身份 {ROLE_LABELS[bill.salesUser.role] ?? '未识别角色'}
            {bill.issuedAt ? ` · 发单 ${formatDateTimeShanghai(bill.issuedAt)}` : ''}
            {bill.paidAt ? ` · 结清 ${formatDateTimeShanghai(bill.paidAt)}` : ''}
          </p>
        </div>
        <BillStatusBadge status={bill.status} />
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="应收总额" value={`¥ ${String(bill.totalAmount)}`} tabular />
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

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-semibold">收入与成本</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            计件和外协从生产记录自动汇总；材料、物流、伙食、电费等来自工单成本流水。
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
          <Row label="对客应收" value={`¥ ${total.toFixed(2)}`} tabular />
          <Row
            label="加工销售额"
            value={`¥ ${processingRevenue.toFixed(2)}`}
            tabular
          />
          <Row
            label="历史期初/手工差额"
            value={`¥ ${openingAmount.toFixed(2)}`}
            tabular
          />
          <Row label="成本合计" value={`¥ ${totalCost.toFixed(2)}`} tabular />
          <Row
            label="毛利"
            value={`¥ ${grossProfit.toFixed(2)}`}
            tabular
            highlight={grossProfit.isNegative()}
          />
        </dl>
        {openingAmount.isZero() ? null : (
          <p className="text-xs text-muted-foreground">
            历史期初/手工差额 + 工单明细 = 应收总额。
          </p>
        )}
        {isCsAttributedBill ? (
          <dl className="grid grid-cols-1 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
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
            {csAttribution.settledRates.length ? (
              <p className="text-xs text-muted-foreground sm:col-span-3">
                按本账单工单的业绩流水与其所属客服周期最终费率估算；分币尾差及实际发放
                以客服周期工资记录为准。
              </p>
            ) : null}
            {csAttribution.pendingSales.isZero() ? null : (
              <p className="text-xs text-muted-foreground sm:col-span-3">
                其中 ¥ {csAttribution.pendingSales.toFixed(2)} 尚在进行中的客服周期，
                待该周期结算后才能确定提成比例。
              </p>
            )}
            {csAttribution.entryCount === 0 ? (
              <p className="text-xs text-muted-foreground sm:col-span-3">
                该账单来自逐单业绩流水启用前；历史累计只保留在客服周期期初校准中，
                系统不会用账单月份猜测一个提成比例。
              </p>
            ) : null}
          </dl>
        ) : null}
      </section>

      {bill.status === BillStatus.DRAFT ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">发单</h2>
          <IssueBillButton
            billId={bill.id}
            period={bill.period}
            recipientLabel={`${bill.salesUser.displayName}（${ROLE_LABELS[bill.salesUser.role] ?? '未识别角色'}）`}
            totalAmount={total.toFixed(2)}
            orderCount={bill.items.length}
          />
        </section>
      ) : null}

      {bill.status === BillStatus.ISSUED ||
      bill.status === BillStatus.PARTIAL_PAID ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">录入付款</h2>
          {isCsAttributedBill ? (
            <p className="text-xs text-muted-foreground">
              该账单归属客服；客服业绩已在工单提交时计入，本次收款不会重复计算提成。
            </p>
          ) : null}
          <RecordPaymentForm
            billId={bill.id}
            remainingAmount={remaining.toFixed(2)}
            initialIdempotencyKey={randomUUID()}
          />
        </section>
      ) : null}

      {bill.status === BillStatus.FULLY_PAID ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            ✓ 已结清。
            {isCsAttributedBill
              ? ' 客服提成基于销售额流水，不基于本账单收款次数。'
              : ''}
            如有退款 / 折扣，请先由财务核对原工单和已收流水；已结清账单不可直接回退或改成负数。
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          结款明细（{bill.payments.length}）
        </h2>
        {bill.payments.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="暂无收款流水"
            description="账单出账后录入的收款会显示在这里。"
            className="m-4 sm:m-6"
          />
        ) : (
          <ol className="divide-y">
            {bill.payments.map((payment) => (
              <li
                key={payment.id}
                className="grid min-w-0 gap-2 px-4 py-3 text-sm sm:grid-cols-[160px_120px_1fr_auto] sm:px-6"
              >
                <span className="font-sans tabular-nums">
                  {isLegacyOpeningBillPayment(payment)
                    ? '历史期初 · 时间未知'
                    : formatDateTimeShanghai(payment.paidAt)}
                </span>
                <span>{payment.paymentMethod ?? '未填方式'}</span>
                <span className="admin-wrap-anywhere text-muted-foreground">
                  {payment.referenceNo ? `流水号 ${payment.referenceNo}` : ''}
                  {payment.remark
                    ? `${payment.referenceNo ? ' · ' : ''}${payment.remark}`
                    : ''}
                  {!payment.referenceNo && !payment.remark ? '—' : ''}
                </span>
                <span className="font-sans font-medium tabular-nums">
                  {formatMoney(payment.amount)}
                </span>
                <span className="text-xs text-muted-foreground sm:col-span-4">
                  记录人：{payment.recordedBy.displayName}
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
          <table className="w-full min-w-[1480px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">工单号</th>
                <th scope="col" className="px-4 py-2 text-left">客户名称/简称</th>
                <th scope="col" className="px-4 py-2 text-left">完工时间</th>
                <th scope="col" className="px-4 py-2 text-center">工单状态</th>
                <th scope="col" className="px-4 py-2 text-right">加工费</th>
                <th scope="col" className="px-4 py-2 text-right">对客快递</th>
                <th scope="col" className="px-4 py-2 text-right">对客耗材</th>
                <th scope="col" className="px-4 py-2 text-right">应收合计</th>
                <th scope="col" className="px-4 py-2 text-right">计件</th>
                <th scope="col" className="px-4 py-2 text-right">外协</th>
                <th scope="col" className="px-4 py-2 text-right">补录成本</th>
                <th scope="col" className="px-4 py-2 text-right">售后重做</th>
                <th scope="col" className="px-4 py-2 text-right">毛利</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {costingRows.map((it) => (
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
                    {formatCustomerChargeSummary(it.shippingReceivable)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {formatCustomerChargeSummary(it.packingReceivable)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans font-medium tabular-nums">
                    {formatMoney(it.orderAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {it.piecework.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {it.outsource.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {it.manual.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {it.rework.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥{' '}
                    {new Decimal(it.orderAmount as Decimal.Value)
                      .minus(it.totalCost)
                      .toFixed(2)}
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
        href="/owner/bills"
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
  if (!summary.hasPendingAmount) return `¥ ${summary.knownAmount.toFixed(2)}`;
  if (summary.knownAmount.isZero()) return '待定';
  return `¥ ${summary.knownAmount.toFixed(2)}（另有待定）`;
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

function BillStatusBadge({ status }: { status: BillStatus }) {
  const definition = BILL_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}
