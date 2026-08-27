'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { Check, Minus } from 'lucide-react';
import { beginTasksAction, reportTasksAction } from '@/actions/production';
import type { BatchTaskMutationResult } from '@/actions/production.types';
import {
  MachineType,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/enums';
import {
  machineTypeLabel,
  workerTypeLabel,
} from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import {
  ActionNotice,
  ConfirmActionDialog,
  StatusBadge,
} from '@/components/ui-business';
import { PRODUCTION_TASK_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { cn } from '@/lib/utils';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export type WorkerBatchTaskRow = {
  id: string;
  status: TaskStatus;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  plannedQty: number;
  item: {
    name: string;
    sequence: number;
    isDoubleSided: boolean;
    isDoubleColor: boolean;
  };
  craft: { name: string };
  order: {
    orderNo: string;
    customName: string | null;
    isUrgent: boolean;
    promisedDate: Date | null;
    submitterName: string;
  };
};

type BatchOperation = 'begin' | 'report';

type CompletionPreview = {
  tasks: WorkerBatchTaskRow[];
  excludedPendingCount: number;
};

function compensationImpact(task: WorkerBatchTaskRow): string {
  const workerType =
    task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);

  if (workerType === WorkerType.MACHINE) {
    if (!task.machineType) {
      return '缺少机型信息，无法整批完工';
    }
    const machineLabel = machineTypeLabel(task.machineType);
    return `计件工资按“${machineLabel}”当前规则计算`;
  }

  if (
    workerType === WorkerType.PACKER ||
    workerType === WorkerType.CLEANER
  ) {
    return `本任务按“${workerTypeLabel(workerType)}”时薪结算，不生成计件工资`;
  }

  return '缺少岗位信息，无法整批完工';
}

/**
 * 仅预览当前客户端已经拥有的任务快照。最终权限、状态、
 * 计划数与薪资规则仍由 reportTasks() 在同一事务内重新校验。
 */
export function batchCompletionImpactItems({
  tasks,
  workerName,
  excludedPendingCount = 0,
}: {
  tasks: readonly WorkerBatchTaskRow[];
  workerName: string;
  excludedPendingCount?: number;
}): string[] {
  const impacts = [
    `本次仅完工 ${tasks.length} 个进行中任务；每项按计划数全部记为合格，不良数和返工数均为 0。`,
    '任一任务在提交时不符合条件，本批任务都不会完工。',
  ];

  if (excludedPendingCount > 0) {
    impacts.push(
      `另外选中的 ${excludedPendingCount} 个待开始任务不在本次完工范围内，不会被报工。`,
    );
  }

  return impacts.concat(
    tasks.map(
      (task) =>
        `工单 ${task.order.orderNo} · 任务 #${task.item.sequence} ${externalPriceBusinessText(task.item.name)} · 工艺 ${task.craft.name} · 计划/合格数量 ${task.plannedQty.toLocaleString()} · 当前师傅 ${workerName} · ${compensationImpact(task)}`,
    ),
  );
}

export function validateBatchCompletionPreview(
  tasks: readonly WorkerBatchTaskRow[],
): string | null {
  if (tasks.length === 0) return '请至少选择一个进行中任务';
  if (tasks.length > 50) return '单次最多完工 50 个任务';

  const taskIds = tasks.map((task) => task.id);
  if (new Set(taskIds).size !== taskIds.length) return '任务不能重复选择';
  if (taskIds.some((taskId) => !/^[A-Za-z0-9_-]+$/.test(taskId.trim()))) {
    return '任务参数异常，请刷新后重试';
  }

  for (const task of tasks) {
    const taskLabel = `工单 ${task.order.orderNo} 的任务“${externalPriceBusinessText(task.item.name)}”`;
    if (task.status !== TaskStatus.IN_PROGRESS) {
      return `${taskLabel}不是进行中状态，请刷新后重试`;
    }
    if (!Number.isSafeInteger(task.plannedQty) || task.plannedQty <= 0) {
      return `${taskLabel}的计划数量异常，请联系管理员修复`;
    }

    const workerType =
      task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);
    if (workerType === WorkerType.MACHINE && !task.machineType) {
      return `${taskLabel}缺少机型信息，请联系管理员改派`;
    }
    if (
      workerType !== WorkerType.MACHINE &&
      workerType !== WorkerType.PACKER &&
      workerType !== WorkerType.CLEANER
    ) {
      return `${taskLabel}缺少有效的生产岗位信息，请联系管理员改派`;
    }
  }

  return null;
}

function BatchCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  // 只用于表头「全选」：部分选中时置原生 indeterminate，读屏器据此
  // 播报 “mixed”。不额外写 aria-checked——原生 checkbox 上手写会和
  // 原生状态打架。
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none flex size-5 items-center justify-center rounded border border-input bg-background text-primary-foreground peer-disabled:opacity-40 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-checked:border-primary peer-checked:bg-primary peer-indeterminate:border-primary peer-indeterminate:bg-primary"
      >
        {indeterminate ? (
          <Minus className="size-4" />
        ) : (
          <Check className={checked ? 'size-4' : 'size-4 opacity-0'} />
        )}
      </span>
    </span>
  );
}

