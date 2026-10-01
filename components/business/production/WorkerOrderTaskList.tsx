import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { ProductionOperationStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { PRODUCTION_OPERATION_STATUS_REGISTRY } from '@/lib/ui/status-registry';

export type WorkerOrderTaskCard = {
  id: string;
  title: string;
  sources: string[];
  status: ProductionOperationStatus;
  planned: string;
  completed: string;
  remaining: string;
  unit: '个' | '袋' | '盒';
  myAmount?: string;
  /** 他岗位的进度：本人打不开报工页，只展示不链接。 */
  readOnly?: boolean;
};

export function WorkerOrderTaskList({
  reporterName,
  laneLabel,
  operations,
  progressSteps,
}: {
  reporterName: string;
  laneLabel: string;
  operations: WorkerOrderTaskCard[];
  progressSteps: WorkerOrderTaskCard[];
}) {
  return (
    <section className="min-w-0 space-y-4" aria-label="选择报工工序">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">选择本次报工工序</h2>
        <p className="worker-wrap-anywhere mt-2 text-sm">{reporterName} · {laneLabel}</p>
      </div>
      <TaskGroup title="本岗位计件工序" tasks={operations} paid />
      {progressSteps.length > 0 ? (
        <TaskGroup title="共享生产进度" tasks={progressSteps} paid={false} />
      ) : null}
    </section>
  );
}

function isUnfinished(task: WorkerOrderTaskCard) {
  return task.status === ProductionOperationStatus.PENDING ||
    task.status === ProductionOperationStatus.IN_PROGRESS;
}

function TaskGroup({ title, tasks, paid }: {
  title: string;
  tasks: WorkerOrderTaskCard[];
  paid: boolean;
}) {
  const unfinished = tasks.filter(isUnfinished);
  const finished = tasks.filter((task) => !isUnfinished(task));
  return (
    <section className="min-w-0 space-y-3" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {!paid ? <p className="text-xs text-muted-foreground">不计薪</p> : null}
      {unfinished.map((task) => <TaskCard key={task.id} task={task} paid={paid} />)}
      {unfinished.length === 0 ? (
        <p role="status" className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          {tasks.length > 0 ? '本组工序已完成，暂无待报工任务。' : '当前工单没有本岗位计件工序。'}
        </p>
      ) : null}
      {finished.length > 0 ? (
        <Disclosure className="rounded-xl border bg-card p-4">
          <DisclosureSummary className="justify-between gap-2">
            <span>已完成工序 · {finished.length}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          </DisclosureSummary>
          <div className="mt-3 space-y-3">
            {finished.map((task) => <TaskCard key={task.id} task={task} paid={paid} />)}
          </div>
        </Disclosure>
      ) : null}
    </section>
  );
}

function TaskCard({ task, paid }: { task: WorkerOrderTaskCard; paid: boolean }) {
  const body = <TaskCardBody task={task} paid={paid} />;
  if (task.readOnly) {
    return <div className="worker-wrap-anywhere block min-h-11 min-w-0 rounded-xl border bg-muted/20 p-4">{body}</div>;
  }
  return (
    <Link
      href={`/worker/tasks/${encodeURIComponent(task.id)}`}
      className="worker-wrap-anywhere block min-h-11 min-w-0 rounded-xl border bg-card p-4 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {body}
    </Link>
  );
}

function TaskCardBody({ task, paid }: { task: WorkerOrderTaskCard; paid: boolean }) {
  const status = PRODUCTION_OPERATION_STATUS_REGISTRY[task.status];
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{task.title}</strong>
        <StatusBadge tone={status.tone} dot={status.dot}>{status.label}</StatusBadge>
      </div>
      {task.sources.map((source, index) => <p key={index} className="mt-2 text-xs text-muted-foreground">{source}</p>)}
      <p className="mt-3 text-sm tabular-nums">
        剩余 <strong>{task.remaining}</strong> {task.unit}
        <span className="ml-3 text-xs text-muted-foreground">计划 {task.planned} · 已报合格 {task.completed}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{paid ? `我的已报计件 ${task.myAmount ?? '—'}` : '不计薪'}</span>
        {task.readOnly
          ? <span className="text-muted-foreground">由其他岗位报工</span>
          : <span className="font-semibold">{isUnfinished(task) ? '进入报工 →' : '查看进度 →'}</span>}
      </div>
    </>
  );
}
