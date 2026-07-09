import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderStatus, Role } from '../../../../generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import {
  canAttachOutsource,
  isTerminalOrderStatus,
} from '@/lib/order/status-machine';
import {
  editableFieldsetForStatus,
  isOrderEditable,
} from '@/lib/order/editable-fields';
import { roleLabel } from '@/lib/auth/role-labels';
import {
  actionLabel,
  formatOrderLogChanges,
} from '@/lib/order/log-format';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { SubmitOrderButton } from '@/components/business/order/SubmitOrderButton';
import { CancelOrderForm } from '@/components/business/order/CancelOrderForm';
import { ShipOrderForm } from '@/components/business/order/ShipOrderForm';
import { FinishOrderButton } from '@/components/business/order/FinishOrderButton';
import { UrgentToggleForm } from '@/components/business/order/UrgentToggleForm';
import { DesignUploadPanel } from '@/components/business/order/DesignUploadPanel';
import { PromisedDateBadge } from '@/components/business/order/PromisedDateBadge';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { OrderMaterialUsageEstimate } from '@/components/business/bom/OrderMaterialUsageEstimate';
import { estimateMaterialUsageForOrderItems } from '@/lib/bom';
import { formatDateTimeShanghai } from '@/lib/format/dates';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `工单 · ${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();
  const materialEstimate = await estimateMaterialUsageForOrderItems(order.items);

  const canSubmit =
    order.status === OrderStatus.DRAFT &&
    (order.submitterId === user.id ||
      user.role === Role.OWNER ||
      user.role === Role.FOREMAN);
  const canCancel =
    user.role === Role.OWNER && !isTerminalOrderStatus(order.status);
  // SHIPPED / FINISHED 转换权限：order:ship = OWNER + FOREMAN（见
  // permissions.ts）。这里 mirror 该闸口；action 层 requirePermission
  // 仍是真闸口。
  const canShipOrFinish =
    user.role === Role.OWNER || user.role === Role.FOREMAN;
  const canShip =
    canShipOrFinish && order.status === OrderStatus.COMPLETED;
  const canFinish =
    canShipOrFinish && order.status === OrderStatus.SHIPPED;

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
  // 设计图增删仅 DRAFT（提交后的增删属于 A05，等业主拍板）；所有权
  // 与编辑一致。lib/order-design.ts 是真闸口，这里 UI-only。
  const canEditDesigns = order.status === OrderStatus.DRAFT && canEdit;
  // Only foreman / owner creates outsource orders, and only on
  // production-active states. SHIPPED is non-terminal but already
  // out the door — no new production work attaches there.
  // canAttachOutsource() is the canonical gate;
  // lib/outsource.ts re-checks the same predicate.
  const canCreateOutsource =
    (user.role === Role.OWNER || user.role === Role.FOREMAN) &&
    canAttachOutsource(order.status);

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
            · 创建于 {formatDateTimeShanghai(order.createdAt)}
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
          {canCreateOutsource ? (
            <Link
              href={`/foreman/outsource/new?orderId=${order.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              外协
            </Link>
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
          <div>
            <dt className="text-muted-foreground">承诺交期</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              {order.promisedDate
                ? order.promisedDate.toISOString().slice(0, 10)
                : '—'}
              <PromisedDateBadge
                promisedDate={order.promisedDate}
                status={order.status}
              />
            </dd>
          </div>
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
              <DesignUploadPanel
                orderId={order.id}
                orderItemId={item.id}
                canEdit={canEditDesigns}
                designs={item.designs.map((d) => ({
                  id: d.id,
                  fileName: d.fileName,
                  fileType: d.fileType,
                  // bucket 私有：IMAGE 缩略图换成 30min 预签 GET。CDR 不签
                  // ——面板只显示 chip，把可用下载 URL 发给无 CDR 权限的
                  // 角色是越权（受控下载口在 /api/cdr/bundles）。
                  fileUrl:
                    d.fileType === 'IMAGE' ? signDesignReadUrl(d.fileUrl) : '',
                  // BigInt 不能过 RSC 序列化边界
                  fileSize: String(d.fileSize),
                }))}
              />
            </li>
          ))}
        </ol>
      </section>

      <OrderMaterialUsageEstimate estimate={materialEstimate} />

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-base font-semibold">修改日志</h2>
        {order.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="divide-y text-sm">
            {order.logs.slice(0, 10).map((log) => {
              const changes = formatOrderLogChanges(log.changedFields);
              return (
                <li key={log.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatDateTimeShanghai(log.createdAt)}
                    </span>
                    <span className="font-medium">{actionLabel(log.action)}</span>
                    <span className="text-muted-foreground">
                      · {log.operator.displayName}（{roleLabel(log.operator.role)}）
                    </span>
                    {log.remark ? (
                      <span className="text-muted-foreground">· {log.remark}</span>
                    ) : null}
                  </div>
                  {changes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {changes.map((c) => (
                        <li key={c.field} className="flex items-start gap-2">
                          <span className="min-w-[5rem] text-muted-foreground">
                            {c.label}
                          </span>
                          <span className="line-through text-muted-foreground">
                            {c.before}
                          </span>
                          <span>→</span>
                          <span className="font-medium">{c.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canShip ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">标记发货</h2>
          <p className="text-xs text-muted-foreground">
            所有任务已完工，工单进入 COMPLETED；标记发货后状态切到
            SHIPPED，可填运单号备查。
          </p>
          <ShipOrderForm orderId={order.id} />
        </section>
      ) : null}

      {canFinish ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">确认完工</h2>
          <p className="text-xs text-muted-foreground">
            发货确认收件 / 客户对账后点确认完工；状态切到 FINISHED 终态，
            工单不再活跃，但仍参与月度账单生成。
          </p>
          <FinishOrderButton orderId={order.id} />
        </section>
      ) : null}

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
