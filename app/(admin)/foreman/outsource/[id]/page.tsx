import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { getOutsourceOrderDetail } from '@/lib/outsource';
import { isTerminalOutsourceStatus } from '@/lib/outsource/status-machine';
import { Badge } from '@/components/ui/badge';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { OutsourceActions } from '@/components/business/outsource/OutsourceActions';
import { OutsourceAmountForm } from '@/components/business/outsource/OutsourceAmountForm';
import { OutsourcePaymentForm } from '@/components/business/outsource/OutsourcePaymentForm';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getOutsourceTitleRef } from '@/lib/page-title/refs';
import { outsourceTitle } from '@/lib/page-title/titles';

import { formatMoney } from '@/lib/dashboard/format';
type PageProps = { params: Promise<{ id: string }> };

const STATUS_LABELS: Record<OutsourceStatus, string> = {
  [OutsourceStatus.SENT]: '已发出',
  [OutsourceStatus.IN_PROGRESS]: '进行中',
  [OutsourceStatus.RECEIVED]: '已回货',
  [OutsourceStatus.CANCELLED]: '已取消',
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('outsource:manage', session.user.role)) {
    return { title: '外协单' };
  }
  const ref = await getOutsourceTitleRef(id);
  return {
    title: outsourceTitle(
      ref
        ? {
            supplierName: ref.supplierName,
            orderNo: ref.order?.orderNo ?? null,
          }
        : null,
    ),
  };
}

