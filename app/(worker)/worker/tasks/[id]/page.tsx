import { notFound } from 'next/navigation';
import { TaskStatus } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { getWorkerTaskDetail } from '@/lib/production';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { BeginTaskButton } from '@/components/business/production/BeginTaskButton';
import { ReportTaskForm } from '@/components/business/production/ReportTaskForm';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `任务 · ${id.slice(0, 6).toUpperCase()}` };
}

export default async function WorkerTaskDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const task = await getWorkerTaskDetail(id, { id: user.id, role: user.role });
  if (!task) notFound();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-sans tabular-nums text-sm">{task.orderItem.order.orderNo}</span>
          {task.orderItem.order.isUrgent ? (
            <Badge variant="destructive">急单</Badge>
          ) : null}
          <StatusBadge status={task.status} />
        </div>
        <h1 className="text-lg font-semibold">
          #{task.orderItem.sequence} · {task.orderItem.name}
        </h1>
        <p className="text-xs text-muted-foreground">
          客户代号：{task.orderItem.order.customerRef ?? '—'} · 工艺：
          {task.craft.name}
          {task.machineType
            ? ` · ${MACHINE_TYPE_LABELS[task.machineType] ?? task.machineType}`
            : ''}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">任务规格</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Row label="计划数量" value={task.plannedQty.toLocaleString()} tabular />
          <Row label="规格" value={task.orderItem.specification ?? '—'} />
          <Row label="纸张" value={task.orderItem.paperType ?? '—'} />
          <Row
            label="双面 / 双色"
            value={`${task.orderItem.isDoubleSided ? '双面' : '单面'} · ${task.orderItem.isDoubleColor ? '双色' : '单色'}`}
          />
        </dl>
      </section>

      {task.status === TaskStatus.PENDING ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <BeginTaskButton taskId={task.id} />
        </section>
      ) : null}

      {task.status === TaskStatus.IN_PROGRESS ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">报工</h2>
          <ReportTaskForm taskId={task.id} plannedQty={task.plannedQty} />
        </section>
      ) : null}

      {task.status === TaskStatus.COMPLETED ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">已完工</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Row label="合格数" value={task.completedQty.toLocaleString()} tabular />
            <Row label="不良数" value={task.defectQty.toLocaleString()} tabular />
            <Row label="返工数" value={task.reworkQty.toLocaleString()} tabular />
            <Row label="板数" value={String(task.boardCount)} tabular />
            <Row label="下数" value={task.pressCount.toLocaleString()} tabular />
            <Row
              label="计件金额"
              value={`¥ ${String(task.pieceworkAmount)}`}
              tabular
              full
            />
          </dl>
        </section>
      ) : null}

      {task.status === TaskStatus.CANCELLED ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <p className="text-muted-foreground">此任务已取消。</p>
        </section>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  switch (status) {
    case TaskStatus.PENDING:
      return <Badge variant="outline">待开始</Badge>;
    case TaskStatus.IN_PROGRESS:
      return <Badge variant="secondary">进行中</Badge>;
    case TaskStatus.COMPLETED:
      return <Badge>已完工</Badge>;
    case TaskStatus.CANCELLED:
      return <Badge variant="outline">已取消</Badge>;
  }
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
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tabular ? 'font-sans tabular-nums' : undefined}>{value}</dd>
    </div>
  );
}
