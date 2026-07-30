import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  OrderStatus,
  OutsourceStatus,
  Role,
} from '../../../../generated/prisma/enums';
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
import { getOrderPieceworkSummary } from '@/lib/salary/daily';
import { getPendingTaskReassignmentView } from '@/lib/production';
import { ReassignTaskForm } from '@/components/business/production/ReassignTaskForm';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';

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
  const [materialEstimate, pieceworkSummary, reassignmentView] = await Promise.all([
    estimateMaterialUsageForOrderItems(order.items),
    user.role === Role.ADMIN
      ? getOrderPieceworkSummary(order.id)
      : Promise.resolve(null),
    user.role === Role.ADMIN
      ? getPendingTaskReassignmentView(order.id)
      : Promise.resolve({ tasks: [] }),
  ]);

  const canSubmit =
    order.status === OrderStatus.DRAFT &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
  const canCancel =
    user.role === Role.ADMIN && !isTerminalOrderStatus(order.status);
  // SHIPPED / FINISHED 转换权限：order:ship = ADMIN（见
  // permissions.ts）。这里 mirror 该闸口；action 层 requirePermission
  // 仍是真闸口。
  const canShipOrFinish =
    user.role === Role.ADMIN;
  const hasLiveOutsource = order.outsourceOrders.some(
    (row) =>
      row.status === OutsourceStatus.SENT ||
      row.status === OutsourceStatus.IN_PROGRESS,
  );
  const canShip =
    canShipOrFinish &&
    order.status === OrderStatus.COMPLETED &&
    !hasLiveOutsource;
  const canFinish =
    canShipOrFinish && order.status === OrderStatus.SHIPPED;

  // Editing follows SPEC §3.6. Ownership mirrors the action-layer
  // guard: SALES / CUSTOMER_SERVICE only their own; ADMIN
  // any. Server still re-verifies on submit — this is UI-only.
  const canEdit =
    isOrderEditable(order.status) &&
    (order.submitterId === user.id || user.role === Role.ADMIN);
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
    (user.role === Role.ADMIN) &&
    canAttachOutsource(order.status);

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="admin-wrap-anywhere min-w-0 font-sans tabular-nums">
              {order.orderNo}
            </span>
            {order.isUrgent ? (
              <Badge variant="destructive">
                急单
              </Badge>
            ) : null}
          </h1>
          {order.customName ? (
            <p className="admin-wrap-anywhere mt-1 text-base font-semibold text-foreground">
              {order.customName}
            </p>
          ) : null}
          <p className="admin-wrap-anywhere text-sm text-muted-foreground">
            提交人：{order.submitter.displayName}（{roleLabel(order.submitter.role)}）
            · 创建于 {formatDateTimeShanghai(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">基本信息</h2>
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="工单名称" value={order.customName} full />
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
          <Row label="总额" value={String(order.totalAmount)} tabular />
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">款式（{order.items.length}）</h2>
        <ol className="space-y-3">
          {order.items.map((item) => (
            <li key={item.id} className="min-w-0 rounded-lg border p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="admin-wrap-anywhere min-w-0 font-medium">
                  #{item.sequence} · {item.name}
                </div>
                <div className="admin-wrap-anywhere font-sans tabular-nums text-xs text-muted-foreground sm:shrink-0 sm:text-right">
                  {item.quantity} × {String(item.unitPrice)} = {String(item.subtotal)}
                </div>
              </div>
              <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <Row label="规格" value={item.specification} />
                <Row label="纸张" value={item.paperType} />
                <Row label="烫金色" value={formatFoilColors(item.foilColors)} />
                <Row
                  label="双面 / 双色"
                  value={`${item.isDoubleSided ? '双面' : '单面'} · ${item.isDoubleColor ? '双色' : '单色'}`}
                />
                <Row
                  label="工艺"
                  value={item.crafts.length ? item.crafts.join('、') : '—'}
                  full
                />
              </dl>
              {item.remark ? (
                <HighlightedRemark
                  className="admin-wrap-anywhere mt-3"
                >
                  {item.remark}
                </HighlightedRemark>
              ) : null}
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

      {reassignmentView.tasks.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">未开工任务改派</h2>
            <p className="text-xs text-muted-foreground">
              只能改派未开工任务；已开工或已完工任务会固定师傅与薪资归属。
            </p>
          </div>
          <ul className="divide-y text-sm">
            {reassignmentView.tasks.map((task) => (
              <li
                key={task.id}
                className="grid items-center gap-3 py-3 sm:grid-cols-[1fr_1fr_minmax(320px,1.5fr)]"
              >
                <span>#{task.itemSequence} · {task.itemName}</span>
                <span>
                  {task.craftName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    当前：{task.currentWorkerName ?? '未派工'}
                  </span>
                </span>
                <ReassignTaskForm
                  taskId={task.id}
                  orderId={order.id}
                  currentWorkerId={task.currentWorkerId}
                  eligibleWorkers={task.eligibleWorkers}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <OrderMaterialUsageEstimate estimate={materialEstimate} />

      {pieceworkSummary ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">计件工资关联</h2>
              <p className="text-xs text-muted-foreground">
                仅管理员可见；金额来自已生成的日薪任务明细。
              </p>
            </div>
            <strong className="admin-wrap-anywhere font-sans tabular-nums text-primary">
              合计 ¥ {pieceworkSummary.total}
            </strong>
          </div>
          {pieceworkSummary.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无已汇总计件明细。</p>
          ) : (
            <ul className="divide-y text-sm">
              {pieceworkSummary.items.map((item) => (
                <li
                  key={item.id}
                  className="grid gap-2 py-3 sm:grid-cols-[120px_1fr_100px_140px]"
                >
                  <span>{item.dailySalary.worker.displayName}</span>
                  <span className="admin-wrap-anywhere min-w-0">
                    {item.orderItemName} · {item.craftName}
                  </span>
                  <span className="font-sans tabular-nums sm:text-right">¥ {String(item.pieceworkAmount)}</span>
                  <Link
                    href={`/owner/salary/daily/${item.dailySalaryId}`}
                    className="text-xs text-primary underline sm:justify-end sm:text-right"
                  >
                    查看工资明细
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">修改日志</h2>
        {order.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="divide-y text-sm">
            {order.logs.slice(0, 10).map((log) => {
              const changes = formatOrderLogChanges(log.changedFields);
              return (
                <li key={log.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
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
                        <li key={c.field} className="flex min-w-0 flex-wrap items-start gap-2">
                          <span className="min-w-20 text-muted-foreground">
                            {c.label}
                          </span>
                          <span className="admin-wrap-anywhere line-through text-muted-foreground">
                            {c.before}
                          </span>
                          <span>→</span>
                          <span className="admin-wrap-anywhere font-medium">{c.after}</span>
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

      {canShipOrFinish &&
      order.status === OrderStatus.COMPLETED &&
      hasLiveOutsource ? (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-6">
          <h2 className="text-base font-semibold">暂不能发货</h2>
          <p className="text-sm text-muted-foreground">
            该工单仍有已发送或进行中的外协单。请先在外协管理中标记收货或取消，系统才会开放发货。
          </p>
          <Link
            href="/foreman/outsource"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看外协单
          </Link>
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

      <div className="flex flex-col gap-4 sm:flex-row">
        {canSubmit ? <SubmitOrderButton orderId={order.id} /> : null}
        {canCancel ? (
          <div className="min-w-0 flex-1 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="mb-2 text-base font-semibold">取消工单</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              取消后工单进入 CANCELLED 终态，不再参与排产 / 生产。仅管理员可操作。
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
  tabular,
  full,
}: {
  label: string;
  value: string | null | undefined;
  tabular?: boolean;
  full?: boolean;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className={full ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tabular
            ? 'admin-wrap-anywhere font-sans tabular-nums'
            : 'admin-wrap-anywhere'
        }
      >
        {display}
      </dd>
    </div>
  );
}