export default async function OutsourceDetailPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('outsource:manage');
  const { id } = await params;
  const row = await getOutsourceOrderDetail(id);
  if (!row) notFound();

  const canReceive = !isTerminalOutsourceStatus(row.status);
  // Don't offer cancel once the goods have landed — SPEC §4.3 makes
  // RECEIVED terminal. SENT / IN_PROGRESS only.
  const canCancel =
    row.status === OutsourceStatus.SENT ||
    row.status === OutsourceStatus.IN_PROGRESS;
  const payableAmount =
    row.amount === null ? null : new Decimal(row.amount.toString());
  const paidAmount = row.payments.reduce(
    (sum, payment) => sum.plus(payment.amount.toString()),
    new Decimal(0),
  );
  const remainingAmount = payableAmount?.minus(paidAmount) ?? null;
  const paymentLedgerInvalid = remainingAmount?.isNegative() ?? false;

  return (
    <div className="space-y-6">
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的数据，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={row.supplierName} />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="admin-wrap-anywhere text-xl font-semibold">
            外协单 · {row.supplierName}
          </h1>
          <p className="text-sm text-muted-foreground">
            工单号：
            {row.order ? (
              <Link
                href={`/orders/${row.order.id}`}
                className="font-sans tabular-nums underline hover:text-foreground"
              >
                {row.order.orderNo}
              </Link>
            ) : (
              '—'
            )}
          </p>
        </div>
        <Badge
          variant={
            row.status === OutsourceStatus.RECEIVED
              ? 'default'
              : row.status === OutsourceStatus.CANCELLED
                ? 'outline'
                : row.status === OutsourceStatus.IN_PROGRESS
                  ? 'secondary'
                  : 'outline'
          }
        >
          {STATUS_LABELS[row.status]}
        </Badge>
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-3">
        <h2 className="text-base font-semibold">基本信息</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row label="外协厂" value={row.supplierName} />
          <Row label="联系方式" value={row.supplierContact ?? '—'} />
          <Row label="工艺" value={row.craftDescription ?? '—'} full />
          <Row
            label="特殊要求"
            value={row.specialRequirement ?? '—'}
            full
          />
          <Row
            label="总数量"
            value={row.totalQty?.toLocaleString() ?? '—'}
            tabular
          />
          <Row
            label="确认应付金额"
            value={payableAmount === null ? '—' : `¥ ${payableAmount.toFixed(2)}`}
            tabular
          />
          <Row label="预计回货" value={formatDateShanghai(row.expectedDate)} />
          <Row label="实际回货" value={formatDateShanghai(row.actualDate)} />
          <Row
            label="关联款式"
            value={row.orderItemIds.length.toString()}
            tabular
          />
          {row.remark ? <Row label="备注" value={row.remark} full /> : null}
        </dl>
      </section>

      {row.status === OutsourceStatus.CANCELLED ? null : (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <div>
            <h2 className="text-base font-semibold">外协金额确认</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              可在回货后补录最终金额；后续更正会保留原金额、新金额、原因和操作人。
            </p>
          </div>
          <OutsourceAmountForm
            id={row.id}
            currentAmount={row.amount === null ? null : String(row.amount)}
            initialIdempotencyKey={randomUUID()}
          />
        </section>
      )}

      {row.amountChanges.length > 0 ? (
        <section className="rounded-xl border bg-card shadow-sm">
          <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
            金额变更记录（{row.amountChanges.length}）
          </h2>
          <ol className="divide-y text-sm">
            {row.amountChanges.map((change) => (
              <li
                key={change.id}
                className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[180px_180px_minmax(0,1fr)] sm:px-6"
              >
                <span className="font-sans tabular-nums">
                  {change.previousAmount === null
                    ? '未录入'
                    : `¥ ${String(change.previousAmount)}`}{' '}
                  → {formatMoney(change.newAmount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {change.changedBy.displayName} ·{' '}
                  {formatDateTimeShanghai(change.createdAt)}
                </span>
                <span className="admin-wrap-anywhere">{change.reason}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="text-base font-semibold">外协付款</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            仅记录工厂向外协厂支付的加工费，不进入销售账单或员工工资。
          </p>
        </div>

        <dl className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <PaymentSummary
            label="外协加工应付"
            value={
              payableAmount === null ? '未确认' : `¥ ${payableAmount.toFixed(2)}`
            }
          />
          <PaymentSummary label="已付" value={`¥ ${paidAmount.toFixed(2)}`} />
          <PaymentSummary
            label="未付"
            value={
              remainingAmount === null
                ? '—'
                : paymentLedgerInvalid
                  ? '待对账'
                  : `¥ ${remainingAmount.toFixed(2)}`
            }
          />
        </dl>

        <div className="border-t px-4 py-4 sm:px-6">
          {paymentLedgerInvalid ? (
            <p className="text-sm text-destructive" role="alert">
              累计已付超过确认应付金额，请先对账，暂不能继续记录付款。
            </p>
          ) : row.status !== OutsourceStatus.RECEIVED ? (
            <p className="text-sm text-muted-foreground">
              外协单回货后才能记录付款。
            </p>
          ) : payableAmount === null ? (
            <p className="text-sm text-muted-foreground">
              请先确认外协应付金额，再记录付款。
            </p>
          ) : remainingAmount?.isZero() ? (
            <p className="text-sm font-medium text-foreground">
              该外协单已结清。
            </p>
          ) : (
            <OutsourcePaymentForm
              id={row.id}
              remainingAmount={remainingAmount?.toFixed(2) ?? '0.00'}
              initialIdempotencyKey={randomUUID()}
            />
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <h2 className="border-b px-4 py-3 text-base font-semibold sm:px-6">
          付款明细（{row.payments.length}）
        </h2>
        {row.payments.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
            暂无外协付款记录。
          </p>
        ) : (
          <ol className="divide-y text-sm">
            {row.payments.map((payment) => (
              <li
                key={payment.id}
                className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[140px_180px_minmax(0,1fr)] sm:px-6"
              >
                <span className="font-sans font-medium tabular-nums">
                  ¥ {new Decimal(payment.amount.toString()).toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTimeShanghai(payment.paidAt)} ·{' '}
                  {payment.recordedBy.displayName}
                </span>
                <span className="admin-wrap-anywhere text-xs text-muted-foreground">
                  {[payment.method, payment.reference, payment.remark]
                    .filter(Boolean)
                    .join(' · ') || '未填写付款方式或备注'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canReceive || canCancel ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">状态操作</h2>
          <OutsourceActions
            id={row.id}
            canReceive={canReceive}
            canCancel={canCancel}
          />
        </section>
      ) : null}
    </div>
  );
}

function PaymentSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-4 sm:px-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-sans text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function Row({
  label,
  value,
  tabular,
  full,
}: {
  label: string;
  value: string;
  tabular?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tabular ? 'font-sans tabular-nums' : 'admin-wrap-anywhere'
        }
      >
        {value}
      </dd>
    </div>
  );
}
