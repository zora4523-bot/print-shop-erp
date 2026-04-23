import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderStatus, Role } from '../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import { isTerminalOrderStatus } from '@/lib/order/status-machine';
import {
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { roleLabel } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { SubmitOrderButton } from '@/components/business/order/SubmitOrderButton';
import { CancelOrderForm } from '@/components/business/order/CancelOrderForm';
import { UrgentToggleForm } from '@/components/business/order/UrgentToggleForm';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `工单 · ${id.slice(0, 8)}` };
}

function formatDateTime(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ` +
    `${z(d.getHours())}:${z(d.getMinutes())}`
  );
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();

  const canSubmit =
    order.status === OrderStatus.DRAFT &&
    (order.submitterId === user.id ||
      user.role === Role.OWNER ||
      user.role === Role.FOREMAN);
  const canCancel =
    user.role === Role.OWNER && !isTerminalOrderStatus(order.status);

  // Editing follows SPEC §3.6. Ownership mirrors the action-layer
  // guard: SALES / CUSTOMER_SERVICE only their own; OWNER / FOREMAN
  // any. Server still re-verifies on submit — this is UI-only.
  const canEdit =
    isOrderEditable(order.status) &&
    (order.submitterId === user.id ||
      user.role === Role.OWNER ||
      user.role === Role.FOREMAN);
  // 急单 toggle lives in the FULL fieldset only (DRAFT/SUBMITTED).
  const canToggleUrgent = editableFieldsetForStatus(order.status) === 'FULL' && canEdit;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            <span className="font-mono">{order.orderNo}</span>
            {order.isUrgent ? (
              <Badge variant="destructive" className="ml-3">
                急单
              </Badge>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            提交人：{order.submitter.displayName}（{roleLabel(order.submitter.role)}）
            · 创建于 {formatDateTime(order.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} />
          {canEdit ? (
            <Link
              href={`/orders/${order.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              编辑
            </Link>
          ) : null}
          {canToggleUrgent ? (
            <UrgentToggleForm orderId={order.id} currentValue={order.isUrgent} />
          ) : null}
          <Link
            href={`/print/orders/${order.id}?autoprint=1`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            打印
          </Link>
          <Link
            href={`/api/orders/${order.id}/pdf`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            下载 PDF
          </Link>
        </div>
      </div>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-base font-semibold">基本信息</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="客户代号" value={order.customerRef} />
          <Row label="收货人" value={order.receiverName} />
          <Row label="收货电话" value={order.receiverPhone} />
          <Row label="快递代码" value={order.expressCode} />
          <Row label="收货地址" value={order.receiverAddress} full />
          <Row label="包装要求" value={order.packageRequirement} full />
          <Row label="备注" value={order.remark} full />
          <Row label="总额" value={String(order.totalAmount)} mono />
        </dl>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-base font-semibold">款式（{order.items.length}）</h2>
        <ol className="space-y-3">
          {order.items.map((item) => (
            <li key={item.id} className="rounded-lg border p-4 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  #{item.sequence} · {item.name}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {item.quantity} × {String(item.unitPrice)} = {String(item.subtotal)}
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <Row label="规格" value={item.specification} />
                <Row label="纸张" value={item.paperType} />
                <Row label="烫金色" value={item.foilColor} />
                <Row
                  label="双面 / 双色"
                  value={`${item.isDoubleSided ? '双面' : '单面'} · ${item.isDoubleColor ? '双色' : '单色'}`}
                />
                <Row
                  label="工艺"
                  value={item.crafts.length ? item.crafts.join('、') : '—'}
                  full
                />
                {item.remark ? <Row label="款式备注" value={item.remark} full /> : null}
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-base font-semibold">最近日志</h2>
        {order.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {order.logs.slice(0, 10).map((log) => (
              <li key={log.id} className="flex items-start gap-2">
                <span className="text-muted-foreground">
                  {formatDateTime(log.createdAt)}
                </span>
                <span className="font-mono">{log.action}</span>
                {log.remark ? <span>· {log.remark}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-4">
        {canSubmit ? <SubmitOrderButton orderId={order.id} /> : null}
        {canCancel ? (
          <div className="flex-1 rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="mb-2 text-base font-semibold">取消工单</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              取消后工单进入 CANCELLED 终态，不再参与排产 / 生产。仅老板可操作。
            </p>
            <CancelOrderForm orderId={order.id} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  full?: boolean;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono' : undefined}>{display}</dd>
    </div>
  );
}
