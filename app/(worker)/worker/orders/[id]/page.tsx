import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskStatus, WorkerType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getWorkerOrderDetail } from '@/lib/worker-portal';
import { orderStatusZh } from '@/lib/order/log-format';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';

type PageProps = { params: Promise<{ id: string }> };

export default async function WorkerOrderDetailPage({ params }: PageProps) {
  const user = await requirePermission('order:view:self');
  const { id } = await params;
  const order = await getWorkerOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="worker-wrap-anywhere min-w-0 font-sans tabular-nums text-sm">
            {order.orderNo}
          </span>
          <Badge variant="outline">{orderStatusZh(order.status)}</Badge>
          {order.isUrgent ? (
            <Badge
              variant="destructive"
              className="bg-destructive text-background dark:bg-destructive dark:text-background"
            >
              急单
            </Badge>
          ) : null}
        </div>
        <h1 className="text-lg font-semibold">我的工单任务</h1>
        {order.customName ? (
          <p className="worker-wrap-anywhere text-sm font-semibold">
            {order.customName}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          客户代号：{order.customerRef ?? '—'}
          {order.promisedDate ? ` · 交期 ${formatDateShanghai(order.promisedDate)}` : ''}
        </p>
      </header>

      {(order.packageRequirement || order.remark) ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">生产备注</h2>
          <p className="worker-wrap-anywhere">
            包装要求：{order.packageRequirement ?? '—'}
          </p>
          <p className="worker-wrap-anywhere mt-1">
            工单备注：{order.remark ?? '—'}
          </p>
        </section>
      ) : null}

      <div className="space-y-3">
        {order.items.map((item) => (
          <section
            key={item.id}
            className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
          >
            <h2 className="worker-wrap-anywhere font-medium">
              #{item.sequence} · {item.name}
            </h2>
            <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
              {item.specification ?? '未填规格'} ·{' '}
              {item.paperType ?? '未填纸张'} · 数量{' '}
              {item.quantity.toLocaleString()} ·{' '}
              烫金色 {formatFoilColors(item.foilColors, '未填')} ·{' '}
              {item.isDoubleSided ? '双面' : '单面'} ·{' '}
              {item.isDoubleColor ? '双色' : '单色'}
            </p>
            {item.remark ? (
              <HighlightedRemark className="worker-wrap-anywhere mt-3">
                {item.remark}
              </HighlightedRemark>
            ) : null}
            <DesignImageGallery
              images={item.designs.map((design) => ({
                ...design,
                fileUrl: signDesignReadUrl(design.fileUrl),
              }))}
            />
            <ul className="mt-3 divide-y border-t">
              {item.tasks.map((task) => (
                <li key={task.id} className="py-3 text-sm">
                  <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="worker-wrap-anywhere min-w-0">
                          {task.craft.name}
                        </strong>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                        {task.machineType
                          ? MACHINE_TYPE_LABELS[task.machineType]
                          : '无机型'}{' '}
                        · 计划 {task.plannedQty.toLocaleString()}
                      </p>
                    </div>
                    <div className="ml-auto shrink-0 text-right">
                      {task.workerType === WorkerType.MACHINE ? (
                        <>
                          <p className="text-xs text-muted-foreground">计件金额</p>
                          <p className="font-sans tabular-nums font-medium">
                            ¥ {String(task.pieceworkAmount)}
                          </p>
                        </>
                      ) : (
                        <p className="worker-wrap-anywhere text-xs text-muted-foreground">
                          按考勤时薪结算
                        </p>
                      )}
                    </div>
                  </div>
                  {task.status === TaskStatus.COMPLETED ? (
                    <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-3">
                      <Metric label="良品" value={task.completedQty} />
                      <Metric label="次品" value={task.defectQty} />
                      <Metric label="返工" value={task.reworkQty} />
                      {task.workerType === WorkerType.MACHINE ? (
                        <>
                          <Metric label="板数" value={task.boardCount} />
                          <Metric label="下数" value={task.pressCount} />
                        </>
                      ) : null}
                      <Metric
                        label="完工"
                        value={
                          task.completedAt
                            ? formatDateTimeShanghai(task.completedAt)
                            : '—'
                        }
                      />
                    </dl>
                  ) : (
                    <Link
                      href={`/worker/tasks/${task.id}`}
                      className="mt-3 inline-flex min-h-11 min-w-11 items-center text-sm text-foreground underline decoration-primary"
                    >
                      前往处理任务
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const label =
    status === TaskStatus.PENDING
      ? '待开始'
      : status === TaskStatus.IN_PROGRESS
        ? '进行中'
        : status === TaskStatus.COMPLETED
          ? '已完工'
          : '已取消';
  return (
    <Badge variant={status === TaskStatus.COMPLETED ? 'secondary' : 'outline'}>
      {label}
    </Badge>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="worker-wrap-anywhere font-sans tabular-nums">
        {value}
      </dd>
    </div>
  );
}
