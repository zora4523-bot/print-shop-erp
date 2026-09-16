import { resolveReporterPieceworkRate } from '@/lib/salary/piecework-rate-selection';
import { PieceworkPricingError } from '@/lib/salary/piecework-pricing';
import { db } from '@/lib/db';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { PieceworkRateUnit } from '@/generated/prisma/enums';
import { listWorkerTaskDisputes } from '@/lib/production/task-dispute';
import { TaskDisputePanel } from '@/components/business/production/TaskDisputePanel';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import {
  getProductionOperationForReporter,
  getProductionProgressForReporter,
} from '@/lib/production/operation-portal';
import { getLegacyProductionTaskDetail } from '@/lib/production/legacy-task-reader';
import { OperationReportingError } from '@/lib/production/operation-reporting';
import {
  OperationReportForm,
  ProgressReportForm,
} from '@/components/business/production/OperationReportForm';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { StatusBadge } from '@/components/ui-business';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { formatDateShanghai } from '@/lib/format/dates';
import { formatMoney } from '@/lib/dashboard/format';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { PRODUCTION_OPERATION_STATUS_REGISTRY } from '@/lib/ui/status-registry';

type PageProps = { params: Promise<{ id: string }> };

export const metadata = { title: '生产工序' };

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包入袋',
};

async function readWorkerRate(workerId: string, operation: NonNullable<Awaited<ReturnType<typeof getProductionOperationForReporter>>>) {
  try {
    const currentRate = await resolveReporterPieceworkRate(db, workerId, operation.operationType, operation.unit as PieceworkRateUnit, await databaseClockNow(db));
    return { currentRate, rateError: '' };
  } catch (error) {
    if (!(error instanceof PieceworkPricingError)) throw error;
    return { currentRate: null, rateError: error.message };
  }
}

