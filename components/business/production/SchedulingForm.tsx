'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { scheduleOrderAction } from '@/actions/production';
import type { ScheduleOrderResult } from '@/actions/production.types';
import type {
  SchedulingView,
  SchedulingViewCandidate,
} from '@/lib/production';
import type { MachineType } from '@/generated/prisma/enums';
import { WorkerType } from '@/generated/prisma/enums';
import { WORKER_TYPE_LABELS } from '@/lib/auth/role-labels';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { formatFoilColors } from '@/lib/order/foil-colors';

type Props = {
  view: SchedulingView;
  machineTypeLabels: Record<string, string>;
};

type RowKey = `${string}:${string}`;

export function SchedulingForm({ view, machineTypeLabels }: Props) {
  // State: which worker is assigned to which (itemId, craftId) pair.
  // Initially empty — foreman must pick every worker explicitly.
  const [assignments, setAssignments] = useState<Record<RowKey, string>>({});

  const [state, action] = useActionState<ScheduleOrderResult | null, unknown>(
    scheduleOrderAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Redirect to the order detail once scheduling succeeds. Revalidation
  // happens server-side; this just navigates the UI.
  useEffect(() => {
    if (state?.status === 'success') {
      router.push(`/orders/${state.orderId}`);
    }
  }, [state, router]);

  // All (itemId, craftId) pairs that need an assignment — non-outsource
  // crafts only. Outsource rows render but are disabled.
  const rows = useMemo(() => {
    const out: Array<{
      itemId: string;
      itemSequence: number;
      itemName: string;
      itemQuantity: number;
      itemFoilColors: string[];
      craftId: string;
      craftName: string;
      isOutsource: boolean;
      recommendedMachine: MachineType | null;
      requiredWorkerType: WorkerType | null;
      itemRemark: string | null;
    }> = [];
    for (const item of view.items) {
      for (const craft of item.crafts) {
        out.push({
          itemId: item.id,
          itemSequence: item.sequence,
          itemName: item.name,
          itemQuantity: item.quantity,
          itemFoilColors: item.foilColors,
          craftId: craft.id,
          craftName: craft.name,
          isOutsource: craft.isOutsource,
          requiredWorkerType: craft.defaultWorkerType,
          recommendedMachine: craft.defaultMachineType,
          itemRemark: item.remark,
        });
      }
    }
    return out;
  }, [view.items]);

  const nonOutsourceRows = rows.filter((r) => !r.isOutsource);
  const assignmentIndexByKey = new Map(
    nonOutsourceRows.map((row, index) => [rowKey(row.itemId, row.craftId), index]),
  );
  const allAssigned = nonOutsourceRows.every(
    (r) => assignments[rowKey(r.itemId, r.craftId)],
  );
  const missingWorkers = nonOutsourceRows.some(
    (row) => eligibleWorkers(view.workers, row).length === 0,
  );

  function handleSubmit() {
    const payload = {
      orderId: view.orderId,
      assignments: nonOutsourceRows.map((r) => ({
        orderItemId: r.itemId,
        craftId: r.craftId,
        workerId: assignments[rowKey(r.itemId, r.craftId)]!,
      })),
    };
    startTransition(() => action(payload));
  }

  return (
    <div className="space-y-6">
      <div
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="工艺派工表"
        tabIndex={0}
      >
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <th className="border-b px-3 py-2 text-left">款式</th>
            <th className="border-b px-3 py-2 text-left">工艺</th>
            <th className="border-b px-3 py-2 text-left">所需岗位 / 机型</th>
            <th className="border-b px-3 py-2 text-left">派工</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const key = rowKey(r.itemId, r.craftId);
            const assignmentIndex = assignmentIndexByKey.get(key);
            const err = fieldError(state, assignmentIndex);
            const candidates = eligibleWorkers(view.workers, r);
            return (
              <tr key={key} className="align-top">
                <td className="px-3 py-2">
                  <div>
                    #{r.itemSequence} · {r.itemName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    数量 {r.itemQuantity}
                  </div>
                  {r.itemFoilColors.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      烫金色：{formatFoilColors(r.itemFoilColors)}
                    </div>
                  ) : null}
                  {r.itemRemark ? (
                    <HighlightedRemark className="mt-1 text-xs">
                      {r.itemRemark}
                    </HighlightedRemark>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.craftName}</td>
                <td className="px-3 py-2">
                  {r.isOutsource ? (
                    <span className="text-xs text-warning-foreground">外协</span>
                  ) : r.requiredWorkerType ? (
                    <span className="text-xs">
                      {WORKER_TYPE_LABELS[r.requiredWorkerType] ?? r.requiredWorkerType}
                      {r.recommendedMachine
                        ? ` · ${machineTypeLabels[r.recommendedMachine] ?? r.recommendedMachine}`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.isOutsource ? (
                    <span className="text-xs text-muted-foreground">
                      外协单另行处理
                    </span>
                  ) : (
                    <WorkerSelect
                      workers={candidates}
                      machineTypeLabels={machineTypeLabels}
                      recommendedMachine={r.recommendedMachine}
                      value={assignments[key] ?? ''}
                      onChange={(wid) =>
                        setAssignments((prev) => ({ ...prev, [key]: wid }))
                      }
                      invalid={err.length > 0}
                    />
                  )}
                  {!r.isOutsource && candidates.length === 0 ? (
                    <p className="mt-1 text-xs text-destructive">
                      没有岗位与机型匹配的启用师傅
                    </p>
                  ) : null}
                  {err.length > 0 ? (
                    <p className="mt-1 text-xs text-destructive">{err[0]}</p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {rows.some((row) => row.isOutsource) ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          该工单包含外协工艺。确认排产前必须先创建外协单，外协收货会与内部任务共同决定工单是否完工。
          <Link
            href={`/foreman/outsource/new?orderId=${view.orderId}`}
            className="ml-2 font-medium text-primary underline"
          >
            创建外协单
          </Link>
        </div>
      ) : null}

      {missingWorkers ? (
        <p role="alert" className="text-sm text-warning-foreground">
          存在没有匹配师傅的工艺；请先在账号管理中启用对应岗位和机型的师傅。
        </p>
      ) : null}

      {state?.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <div role="alert" className="text-sm text-destructive">
          排产数据校验失败：{firstValidationMessage(state.fieldErrors)}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSubmit} disabled={pending || !allAssigned}>
          {pending ? '排产中…' : '确认排产'}
        </Button>
        <Link
          href={`/orders/${view.orderId}`}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回工单详情
        </Link>
        {!allAssigned ? (
          <span className="text-xs text-muted-foreground">
            剩 {nonOutsourceRows.length - nonOutsourceRows.filter((r) => assignments[rowKey(r.itemId, r.craftId)]).length} 项待派
          </span>
        ) : null}
      </div>
    </div>
  );
}

function rowKey(itemId: string, craftId: string): RowKey {
  return `${itemId}:${craftId}`;
}

function fieldError(
  state: ScheduleOrderResult | null,
  assignmentIndex: number | undefined,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  if (assignmentIndex === undefined) return [];
  return state.fieldErrors[`assignments.${assignmentIndex}.workerId`] ?? [];
}

function firstValidationMessage(errors: Record<string, string[]>): string {
  return Object.values(errors).flat()[0] ?? '请检查每一项派工。';
}

function eligibleWorkers(
  workers: SchedulingViewCandidate[],
  row: { requiredWorkerType: WorkerType | null; recommendedMachine: MachineType | null },
) {
  return workers.filter(
    (worker) =>
      worker.workerType === row.requiredWorkerType &&
      (row.requiredWorkerType !== WorkerType.MACHINE ||
        worker.machineType === row.recommendedMachine),
  );
}

function WorkerSelect({
  workers,
  machineTypeLabels,
  recommendedMachine,
  value,
  onChange,
  invalid,
}: {
  workers: SchedulingViewCandidate[];
  machineTypeLabels: Record<string, string>;
  recommendedMachine: MachineType | null;
  value: string;
  onChange: (workerId: string) => void;
  invalid: boolean;
}) {
  // Sort by "recommended machine match first, then everyone else" so
  // the default option is the most sensible worker.
  const sorted = [...workers].sort((a, b) => {
    const am = a.machineType === recommendedMachine ? 0 : 1;
    const bm = b.machineType === recommendedMachine ? 0 : 1;
    return am - bm;
  });
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
        invalid ? 'border-destructive' : ''
      }`}
    >
      <option value="">选择师傅…</option>
      {sorted.map((w) => {
        const match = w.machineType === recommendedMachine;
        const job = w.workerType ? WORKER_TYPE_LABELS[w.workerType] : '未配岗';
        const machine = w.machineType
          ? ` · ${machineTypeLabels[w.machineType] ?? w.machineType}`
          : '';
        const tag = `（${job}${machine}${match ? '，匹配' : ''}；待办 ${w.pendingTaskCount} / 进行中 ${w.inProgressTaskCount}）`;
        return (
          <option key={w.id} value={w.id}>
            {w.displayName}
            {tag}
          </option>
        );
      })}
    </select>
  );
}
