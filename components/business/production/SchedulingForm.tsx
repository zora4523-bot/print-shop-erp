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
import { DisabledReason } from '@/components/ui-business';

type Props = {
  view: SchedulingView;
  machineTypeLabels: Record<string, string>;
};

type RowKey = `${string}:${string}`;

export function SchedulingForm({ view, machineTypeLabels }: Props) {
  // State: which worker is assigned to which (itemId, craftId) pair.
  // Cross-order batch scheduling may already have staged some PENDING tasks.
  // Prefill those assignments so the single-order form can finish or correct
  // the remaining rows before the order enters SCHEDULING.
  const [assignments, setAssignments] = useState<Record<RowKey, string>>(
    () => {
      const staged: Record<RowKey, string> = {};
      for (const item of view.items) {
        for (const craft of item.crafts) {
          if (craft.assignedWorkerId) {
            staged[rowKey(item.id, craft.id)] = craft.assignedWorkerId;
          }
        }
      }
      return staged;
    },
  );
  const [selectedRows, setSelectedRows] = useState<Set<RowKey>>(
    () => new Set(),
  );
  const [bulkWorkerId, setBulkWorkerId] = useState('');
  const [overrideReasons, setOverrideReasons] = useState<
    Record<RowKey, string>
  >({});

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
      inHouseMachineTypes: MachineType[];
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
          inHouseMachineTypes: craft.inHouseMachineTypes,
          requiredWorkerType: craft.defaultWorkerType,
          recommendedMachine: craft.defaultMachineType,
          itemRemark: item.remark,
        });
      }
    }
    return out;
  }, [view.items]);

  const nonOutsourceRows = rows.filter(
    (row) => !row.isOutsource || row.inHouseMachineTypes.length > 0,
  );
  const assignmentIndexByKey = new Map(
    nonOutsourceRows.map((row, index) => [rowKey(row.itemId, row.craftId), index]),
  );
  const allAssigned = nonOutsourceRows.every(
    (r) => assignments[rowKey(r.itemId, r.craftId)],
  );
  const overrideRows = nonOutsourceRows.filter((row) => {
    const worker = view.workers.find(
      (candidate) =>
        candidate.id === assignments[rowKey(row.itemId, row.craftId)],
    );
    return worker ? !isWorkerRecommended(worker, row.craftId) : false;
  });
  const allOverridesExplained = overrideRows.every(
    (row) =>
      (overrideReasons[rowKey(row.itemId, row.craftId)] ?? '').trim().length >
      0,
  );
  const missingWorkers = nonOutsourceRows.some(
    (row) => eligibleWorkers(view.workers, row).length === 0,
  );
  const selectedNonOutsourceRows = nonOutsourceRows.filter((row) =>
    selectedRows.has(rowKey(row.itemId, row.craftId)),
  );
  const commonWorkers = view.workers.filter((worker) =>
    selectedNonOutsourceRows.every((row) =>
      eligibleWorkers(view.workers, row).some(
        (candidate) => candidate.id === worker.id,
      ),
    ),
  );
  const effectiveBulkWorkerId = commonWorkers.some(
    (worker) => worker.id === bulkWorkerId,
  )
    ? bulkWorkerId
    : '';
  const allRowsSelected =
    nonOutsourceRows.length > 0 &&
    selectedRows.size === nonOutsourceRows.length;

  function toggleRow(key: RowKey) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllRows() {
    setSelectedRows(
      allRowsSelected
        ? new Set()
        : new Set(
            nonOutsourceRows.map((row) =>
              rowKey(row.itemId, row.craftId),
            ),
          ),
    );
  }

  function applyBulkWorker() {
    if (!effectiveBulkWorkerId || selectedRows.size === 0) return;
    setAssignments((current) => {
      const next = { ...current };
      for (const key of selectedRows) next[key] = effectiveBulkWorkerId;
      return next;
    });
  }

  function handleSubmit() {
    const payload = {
      orderId: view.orderId,
      assignments: nonOutsourceRows.map((r) => ({
        orderItemId: r.itemId,
        craftId: r.craftId,
        workerId: assignments[rowKey(r.itemId, r.craftId)]!,
        overrideReason:
          overrideReasons[rowKey(r.itemId, r.craftId)] ?? '',
      })),
    };
    startTransition(() => action(payload));
  }

  return (
    <div className="space-y-6">
      <section
        className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-end"
        aria-label="批量派工"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="bulk-worker" className="text-sm font-medium">
            批量派给同一位师傅
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            已选 {selectedRows.size} 项；可分配范围由岗位和设备决定，熟练工艺师傅优先显示。
          </p>
        </div>
        <select
          id="bulk-worker"
          value={effectiveBulkWorkerId}
          onChange={(event) => setBulkWorkerId(event.target.value)}
          disabled={selectedRows.size === 0}
          className="min-h-11 min-w-0 rounded-md border bg-background px-3 py-2 text-sm sm:min-w-64"
        >
          <option value="">
            {selectedRows.size === 0
              ? '请先勾选工艺'
              : commonWorkers.length === 0
                ? '没有共同匹配的师傅'
                : '选择师傅'}
          </option>
          {commonWorkers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.displayName}
              {worker.pendingTaskCount + worker.inProgressTaskCount > 0
                ? ` · 在制 ${
                    worker.pendingTaskCount + worker.inProgressTaskCount
                  }`
                : ''}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!effectiveBulkWorkerId || selectedRows.size === 0}
          onClick={applyBulkWorker}
        >
          应用到已选
        </Button>
      </section>

      <div
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="工艺派工表"
        tabIndex={0}
      >
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <th className="w-12 border-b px-3 py-2 text-left">
              <label className="flex min-h-11 items-center justify-center">
                <input
                  type="checkbox"
                  checked={allRowsSelected}
                  onChange={toggleAllRows}
                  aria-label="选择全部内部工艺"
                  className="h-4 w-4"
                />
              </label>
            </th>
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
            const requiresInternalAssignment =
              !r.isOutsource || r.inHouseMachineTypes.length > 0;
            return (
              <tr key={key} className="align-top">
                <td className="px-3 py-2">
                  <label className="flex min-h-11 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(key)}
                      disabled={!requiresInternalAssignment}
                      onChange={() => toggleRow(key)}
                      aria-label={`选择 #${r.itemSequence} ${r.itemName} · ${r.craftName}`}
                      className="h-4 w-4"
                    />
                  </label>
                </td>
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
                  {r.isOutsource && r.inHouseMachineTypes.length === 0 ? (
                    <span className="text-xs text-warning-foreground">
                      仅外协
                    </span>
                  ) : r.requiredWorkerType ? (
                    <div className="space-y-1 text-xs">
                      {r.isOutsource ? (
                        <span className="block text-warning-foreground">
                          外协彩印 + 回厂烫金
                        </span>
                      ) : null}
                      <span>
                        {WORKER_TYPE_LABELS[r.requiredWorkerType] ??
                          r.requiredWorkerType}
                        {r.inHouseMachineTypes.length > 0
                          ? ` · ${r.inHouseMachineTypes
                              .map(
                                (machine) =>
                                  machineTypeLabels[machine] ?? machine,
                              )
                              .join(' / ')}`
                          : r.recommendedMachine
                            ? ` · ${machineTypeLabels[r.recommendedMachine] ?? r.recommendedMachine}`
                            : ''}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {!requiresInternalAssignment ? (
                    <span className="text-xs text-muted-foreground">
                      外协单另行处理
                    </span>
                  ) : (
                    <WorkerSelect
                      workers={candidates}
                      craftId={r.craftId}
                      machineTypeLabels={machineTypeLabels}
                      recommendedMachine={r.recommendedMachine}
                      label={`为 #${r.itemSequence} ${r.itemName} · ${r.craftName} 选择师傅`}
                      value={assignments[key] ?? ''}
                      onChange={(wid) => {
                        setAssignments((prev) => ({ ...prev, [key]: wid }));
                        setOverrideReasons((prev) => ({
                          ...prev,
                          [key]: '',
                        }));
                      }}
                      invalid={err.length > 0}
                      errorId={`worker-${key}-error`}
                    />
                  )}
                  {requiresInternalAssignment && candidates.length === 0 ? (
                    <p className="mt-1 text-xs text-destructive">
                      没有岗位与机型匹配的启用师傅
                    </p>
                  ) : null}
                  {requiresInternalAssignment &&
                  assignments[key] &&
                  !isWorkerRecommended(
                    view.workers.find(
                      (worker) => worker.id === assignments[key],
                    ),
                    r.craftId,
                  ) ? (
                    <div className="mt-2 space-y-1">
                      <label
                        htmlFor={`override-${assignmentIndex ?? key}`}
                        className="text-xs font-medium text-warning-foreground"
                      >
                        非推荐派工原因
                      </label>
                      <textarea
                        id={`override-${assignmentIndex ?? key}`}
                        value={overrideReasons[key] ?? ''}
                        onChange={(event) =>
                          setOverrideReasons((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        maxLength={200}
                        rows={2}
                        placeholder="例如：临时支援，已确认本人可完成"
                        aria-describedby={`override-hint-${assignmentIndex ?? key}`}
                        className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
                      />
                      <p
                        id={`override-hint-${assignmentIndex ?? key}`}
                        className="text-xs text-muted-foreground"
                      >
                        将写入工单操作日志，最多 200 字。
                      </p>
                    </div>
                  ) : null}
                  {err.length > 0 ? (
                    <p
                      id={`worker-${key}-error`}
                      className="mt-1 text-xs text-destructive"
                    >
                      {err[0]}
                    </p>
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
          该工单包含外协工艺。彩印+烫金会同时创建回厂烫金任务，可选择风车机或机仔师傅；确认排产前仍须创建彩印外协单。
          <Link
            href={`/foreman/outsource/new?orderId=${view.orderId}`}
            className="ml-2 font-medium text-primary underline"
          >
            创建外协单
          </Link>
        </div>
      ) : null}

      {missingWorkers ? (
        <DisabledReason
          cause="prerequisite"
          reason="存在没有匹配师傅的工艺；请先在账号管理中启用对应岗位和机型的师傅。"
        />
      ) : null}
      {overrideRows.length > 0 && !allOverridesExplained ? (
        <p role="alert" className="text-sm text-warning-foreground">
          有 {overrideRows.length} 项选择了未登记该熟练工艺的师傅，请逐项填写派工原因。
        </p>
      ) : null}

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <div role="alert" className="text-sm text-destructive">
          排产数据校验失败：{firstValidationMessage(state.fieldErrors)}
        </div>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={pending || !allAssigned || !allOverridesExplained}
          className="min-h-11"
        >
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
  row: {
    requiredWorkerType: WorkerType | null;
    recommendedMachine: MachineType | null;
    inHouseMachineTypes: MachineType[];
  },
) {
  return workers.filter(
    (worker) =>
      worker.workerType === row.requiredWorkerType &&
      (row.requiredWorkerType !== WorkerType.MACHINE ||
        (row.inHouseMachineTypes.length > 0
          ? worker.machineCapabilities.some((machine) =>
              row.inHouseMachineTypes.includes(machine),
            )
          : Boolean(
              row.recommendedMachine &&
                worker.machineCapabilities.includes(row.recommendedMachine),
            ))),
  );
}

function isWorkerRecommended(
  worker: SchedulingViewCandidate | undefined,
  craftId: string,
): boolean {
  return Boolean(worker?.craftCapabilityIds.includes(craftId));
}

function WorkerSelect({
  workers,
  craftId,
  machineTypeLabels,
  recommendedMachine,
  label,
  value,
  onChange,
  invalid,
  errorId,
}: {
  workers: SchedulingViewCandidate[];
  craftId: string;
  machineTypeLabels: Record<string, string>;
  recommendedMachine: MachineType | null;
  label: string;
  value: string;
  onChange: (workerId: string) => void;
  invalid: boolean;
  // 逐行错误文案的 id：invalid 此前只改边框颜色，读屏器完全感知不到
  // 这一行有问题，也读不到原因。
  errorId?: string;
}) {
  const [search, setSearch] = useState('');
  // Sort by "recommended machine match first, then everyone else" so
  // the default option is the most sensible worker.
  const sorted = [...workers].sort((a, b) => {
    const ar = isWorkerRecommended(a, craftId) ? 0 : 1;
    const br = isWorkerRecommended(b, craftId) ? 0 : 1;
    if (ar !== br) return ar - br;
    const am = a.machineType === recommendedMachine ? 0 : 1;
    const bm = b.machineType === recommendedMachine ? 0 : 1;
    return am - bm;
  });
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const filtered = sorted.filter(
    (worker) =>
      worker.id === value ||
      normalizedSearch.length === 0 ||
      worker.displayName.toLocaleLowerCase('zh-CN').includes(normalizedSearch) ||
      WORKER_TYPE_LABELS[
        worker.workerType ?? WorkerType.MACHINE
      ]?.includes(search.trim()),
  );
  return (
    <div className="space-y-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={`搜索${label}`}
        placeholder="搜索师傅姓名"
        className="min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid && errorId ? errorId : undefined}
        className="grid gap-2 sm:grid-cols-2"
      >
        {filtered.map((worker) => {
          const recommendedWorker = isWorkerRecommended(worker, craftId);
          const selected = worker.id === value;
          const load = worker.pendingTaskCount + worker.inProgressTaskCount;
          return (
            <Button
              key={worker.id}
              type="button"
              role="radio"
              aria-checked={selected}
              variant="outline"
              onClick={() => onChange(worker.id)}
              className={`h-auto min-h-11 justify-start whitespace-normal rounded-lg px-3 py-2 text-left text-sm ${
                selected
                  ? 'border-primary bg-primary/5'
                  : recommendedWorker
                    ? 'border-border bg-background'
                    : 'border-warning/40 bg-warning/5'
              }`}
            >
              <span className="block font-medium">{worker.displayName}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {WORKER_TYPE_LABELS[worker.workerType ?? WorkerType.MACHINE]}
                {worker.machineType
                  ? ` · ${machineTypeLabels[worker.machineType] ?? worker.machineType}`
                  : ''}
                {` · 在制 ${load}`}
                {recommendedWorker ? ' · 推荐' : ' · 需说明'}
              </span>
            </Button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">没有符合搜索的师傅</p>
      ) : null}
    </div>
  );
}
