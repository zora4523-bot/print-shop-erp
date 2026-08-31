import { notFound } from 'next/navigation';
import { Role, TaskStatus, WorkerType } from '@/generated/prisma/enums';
import { getSession, requireSession } from '@/lib/auth/session';
import { getWorkerTaskDetail } from '@/lib/production';
import { getWorkerTaskTitleRef } from '@/lib/page-title/refs';
import { workerTaskTitle } from '@/lib/page-title/titles';
import { machineTypeLabel } from '@/lib/auth/role-labels';
import { StatusBadge } from '@/components/ui-business';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { BeginTaskButton } from '@/components/business/production/BeginTaskButton';
import { ReportTaskForm } from '@/components/business/production/ReportTaskForm';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { getSetting } from '@/lib/settings';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';
import { PRODUCTION_TASK_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { listWorkerTaskDisputes } from '@/lib/production/task-dispute';
import { TaskDisputePanel } from '@/components/business/production/TaskDisputePanel';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: '任务' };
  // 与 getWorkerTaskDetail 共用 getWorkerTaskScopeFilter：非 ADMIN 只能
  // 读分配给自己、且工单已离开 SUBMITTED 草稿态的任务。
  const ref = await getWorkerTaskTitleRef(
    id,
    session.user.id,
    session.user.role,
  );
  return {
    title: workerTaskTitle(
      ref
        ? {
            orderNo: ref.orderItem.order.orderNo,
            sequence: ref.orderItem.sequence,
          }
        : null,
    ),
  };
}

export default async function WorkerTaskDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const task = await getWorkerTaskDetail(id, { id: user.id, role: user.role });
  if (!task) notFound();
  const isPiecework = task.workerType === WorkerType.MACHINE;
  // 报工数量上限（计划数 × Setting 的倍数）。只用来在表单上给出说明文字，
  // 真正的判定在 lib/production.ts 的 reportTask 里、事务内做。
  const [reportSetting, disputes] = await Promise.all([
    getSetting('report_qty_max_multiple'),
    user.role === Role.WORKER
      ? listWorkerTaskDisputes(task.id, { id: user.id, role: user.role })
      : Promise.resolve([]),
  ]);
  const { multiple: maxReportMultiple } = reportSetting;

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="worker-wrap-anywhere min-w-0 font-sans tabular-nums text-sm">
            {task.orderItem.order.orderNo}
          </span>
          {task.orderItem.order.isUrgent ? (
            <UrgentBadge />
          ) : null}
          <ProductionTaskStatusBadge status={task.status} />
        </div>
        <h1 className="worker-wrap-anywhere text-lg font-semibold">
          #{task.orderItem.sequence} · {task.orderItem.name}
        </h1>
        {task.orderItem.order.customName ? (
          <p className="worker-wrap-anywhere text-sm font-semibold">
            {task.orderItem.order.customName}
          </p>
        ) : null}
        <p className="worker-wrap-anywhere text-xs text-muted-foreground">
          客户名称/简称：{task.orderItem.order.customerRef ?? '—'} · 工艺：
          {task.craft.name}
          {task.machineType
            ? ` · ${machineTypeLabel(task.machineType)}`
            : ''}
          {' · '}接单人：{task.orderItem.order.submitter.displayName}
        </p>
      </header>

      {task.status === TaskStatus.PENDING ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <BeginTaskButton taskId={task.id} />
        </section>
      ) : null}

      {task.status === TaskStatus.IN_PROGRESS ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">报工</h2>
          <ReportTaskForm
            taskId={task.id}
            plannedQty={task.plannedQty}
            maxReportQty={task.plannedQty * maxReportMultiple}
            isPiecework={isPiecework}
          />
        </section>
      ) : null}

      {task.orderItem.remark ? (
        <HighlightedRemark className="worker-wrap-anywhere">
          {task.orderItem.remark}
        </HighlightedRemark>
      ) : null}

      <Disclosure className="rounded-xl border bg-card p-4 text-sm shadow-sm">
        <DisclosureSummary className="font-semibold">
          任务规格与设计图
        </DisclosureSummary>
        <DesignImageGallery
          headingLevel={2}
          images={task.orderItem.designs.map((design) => ({
            ...design,
            fileUrl: signDesignReadUrl(design.fileUrl),
          }))}
        />

        <section className="mt-3">
          <h2 className="mb-2 text-sm font-semibold">任务规格</h2>
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label="计划数量" value={task.plannedQty.toLocaleString()} tabular />
            <Row
              label="规格"
              value={
                task.orderItem.specification
                  ? externalPriceBusinessText(task.orderItem.specification)
                  : '—'
              }
            />
            <Row
              label="纸张"
              value={
                task.orderItem.paperType
                  ? externalPriceBusinessText(task.orderItem.paperType)
                  : '—'
              }
            />
            <Row
              label="烫金色"
              value={formatFoilColors(task.orderItem.foilColors)}
            />
            <Row
              label="双面 / 双色"
              value={`${task.orderItem.isDoubleSided ? '双面' : '单面'} · ${task.orderItem.isDoubleColor ? '双色' : '单色'}`}
            />
          </dl>
        </section>
      </Disclosure>

      {task.status === TaskStatus.COMPLETED ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">已完工</h2>
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label="合格数" value={task.completedQty.toLocaleString()} tabular />
            <Row label="不良数" value={task.defectQty.toLocaleString()} tabular />
            <Row label="返工数" value={task.reworkQty.toLocaleString()} tabular />
            {isPiecework ? (
              <>
                <Row label="板数" value={String(task.boardCount)} tabular />
                <Row label="下数" value={task.pressCount.toLocaleString()} tabular />
                <Row
                  label="计件金额"
                  value={`¥ ${String(task.pieceworkAmount)}`}
                  tabular
                  full
                />
              </>
            ) : (
              <Row label="计薪方式" value="按考勤时薪结算" full />
            )}
          </dl>
        </section>
      ) : null}

      {task.status === TaskStatus.CANCELLED ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <p className="text-muted-foreground">此任务已取消。</p>
        </section>
      ) : null}

      {user.role === Role.WORKER ? (
        <TaskDisputePanel taskId={task.id} disputes={disputes} />
      ) : null}
    </div>
  );
}

function ProductionTaskStatusBadge({ status }: { status: TaskStatus }) {
  const definition = PRODUCTION_TASK_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
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
    <div className={full ? 'col-span-full min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`worker-wrap-anywhere ${tabular ? 'font-sans tabular-nums' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