export default async function WorkerTaskDetailPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const actor = { id: user.id, role: user.role };
  let operation: Awaited<ReturnType<typeof getProductionOperationForReporter>> =
    null;
  try {
    operation = await getProductionOperationForReporter(id, actor);
  } catch (error) {
    // 旧工资/审计链接可能属于清废等新计件域未定义的岗位。
    // 只在账号没有新工序 lane 时允许继续查旧任务；其他报工错误不吞。
    if (
      !(error instanceof OperationReportingError) ||
      error.code !== 'ACCOUNT_NOT_AUTHORIZED'
    ) {
      throw error;
    }
  }
  if (operation) {
    const { currentRate, rateError } = await readWorkerRate(user.id, operation);
    const remainingQty = Decimal.max(
      new Decimal(operation.plannedCompletedQty).minus(operation.completedQty),
      0,
    ).toString();
    const workOrderProgressRemainingQty = Decimal.max(
      new Decimal(operation.workOrderTotalQty).minus(
        operation.workOrderProgressQty,
      ),
      0,
    ).toString();
    return (
      <div className="min-w-0 space-y-5">
        <header className="worker-wrap-anywhere min-w-0 space-y-1">
          <Link href={`/worker/orders/${operation.orderId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            返回工单选择工序
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-sans text-sm tabular-nums">
              {operation.orderNo}
            </span>
            {operation.isUrgent ? <UrgentBadge /> : null}
            <OperationStatusBadge status={operation.status} />
          </div>
          <h1 className="text-lg font-semibold">
            {OPERATION_LABELS[operation.operationType]}
            {operation.operationType === PieceworkOperationType.PACKING
              ? operation.sources.flatMap((source) => source.packagingGroup
                ? [` · 包装组 #${source.packagingGroup.sequence}`]
                : []).join('')
              : ''}
          </h1>
          {operation.customName ? (
            <p className="text-sm font-semibold">{operation.customName}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            计划 {operation.plannedCompletedQty}
            {operation.operationType === PieceworkOperationType.PACKING ? ' 袋' : ' 个'}
            {operation.promisedDate
              ? ` · 交期 ${formatDateShanghai(operation.promisedDate)}`
              : ''}
          </p>
        </header>

        {operation.status === ProductionOperationStatus.PENDING ||
        operation.status === ProductionOperationStatus.IN_PROGRESS ? (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">扫码报工</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              报工人：{user.displayName} · 累计合格 {operation.completedQty} / {operation.plannedCompletedQty}
              {' · '}本次提交的计件工资归本人
            </p>
            {operation.operationType === PieceworkOperationType.PACKING ? (
              <p className="mb-3 text-sm">剩余 {remainingQty} 袋</p>
            ) : null}
            {operation.operationType === PieceworkOperationType.PARTIAL && <p className="mb-3 text-sm">计薪过版次数：{operation.payrollPassCount} 次</p>}
            {currentRate ? <><p className="mb-3 text-sm">本人适用工价：{formatUnitPrice(currentRate.rule.amount.toString())}/{operation.unit === 'PER_PASS' ? '下' : operation.unit === 'PER_PIECE' ? '个' : operation.unit === 'PER_BOX' ? '盒' : '袋'} · {currentRate.source === 'PERSONAL' ? '个人工价' : '统一工价'} · 第 {currentRate.book.version} 版</p>
            {currentRate.rule.smallOrderAmount != null && currentRate.rule.setupAmount != null && <p className="mb-3 text-sm">小单（≤1000 个，含装版）：{formatUnitPrice(currentRate.rule.smallOrderAmount.toString())}/{operation.operationType === 'FULL' ? '色' : '次'}；大单装版费：{formatUnitPrice(currentRate.rule.setupAmount.toString())}/{operation.operationType === 'FULL' ? '色' : '次'}</p>}
            <OperationReportForm
              operationId={operation.id}
              payrollRevision={operation.payrollRevision}
              rateKey={currentRate.key}
              idempotencyKey={randomUUID()}
              remainingQty={remainingQty}
              workOrderProgressRemainingQty={workOrderProgressRemainingQty}
            /></> : <p role="alert" className="text-sm text-destructive">{rateError}</p>}
          </section>
        ) : null}

        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="font-semibold">工序进度</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="合格完成" value={operation.completedQty} />
            <Metric label="计划数量" value={operation.plannedCompletedQty} />
            <Metric label="缺陷记录" value={operation.defectQty} />
            <Metric label="返工记录" value={operation.reworkQty} />
            <Metric
              label={
                operation.operationType === PieceworkOperationType.PACKING
                  ? '打包工单进度'
                  : '烫金工单进度'
              }
              value={`${operation.workOrderProgressQty} / ${operation.workOrderTotalQty}`}
            />
          </dl>
        </section>

        {operation.packageRequirement || operation.orderRemark ? (
          <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
            <h2 className="font-semibold">包装与工单备注</h2>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">包装补充说明</dt>
                <dd className="break-words">
                  {operation.packageRequirement ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">工单备注</dt>
                <dd className="break-words">{operation.orderRemark ?? '—'}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="min-w-0 space-y-3">
          <h2 className="text-sm font-semibold">工序来源</h2>
          {operation.sources.map((source, index) =>
            source.item ? (
              <article
                key={source.item.id}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <h3 className="worker-wrap-anywhere min-w-0 font-semibold">
                  #{source.item.sequence} · {source.item.name}
                </h3>
                <p className="worker-wrap-anywhere mt-1 min-w-0 text-xs text-muted-foreground">
                  {source.item.specification
                    ? externalPriceBusinessText(source.item.specification)
                    : '未填规格'}
                  {' · '}
                  {source.item.paperType
                    ? externalPriceBusinessText(source.item.paperType)
                    : '未填纸张'}
                  {' · '}款式数量 {source.item.quantity}
                </p>
                {source.item.remark ? (
                  <HighlightedRemark className="mt-3">
                    {source.item.remark}
                  </HighlightedRemark>
                ) : null}
                <DesignImageGallery
                  images={source.item.designs.map((design) => ({
                    ...design,
                    fileUrl: signDesignReadUrl(design.fileUrl),
                  }))}
                />
              </article>
            ) : source.packagingGroup ? (
              <article
                key={source.packagingGroup.id}
                className="rounded-xl border bg-card p-4 text-sm shadow-sm"
              >
                <h3 className="font-semibold">
                  包装组 #{source.packagingGroup.sequence}
                  {source.packagingGroup.name
                    ? ` · ${source.packagingGroup.name}`
                    : ''}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  计划 {source.packagingGroup.actualBagCount} 袋
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {source.packagingGroup.lines.map((line) => (
                    <li key={line.orderItem.sequence}>
                      #{line.orderItem.sequence} · {line.orderItem.name} · 每袋 {line.unitsPerBag} 个
                    </li>
                  ))}
                </ul>
              </article>
            ) : (
              <p key={index} className="text-sm text-muted-foreground">
                来源记录不完整
              </p>
            ),
          )}
        </section>
      </div>
    );
  }

  const progress = await getProductionProgressForReporter(id, actor);
  if (progress) {
    const remainingQty = Decimal.max(
      new Decimal(progress.plannedQty).minus(progress.completedQty),
      0,
    ).toString();
    return (
      <div className="min-w-0 space-y-5">
        <header className="worker-wrap-anywhere min-w-0 space-y-1">
          <Link href={`/worker/orders/${progress.orderId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            返回工单选择工序
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-sans text-sm tabular-nums">
              {progress.orderNo}
            </span>
            {progress.isUrgent ? <UrgentBadge /> : null}
            <OperationStatusBadge status={progress.status} />
            <StatusBadge tone="neutral">进度·不计薪</StatusBadge>
          </div>
          <h1 className="text-lg font-semibold">{progress.craftName}</h1>
          <p className="text-sm">
            #{progress.orderItemSequence} · {progress.orderItemName}
          </p>
          <p className="text-xs text-muted-foreground">
            计划 {progress.plannedQty} 个
            {progress.promisedDate
              ? ` · 交期 ${formatDateShanghai(progress.promisedDate)}`
              : ''}
          </p>
        </header>

        {progress.status === ProductionOperationStatus.PENDING ||
        progress.status === ProductionOperationStatus.IN_PROGRESS ? (
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold">扫码报进度</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              累计合格 {progress.completedQty} / {progress.plannedQty}
            </p>
            <ProgressReportForm
              progressStepId={progress.id}
              idempotencyKey={randomUUID()}
              remainingQty={remainingQty}
            />
          </section>
        ) : null}

        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="font-semibold">工序进度</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="合格完成" value={progress.completedQty} />
            <Metric label="计划数量" value={progress.plannedQty} />
            <Metric label="缺陷记录" value={progress.defectQty} />
            <Metric label="返工记录" value={progress.reworkQty} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            此步骤仅推进生产进度，不产生计件工资。
          </p>
        </section>

        {progress.packageRequirement || progress.orderRemark ? (
          <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
            <h2 className="font-semibold">包装与工单备注</h2>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">包装补充说明</dt>
                <dd className="break-words">
                  {progress.packageRequirement ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">工单备注</dt>
                <dd className="break-words">{progress.orderRemark ?? '—'}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <article className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="worker-wrap-anywhere min-w-0 font-semibold">
            #{progress.item.sequence} · {progress.item.name}
          </h2>
          <p className="worker-wrap-anywhere mt-1 min-w-0 text-xs text-muted-foreground">
            {progress.item.specification
              ? externalPriceBusinessText(progress.item.specification)
              : '未填规格'}
            {' · '}
            {progress.item.paperType
              ? externalPriceBusinessText(progress.item.paperType)
              : '未填纸张'}
            {' · '}款式数量 {progress.item.quantity}
          </p>
          {progress.item.remark ? (
            <HighlightedRemark className="mt-3">
              {progress.item.remark}
            </HighlightedRemark>
          ) : null}
          <DesignImageGallery
            images={progress.item.designs.map((design) => ({
              ...design,
              fileUrl: signDesignReadUrl(design.fileUrl),
            }))}
          />
        </article>
      </div>
    );
  }

  return renderLegacyTaskDetail(id, actor);
}

// 旧任务分支单独成函数：WorkerTaskDetailPage 已贴着 300 行的架构门禁阈值。
async function renderLegacyTaskDetail(
  id: string,
  actor: Parameters<typeof getLegacyProductionTaskDetail>[1],
) {
  const legacyTask = await getLegacyProductionTaskDetail(id, actor);
  if (!legacyTask) notFound();
  return <LegacyTaskDetail task={legacyTask} disputes={await listWorkerTaskDisputes(id, actor)} />;
}

function OperationStatusBadge({
  status,
}: {
  status: ProductionOperationStatus;
}) {
  const definition = PRODUCTION_OPERATION_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

function LegacyTaskDetail({
  task,
  disputes,
}: {
  task: NonNullable<Awaited<ReturnType<typeof getLegacyProductionTaskDetail>>>;
  disputes: Awaited<ReturnType<typeof listWorkerTaskDisputes>>;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-sm tabular-nums">
            {task.orderItem.order.orderNo}
          </span>
          {task.orderItem.order.isUrgent ? <UrgentBadge /> : null}
          <StatusBadge tone="neutral">历史任务</StatusBadge>
        </div>
        <h1 className="text-lg font-semibold">
          #{task.orderItem.sequence} · {task.orderItem.name}
        </h1>
        <p className="text-xs text-muted-foreground">
          {task.craft.name} · 此记录来自旧派工流程，仅供查阅
        </p>
      </header>
      <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
        <h2 className="font-semibold">历史完工记录</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Metric label="计划数量" value={task.plannedQty} />
          <Metric label="合格数" value={task.completedQty} />
          <Metric label="缺陷数" value={task.defectQty} />
          <Metric label="返工数" value={task.reworkQty} />
          {task.workerType === WorkerType.MACHINE ? (
            <Metric label="历史计件金额" value={formatMoney(task.pieceworkAmount)} />
          ) : null}
          <Metric
            label="旧任务状态"
            value={
              task.status === TaskStatus.COMPLETED
                ? '已完工'
                : task.status === TaskStatus.CANCELLED
                  ? '已取消'
                  : '历史在途'
            }
          />
        </dl>
      </section>
      <TaskDisputePanel taskId={task.id} disputes={disputes} />
      {task.orderItem.remark ? (
        <HighlightedRemark>{task.orderItem.remark}</HighlightedRemark>
      ) : null}
      <DesignImageGallery
        images={task.orderItem.designs.map((design) => ({
          ...design,
          fileUrl: signDesignReadUrl(design.fileUrl),
        }))}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="worker-wrap-anywhere font-sans tabular-nums">{value}</dd>
    </div>
  );
}
