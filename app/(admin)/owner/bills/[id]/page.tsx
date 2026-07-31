import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBillDetail } from '@/lib/bill';
import {
  BillStatus,
  OrderCostCategory,
  Role,
} from '@/generated/prisma/enums';
import {
  BILL_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { IssueBillButton } from '@/components/business/bill/IssueBillButton';
import { RecordPaymentForm } from '@/components/business/bill/RecordPaymentForm';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `账单 · ${id.slice(0, 8)}` };
}

export default async function OwnerBillDetailPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('bill:view:all');
  const { id } = await params;
  const bill = await getBillDetail(id);
  if (!bill) notFound();

  const total = new Decimal(bill.totalAmount as unknown as Decimal.Value);
  const paid = new Decimal(bill.paidAmount as unknown as Decimal.Value);
  const remaining = total.minus(paid);
  // 进度条百分比：防 total=0 的除零。total=0 意味着 DRAFT 账单无订单，
  // 进度保持 0%。
  const paidPercent = total.isZero()
    ? 0
    : Math.min(100, Math.max(0, paid.div(total).times(100).toNumber()));
  const costingRows = bill.items.map((item) => {
    const piecework = item.order.items
      .flatMap((orderItem) => orderItem.tasks)
      .reduce(
        (sum, task) =>
          sum.plus(new Decimal(task.pieceworkAmount as Decimal.Value)),
        new Decimal(0),
      );
    const outsource = item.order.outsourceOrders.reduce(
      (sum, entry) =>
        sum.plus(new Decimal((entry.amount ?? 0) as Decimal.Value)),
      new Decimal(0),
    );
    const manual = item.order.costEntries.reduce(
      (sum, entry) =>
        sum.plus(new Decimal(entry.amount as Decimal.Value)),
      new Decimal(0),
    );
    const rework = item.order.reworkOrders.reduce((orderSum, reworkOrder) => {
      const pieceworkCost = reworkOrder.items
        .flatMap((orderItem) => orderItem.tasks)
        .reduce(
          (sum, task) =>
            sum.plus(new Decimal(task.pieceworkAmount as Decimal.Value)),
          new Decimal(0),
        );
      const outsourceCost = reworkOrder.outsourceOrders.reduce(
        (sum, entry) =>
          sum.plus(new Decimal((entry.amount ?? 0) as Decimal.Value)),
        new Decimal(0),
      );
      const manualCost = reworkOrder.costEntries.reduce(
        (sum, entry) =>
          sum.plus(new Decimal(entry.amount as Decimal.Value)),
        new Decimal(0),
      );
      return orderSum.plus(pieceworkCost).plus(outsourceCost).plus(manualCost);
    }, new Decimal(0));
    return {
      ...item,
      piecework,
      outsource,
      manual,
      rework,
      totalCost: piecework.plus(outsource).plus(manual).plus(rework),
    };
  });
  const totalCost = costingRows.reduce(
    (sum, item) => sum.plus(item.totalCost),
    new Decimal(0),
  );
  const grossProfit = total.minus(totalCost);
  const billMonthStart = new Date(`${bill.period}-01T00:00:00+08:00`);
  const csPeriod = bill.salesUser.salaryPeriods.find(
    (period) =>
      period.periodStart <= billMonthStart && period.periodEnd >= billMonthStart,
  );
  const csCommission = csPeriod?.commissions[0];
  const csRate = csCommission
    ? new Decimal(csCommission.tierRate as Decimal.Value)
    : null;
  const attributedCommission = csRate ? total.times(csRate) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            账单 · {bill.salesUser.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            周期 <span className="font-sans tabular-nums">{bill.period}</span> ·{' '}
            {ROLE_LABELS[bill.salesUser.role] ?? bill.salesUser.role}
            {bill.issuedAt ? ` · 发单 ${formatDateTimeShanghai(bill.issuedAt)}` : ''}
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

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-semibold">收入与成本</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            计件和外协从生产记录自动汇总；材料、物流、伙食、电费等来自工单成本流水。
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Row label="销售额" value={`¥ ${total.toFixed(2)}`} tabular />
          <Row label="成本合计" value={`¥ ${totalCost.toFixed(2)}`} tabular />
          <Row
            label="毛利"
            value={`¥ ${grossProfit.toFixed(2)}`}
            tabular
            highlight={grossProfit.isNegative()}
          />
        </dl>
        {bill.salesUser.role === Role.CUSTOMER_SERVICE ? (
          <dl className="grid grid-cols-1 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
            <Row
              label="客服周期销售额"
              value={
                csPeriod ? `¥ ${String(csPeriod.totalSales)}` : '未匹配到客服周期'
              }
              tabular
            />
            <Row
              label="结算提成比例"
              value={csRate ? `${csRate.times(100).toFixed(2)}%` : '待周期结算'}
              tabular
            />
            <Row
              label="本账单按最终比例归属提成"
              value={
                attributedCommission
                  ? `¥ ${attributedCommission.toFixed(2)}`
                  : '待周期结算'
              }
              tabular
            />
          </dl>
        ) : null}
      </section>

      {bill.status === BillStatus.DRAFT ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">发单</h2>
          <p className="text-xs text-muted-foreground">
            发单后进入 ISSUED，可接受付款。状态单向，不可回退到 DRAFT。发单
            前请先在列表页&ldquo;生成 / 追加月账单&rdquo;把截至目前所有完工
            订单汇入，因为发单后 {BILL_STATUS_LABELS[BillStatus.ISSUED]} /
            {BILL_STATUS_LABELS[BillStatus.PARTIAL_PAID]} /
            {BILL_STATUS_LABELS[BillStatus.FULLY_PAID]} 的账单不再由生成流程
            自动追加新工单。
          </p>
          <IssueBillButton billId={bill.id} />
        </section>
      ) : null}

      {bill.status === BillStatus.ISSUED ||
      bill.status === BillStatus.PARTIAL_PAID ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">录入付款</h2>
          <p className="text-xs text-muted-foreground">
            累加式记账；累计 = 总额自动切 FULLY_PAID 终态（不可回退）。最多可录
            入 <span className="font-sans tabular-nums">¥ {remaining.toFixed(2)}</span>。
            {bill.salesUser.role === Role.CUSTOMER_SERVICE
              ? ' 该账单归属客服；客服销售额已在工单提交时记入，收款不会重复计算提成。'
              : ''}
          </p>
          <RecordPaymentForm
            billId={bill.id}
            remainingAmount={remaining.toFixed(2)}
          />
        </section>
      ) : null}

      {bill.status === BillStatus.FULLY_PAID ? (
        <section className="rounded-xl border bg-card p-6 text-sm shadow-sm">
          <p className="text-muted-foreground">
            ✓ 已结清。
            {bill.salesUser.role === Role.CUSTOMER_SERVICE
              ? ' 客服提成基于销售额流水，不基于本账单收款次数。'
              : ''}
            如有退款 / 折扣，请另开负数金额的月账单，不可回退此账单状态。
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
                className="grid min-w-0 gap-2 px-4 py-3 text-sm sm:grid-cols-[160px_120px_1fr_auto] sm:px-6"
              >
                <span className="font-sans tabular-nums">
                  {formatDateTimeShanghai(payment.paidAt)}
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
                  ¥ {String(payment.amount)}
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
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单号</th>
                <th className="px-4 py-2 text-left">客户名称/简称</th>
                <th className="px-4 py-2 text-left">完工时间</th>
                <th className="px-4 py-2 text-center">工单状态</th>
                <th className="px-4 py-2 text-right">金额</th>
                <th className="px-4 py-2 text-right">计件</th>
                <th className="px-4 py-2 text-right">外协</th>
                <th className="px-4 py-2 text-right">补录成本</th>
                <th className="px-4 py-2 text-right">售后重做</th>
                <th className="px-4 py-2 text-right">毛利</th>
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
                    ¥ {String(it.orderAmount)}
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

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          自定义成本流水
        </h2>
        {costingRows.every((row) => row.order.costEntries.length === 0) ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
            暂无材料、物流、伙食、电费等补录成本。
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {costingRows.flatMap((row) =>
              row.order.costEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[120px_100px_1fr_auto] sm:px-6"
                >
                  <Link
                    href={`/orders/${row.orderId}`}
                    className="font-sans tabular-nums text-primary underline"
                  >
                    {row.order.orderNo}
                  </Link>
                  <span>{COST_LABELS[entry.category]}</span>
                  <span className="admin-wrap-anywhere">
                    {entry.description}
                    {entry.quantity
                      ? ` · ${String(entry.quantity)} ${entry.unit ?? ''}`
                      : ''}
                    {entry.unitPrice
                      ? ` × ¥ ${String(entry.unitPrice)}`
                      : ''}
                  </span>
                  <span className="font-sans tabular-nums">
                    ¥ {String(entry.amount)}
                  </span>
                </li>
              )),
            )}
          </ul>
        )}
      </section>

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

const COST_LABELS: Record<OrderCostCategory, string> = {
  [OrderCostCategory.MATERIAL]: '材料',
  [OrderCostCategory.PIECEWORK]: '计件',
  [OrderCostCategory.SETUP]: '装板',
  [OrderCostCategory.OUTSOURCE]: '外协',
  [OrderCostCategory.SHIPPING]: '物流',
  [OrderCostCategory.MEAL]: '伙食',
  [OrderCostCategory.ELECTRICITY]: '电费',
  [OrderCostCategory.CUSTOM]: '其他',
  [OrderCostCategory.ADJUSTMENT]: '调整',
};

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
