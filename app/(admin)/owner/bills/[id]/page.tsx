import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBillDetail } from '@/lib/bill';
import { BillStatus, Role } from '@/generated/prisma/enums';
import {
  BILL_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { IssueBillButton } from '@/components/business/bill/IssueBillButton';
import { RecordPaymentForm } from '@/components/business/bill/RecordPaymentForm';

type PageProps = { params: Promise<{ id: string }> };

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDateTime(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `账单 · ${id.slice(0, 8)}` };
}

export default async function OwnerBillDetailPage({ params }: PageProps) {
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            账单 · {bill.salesUser.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            周期 <span className="font-mono">{bill.period}</span> ·{' '}
            {ROLE_LABELS[bill.salesUser.role] ?? bill.salesUser.role}
            {bill.issuedAt ? ` · 发单 ${formatDateTime(bill.issuedAt)}` : ''}
            {bill.paidAt ? ` · 结清 ${formatDateTime(bill.paidAt)}` : ''}
          </p>
        </div>
        <StatusBadge status={bill.status} />
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Row label="总额" value={`¥ ${String(bill.totalAmount)}`} mono />
          <Row label="已收" value={`¥ ${String(bill.paidAmount)}`} mono />
          <Row
            label="未收"
            value={`¥ ${remaining.toFixed(2)}`}
            mono
            highlight={remaining.gt(0)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>收款进度</span>
            <span className="font-mono">{paidPercent.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${paidPercent}%` }}
            />
          </div>
        </div>
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
            入 <span className="font-mono">¥ {remaining.toFixed(2)}</span>。
            {bill.salesUser.role === Role.CUSTOMER_SERVICE
              ? ' 该账单归属客服；收款时会按金额累计到对应客服周期的业绩。'
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
              ? ' 付款过程中客服业绩已按金额累计到对应周期（若该周期 IN_PROGRESS）。'
              : ''}
            如有退款 / 折扣，请另开负数金额的月账单，不可回退此账单状态。
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-6 py-3 text-base font-semibold">
          工单明细（{bill.items.length}）
        </h2>
        {bill.items.length === 0 ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            本账单无工单。
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单号</th>
                <th className="px-4 py-2 text-left">客户</th>
                <th className="px-4 py-2 text-left">完工时间</th>
                <th className="px-4 py-2 text-center">工单状态</th>
                <th className="px-4 py-2 text-right">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bill.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {it.order.orderNo}
                  </td>
                  <td className="px-4 py-3">{it.order.customerRef ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(it.order.finishedAt)}
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    {it.order.status}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ¥ {String(it.orderAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`${mono ? 'font-mono' : ''} ${
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