export function WorkerTaskBatchList({
  tasks,
  workerName,
}: {
  tasks: WorkerBatchTaskRow[];
  workerName: string;
}) {
  const router = useRouter();
  const completionTriggerRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<BatchTaskMutationResult | null>(null);
  const [operation, setOperation] = useState<BatchOperation | null>(null);
  const [transportFailure, setTransportFailure] = useState(false);
  const [completionPreview, setCompletionPreview] =
    useState<CompletionPreview | null>(null);
  const [completionConfirmationOpen, setCompletionConfirmationOpen] =
    useState(false);
  const [pending, startTransition] = useTransition();
  const selectedPending = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            selected.has(task.id) && task.status === TaskStatus.PENDING,
        )
        .map((task) => task.id),
    [selected, tasks],
  );
  const selectedInProgress = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            selected.has(task.id) && task.status === TaskStatus.IN_PROGRESS,
        )
        .map((task) => task.id),
    [selected, tasks],
  );
  const taskGroups = useMemo(
    () => [
      {
        key: TaskStatus.IN_PROGRESS,
        label:
          PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.IN_PROGRESS].label,
        rows: tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS),
      },
      {
        key: TaskStatus.PENDING,
        label: PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.PENDING].label,
        rows: tasks.filter((task) => task.status === TaskStatus.PENDING),
      },
    ],
    [tasks],
  );
  // tasks.length > 0 是必要的：空列表时 0 === 0 会让表头框显示已勾选。
  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(taskId: string) {
    if (pending) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function run(
    nextOperation: BatchOperation,
    action: (raw: unknown) => Promise<BatchTaskMutationResult>,
    taskIds: string[],
  ) {
    if (pending || taskIds.length === 0) return;
    setState(null);
    setOperation(nextOperation);
    setTransportFailure(false);
    startTransition(async () => {
      try {
        const result = await action({ taskIds });
        setState(result);
        if (result.status === 'success') {
          setSelected(new Set());
          router.refresh();
        }
      } catch {
        // Server Action 传输失败时无法知道事务是否已经提交，
        // 因此保留选择并要求先刷新核对，不盲目自动重试。
        setTransportFailure(true);
        setState({
          status: 'error',
          message: '未能确认提交结果',
        });
      }
    });
  }

  function prepareCompletionConfirmation() {
    if (pending) return;
    const previewTasks = tasks.filter(
      (task) =>
        selected.has(task.id) && task.status === TaskStatus.IN_PROGRESS,
    );
    const validationError = validateBatchCompletionPreview(previewTasks);
    if (validationError) {
      setOperation('report');
      setTransportFailure(false);
      setState({
        status: 'invalid',
        fieldErrors: { taskIds: [validationError] },
      });
      return;
    }

    setState(null);
    setTransportFailure(false);
    setCompletionPreview({
      tasks: previewTasks,
      excludedPendingCount: selectedPending.length,
    });
    setCompletionConfirmationOpen(true);
  }

  function confirmCompletion() {
    if (pending || !completionPreview) return;
    run(
      'report',
      reportTasksAction,
      completionPreview.tasks.map((task) => task.id),
    );
  }

  const visibleState = pending ? null : state;
  const errorMessage =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? Object.values(visibleState.fieldErrors).flat()[0] ??
          '请检查选中任务'
        : null;
  const completionImpactItems = completionPreview
    ? batchCompletionImpactItems({
        tasks: completionPreview.tasks,
        workerName,
        excludedPendingCount: completionPreview.excludedPendingCount,
      })
    : [];

  return (
    <div className="space-y-3" aria-busy={pending}>
      <section
        className="sticky top-0 z-10 space-y-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
        aria-label="批量处理任务"
        aria-busy={pending}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label
            className={cn(
              'flex min-h-11 items-center gap-1 pr-2 text-sm',
              pending ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            <BatchCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              disabled={pending}
              onChange={() =>
                !pending &&
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(tasks.map((task) => task.id)),
                )
              }
            />
            全选（已选 {selected.size}）
          </label>
          <Button
            type="button"
            disabled={pending || selectedPending.length === 0}
            aria-busy={pending && operation === 'begin'}
            onClick={() => run('begin', beginTasksAction, selectedPending)}
            className="min-h-11"
          >
            {pending && operation === 'begin'
              ? '正在开始…'
              : `一键开始 ${selectedPending.length || ''}`}
          </Button>
          <Button
            ref={completionTriggerRef}
            type="button"
            variant="secondary"
            disabled={pending || selectedInProgress.length === 0}
            aria-busy={pending && operation === 'report'}
            aria-haspopup="dialog"
            aria-expanded={completionConfirmationOpen}
            onClick={prepareCompletionConfirmation}
            className="min-h-11"
          >
            {pending && operation === 'report'
              ? '正在提交完工…'
              : `一键完工 ${selectedInProgress.length || ''}`}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          一键完工按每项计划数量报为合格数，不良/返工为 0；有异常数量时请进入任务单独报工。
        </p>
        <ConfirmActionDialog
          level="L2"
          open={completionConfirmationOpen}
          onOpenChange={setCompletionConfirmationOpen}
          focusReturnRef={completionTriggerRef}
          disabled={pending || completionPreview === null}
          title={`确认整批完工 ${completionPreview?.tasks.length ?? 0} 个任务？`}
          description="请逐项核对工单、工艺、计划数和计薪影响；提交时会再次检查任务状态。"
          impactItems={completionImpactItems}
          confirmLabel="确认整批完工"
          onConfirm={confirmCompletion}
        />
        {pending ? (
          <ActionNotice
            tone="info"
            title={
              operation === 'report'
                ? '正在提交整批完工'
                : '正在批量开始任务'
            }
            description="请不要重复提交，结果返回后会自动刷新任务列表。"
          />
        ) : null}
        {visibleState?.status === 'success' ? (
          <ActionNotice
            tone="success"
            title={
              operation === 'report'
                ? '整批完工成功'
                : '批量开始成功'
            }
            description={
              operation === 'report'
                ? `已完工 ${visibleState.taskIds.length} 个任务。`
                : `已开始 ${visibleState.taskIds.length} 个任务。`
            }
          />
        ) : null}
        {errorMessage ? (
          <ActionNotice
            tone="error"
            title={
              operation === 'report'
                ? '整批完工未确认'
                : '批量开始失败'
            }
            description={
              transportFailure
                ? `${errorMessage}。请刷新任务列表，避免重复报工。`
                : operation === 'report'
                  ? `${errorMessage}。提交失败，本批任务均未变更。`
                  : errorMessage
            }
            action={
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => router.refresh()}
              >
                刷新任务列表
              </Button>
            }
          />
        ) : null}
      </section>

      {taskGroups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`worker-task-group-${group.key}`}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <h2
              id={`worker-task-group-${group.key}`}
              className="text-sm font-semibold"
            >
              {group.label}
            </h2>
            <Badge variant={group.key === TaskStatus.IN_PROGRESS ? 'secondary' : 'outline'}>
              {group.rows.length}
            </Badge>
          </div>
          {group.rows.length > 0 ? (
            <ul className="space-y-2">
              {group.rows.map((task) => (
                <WorkerTaskRow
                  key={task.id}
                  task={task}
                  checked={selected.has(task.id)}
                  disabled={pending}
                  onToggle={() => toggle(task.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              暂无{group.label}任务
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function WorkerTaskRow({
  task,
  checked,
  disabled,
  onToggle,
}: {
  task: WorkerBatchTaskRow;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        'grid min-w-0 grid-cols-[44px_minmax(0,1fr)] rounded-xl border bg-card shadow-sm',
        task.order.isUrgent && 'border-destructive/50',
      )}
    >
      <label
        className={cn(
          'flex min-h-11 items-start justify-center py-2',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <BatchCheckbox
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          label={`选择 ${task.order.orderNo} ${externalPriceBusinessText(task.item.name)}`}
        />
      </label>
      <Link
        href={`/worker/tasks/${task.id}`}
        className="min-h-11 min-w-0 border-l p-4 transition hover:bg-muted/40"
      >
        <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="worker-wrap-anywhere min-w-0 font-sans tabular-nums text-sm">
                {task.order.orderNo}
              </span>
              {task.order.isUrgent ? (
                <UrgentBadge />
              ) : null}
              <ProductionTaskStatusBadge status={task.status} />
            </div>
            <div className="worker-wrap-anywhere text-sm font-medium">
              #{task.item.sequence} · {externalPriceBusinessText(task.item.name)}
            </div>
            {task.order.customName ? (
              <div className="worker-wrap-anywhere text-xs font-medium">
                {task.order.customName}
              </div>
            ) : null}
            <div className="worker-wrap-anywhere text-xs text-muted-foreground">
              {task.craft.name}
              {task.machineType
                ? ` · ${machineTypeLabel(task.machineType)}`
                : task.workerType === WorkerType.MACHINE
                  ? ' · 机型未配置'
                  : ' · 时薪任务'}
              {' · '}
              {task.item.isDoubleSided ? '双面' : '单面'} ·{' '}
              {task.item.isDoubleColor ? '双色' : '单色'}
            </div>
            <div className="worker-wrap-anywhere text-xs text-muted-foreground">
              接单人：{task.order.submitterName}
            </div>
            <div className="worker-wrap-anywhere text-xs text-muted-foreground">
              承诺交期：
              <span className="font-sans tabular-nums">
                {formatDateShanghai(task.order.promisedDate, '未设置')}
              </span>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-col items-end text-right">
            <div className="text-xs text-muted-foreground">计划</div>
            <div className="font-sans tabular-nums text-base">
              {task.plannedQty.toLocaleString()}
            </div>
            <span
              className={buttonVariants({
                size: 'sm',
                variant: task.order.isUrgent ? 'default' : 'outline',
                className: 'mt-3 min-h-12 min-w-24',
              })}
            >
              {task.status === TaskStatus.PENDING ? '开始生产' : '报工'}
            </span>
          </div>
        </div>
      </Link>
    </li>
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
