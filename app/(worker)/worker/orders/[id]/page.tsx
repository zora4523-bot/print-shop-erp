import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getWorkerOrderDetail } from '@/lib/worker-portal';
import { orderStatusZh } from '@/lib/order/log-format';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';

type PageProps = { params: Promise<{ id: string }> };

export default async function WorkerOrderDetailPage({ params }: PageProps) {
  const user = await requirePermission('order:view:self');
  const { id } = await params;
  const order = await getWorkerOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans tabular-nums text-sm">{order.orderNo}</span>
          <Badge variant="outline">{orderStatusZh(order.status)}</Badge>
          {order.isUrgent ? <Badge variant="destructive">急单</Badge> : null}
        </div>
        <h1 className="text-lg font-semibold">我的工单任务</h1>
        <p className="text-xs text-muted-foreground">
          客户代号：{order.customerRef ?? '—'}
          {order.promisedDate ? ` · 交期 ${formatDateShanghai(order.promisedDate)}` : ''}
        </p>
      </header>

      {(order.packageRequirement || order.remark) ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">生产备注</h2>
          <p>包装要求：{order.packageRequirement ?? '—'}</p>
          <p className="mt-1">工单备注：{order.remark ?? '—'}</p>
        </section>
      ) : null}

      <div className="space-y-3">
        {order.items.map((item) => (
          <section key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="font-medium">#{item.sequence} · {item.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.specification ?? '未填规格'} · {item.paperType ?? '未填纸张'} · 数量 {item.quantity.toLocaleString()}
              {' · '}{item.isDoubleSided ? '双面' : '单面'} · {item.isDoubleColor ? '双色' : '单色'}
            </p>
            {item.remark ? <p className="mt-2 text-xs">款式备注：{item.remark}</p> : null}
            <ul className="mt-3 divide-y border-t">
              {item.tasks.map((task) => (
                <li key={task.id} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong>{task.craft.name}</strong>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.machineType ? MACHINE_TYPE_LABELS[task.machineType] : '无机型'} · 计划 {task.plannedQty.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">计件金额</p>
                      <p className="font-sans tabular-nums font-medium">¥ {String(task.pieceworkAmount)}</p>
                    </div>
                  </div>
                  {task.status === TaskStatus.COMPLETED ? (
                    <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
                      <Metric label="良品" value={task.completedQty} />
                      <Metric label="次品" value={task.defectQty} />
                      <Metric label="返工" value={task.reworkQty} />
                      <Metric label="板数" value={task.boardCount} />
                      <Metric label="下数" value={task.pressCount} />
                      <Metric label="完工" value={task.completedAt ? formatDateTimeShanghai(task.completedAt) : '—'} />
                    </dl>
                  ) : (
                    <Link
                      href={`/worker/tasks/${task.id}`}
                      className="mt-3 inline-block text-sm text-primary underline"
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
  const label = status === TaskStatus.PENDING ? '待开始' : status === TaskStatus.IN_PROGRESS ? '进行中' : status === TaskStatus.COMPLETED ? '已完工' : '已取消';
  return <Badge variant={status === TaskStatus.COMPLETED ? 'default' : 'outline'}>{label}</Badge>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="font-sans tabular-nums">{value}</dd></div>;
}
