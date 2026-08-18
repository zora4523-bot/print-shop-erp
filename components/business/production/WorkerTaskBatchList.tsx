'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Check, Minus } from 'lucide-react';
import { beginTasksAction, reportTasksAction } from '@/actions/production';
import type { BatchTaskMutationResult } from '@/actions/production.types';
import {
  MachineType,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/enums';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type TaskRow = {
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
    submitterName: string;
  };
};

function BatchCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  // 只用于表头「全选」：部分选中时置原生 indeterminate，读屏器据此
  // 播报 “mixed”。不额外写 aria-checked——原生 checkbox 上手写会和
  // 原生状态打架。
  indeterminate?: boolean;
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
        onChange={onChange}
        aria-label={label}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none flex size-5 items-center justify-center rounded border border-input bg-background text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-checked:border-primary peer-checked:bg-primary peer-indeterminate:border-primary peer-indeterminate:bg-primary"
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

export function WorkerTaskBatchList({ tasks }: { tasks: TaskRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<BatchTaskMutationResult | null>(null);
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
  // tasks.length > 0 是必要的：空列表时 0 === 0 会让表头框显示已勾选。
  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(taskId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function run(
    action: (raw: unknown) => Promise<BatchTaskMutationResult>,
    taskIds: string[],
  ) {
    if (taskIds.length === 0) return;
    setState(null);
    startTransition(async () => {
      const result = await action({ taskIds });
      setState(result);
      if (result.status === 'success') {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  const message =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : state?.status === 'success'
          ? `已处理 ${state.taskIds.length} 个任务`
          : null;

  return (
    <div className="space-y-3">
      <section
        className="sticky top-0 z-10 space-y-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
        aria-label="批量处理任务"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-1 pr-2 text-sm">
            <BatchCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={() =>
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
            onClick={() => run(beginTasksAction, selectedPending)}
            className="min-h-11"
          >
            一键开始 {selectedPending.length || ''}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || selectedInProgress.length === 0}
            onClick={() => run(reportTasksAction, selectedInProgress)}
            className="min-h-11"
          >
            一键完工 {selectedInProgress.length || ''}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          一键完工按每项计划数量报为合格数，不良/返工为 0；有异常数量时请进入任务单独报工。
        </p>
        {message ? (
          <p
            role={state?.status === 'success' ? 'status' : 'alert'}
            className={
              state?.status === 'success'
                ? 'text-sm text-success-foreground'
                : 'text-sm text-destructive'
            }
          >
            {message}
          </p>
        ) : null}
      </section>

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] rounded-xl border bg-card shadow-sm"
          >
            <label className="flex min-h-11 cursor-pointer items-start justify-center py-2">
              <BatchCheckbox
                checked={selected.has(task.id)}
                onChange={() => toggle(task.id)}
                label={`选择 ${task.order.orderNo} ${task.item.name}`}
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
                      <Badge
                        variant="destructive"
                        className="bg-destructive text-background dark:bg-destructive dark:text-background"
                      >
                        急单
                      </Badge>
                    ) : null}
                    <Badge
                      variant={
                        task.status === TaskStatus.IN_PROGRESS
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {task.status === TaskStatus.IN_PROGRESS
                        ? '进行中'
                        : '待开始'}
                    </Badge>
                  </div>
                  <div className="worker-wrap-anywhere text-sm font-medium">
                    #{task.item.sequence} · {task.item.name}
                  </div>
                  {task.order.customName ? (
                    <div className="worker-wrap-anywhere text-xs font-medium">
                      {task.order.customName}
                    </div>
                  ) : null}
                  <div className="worker-wrap-anywhere text-xs text-muted-foreground">
                    {task.craft.name}
                    {task.machineType
                      ? ` · ${MACHINE_TYPE_LABELS[task.machineType] ?? task.machineType}`
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
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <div className="text-xs text-muted-foreground">计划</div>
                  <div className="font-sans tabular-nums text-base">
                    {task.plannedQty.toLocaleString()}
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
