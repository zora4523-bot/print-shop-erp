'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { batchScheduleOrdersAction } from '@/actions/production';
import type { BatchScheduleOrdersActionResult } from '@/actions/production.types';
import type {
  PendingSchedulingOrderView,
  SchedulingViewCandidate,
} from '@/lib/production';
import { OrderKind } from '@/generated/prisma/enums';
import {
  machineTypeLabel,
  roleLabel,
  workerTypeLabel,
} from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';

const MAX_BATCH_ORDERS = 30;

type Props = {
  orders: PendingSchedulingOrderView[];
  workers: SchedulingViewCandidate[];
};

function SelectionCheckbox({
  checked,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none flex size-5 items-center justify-center rounded border border-input bg-background text-primary-foreground peer-disabled:opacity-40 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-checked:border-primary peer-checked:bg-primary"
      >
        <Check className={checked ? 'size-4' : 'size-4 opacity-0'} />
      </span>
    </span>
  );
}

export function PendingSchedulingBoard({ orders, workers }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [workerId, setWorkerId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [state, setState] =
    useState<BatchScheduleOrdersActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected.has(order.id)),
    [orders, selected],
  );
  const effectiveWorkerId = workers.some(
    (worker) => worker.id === workerId,
  )
    ? workerId
    : '';
  const selectableOrders = useMemo(
    () =>
      effectiveWorkerId
        ? orders.filter(
            (order) =>
              order.batchBlockReason === null &&
              (order.compatibleTaskCounts[effectiveWorkerId] ?? 0) > 0,
          )
        : [],
    [effectiveWorkerId, orders],
  );
  const selectedTaskCount = selectedOrders.reduce(
    (sum, order) =>
      sum + (order.compatibleTaskCounts[effectiveWorkerId] ?? 0),
    0,
  );
  const selectedRecommendedTaskCount = selectedOrders.reduce(
    (sum, order) =>
      sum + (order.recommendedTaskCounts[effectiveWorkerId] ?? 0),
    0,
  );
  const selectedOverrideTaskCount = selectedOrders.reduce(
    (sum, order) =>
      sum + (order.overrideTaskCounts[effectiveWorkerId] ?? 0),
    0,
  );
  const selectedQuantity = selectedOrders.reduce(
    (sum, order) => sum + order.totalQuantity,
    0,
  );
  const selectAllIds = selectableOrders
    .slice(0, MAX_BATCH_ORDERS)
    .map((order) => order.id);
  const allSelected =
    selectAllIds.length > 0 &&
    selectAllIds.every((orderId) => selected.has(orderId));

  function toggleOrder(orderId: string) {
    setState(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else if (next.size < MAX_BATCH_ORDERS) {
        next.add(orderId);
      }
      return next;
    });
  }

  function toggleAll() {
    setState(null);
    setSelected(allSelected ? new Set() : new Set(selectAllIds));
  }

  function changeWorker(nextWorkerId: string) {
    setState(null);
    setSelected(new Set());
    setWorkerId(nextWorkerId);
    setOverrideReason('');
  }

  function submitBatch() {
    if (selectedOrders.length === 0 || !effectiveWorkerId) return;
    setState(null);
    startTransition(async () => {
      const result = await batchScheduleOrdersAction({
        orderIds: selectedOrders.map((order) => order.id),
        workerId: effectiveWorkerId,
        overrideReason,
      });
      setState(result);
      if (result.status === 'success') {
        setSelected(new Set());
        router.refresh();
      } else if (result.status === 'partial') {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  const fieldError =
    state?.status === 'invalid'
      ? Object.values(state.fieldErrors).flat()[0]
      : null;
  const errorMessage = state?.status === 'error' ? state.message : fieldError;
  const normalizedWorkerSearch = workerSearch.trim().toLocaleLowerCase('zh-CN');
  const visibleWorkers = workers.filter(
    (worker) =>
      worker.id === effectiveWorkerId ||
      normalizedWorkerSearch.length === 0 ||
      worker.displayName
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedWorkerSearch) ||
      workerTypeLabel(worker.workerType).includes(workerSearch.trim()) ||
      worker.machineCapabilities.some((machine) =>
        machineTypeLabel(machine).includes(workerSearch.trim()),
      ),
  );

  return (
    <div className="space-y-4">
      <section
        className="space-y-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur lg:sticky lg:top-0 lg:z-10"
        aria-label="跨工单批量排产"
      >
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">按师傅兼容工艺批量排产</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              先选师傅，再勾选工单。已选 {selectedOrders.length} 张，本次将分配{' '}
              {selectedTaskCount} 个匹配任务，总数量{' '}
              {selectedQuantity.toLocaleString()}。其中推荐{' '}
              {selectedRecommendedTaskCount} 项，需说明{' '}
              {selectedOverrideTaskCount} 项。
            </p>
          </div>
          <div className="min-w-0 text-sm lg:min-w-72">
            <label htmlFor="batch-schedule-worker" className="font-medium">
              接单师傅
            </label>
            <input
              type="search"
              value={workerSearch}
              onChange={(event) => setWorkerSearch(event.target.value)}
              aria-label="搜索接单师傅"
              placeholder="按姓名、岗位或设备搜索"
              className="mt-1 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2"
            />
            <select
              id="batch-schedule-worker"
              value={effectiveWorkerId}
              onChange={(event) => changeWorker(event.target.value)}
              disabled={workers.length === 0}
              className="mt-2 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2"
            >
              <option value="">
                {workers.length === 0 ? '暂无可用师傅' : '先选择师傅'}
              </option>
              {visibleWorkers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.displayName} ·{' '}
                  {machineTypeLabel(worker.machineType) ||
                    workerTypeLabel(worker.workerType)}
                  {worker.machineCapabilities.length > 1
                    ? `（${worker.machineCapabilities
                        .map((machine) => machineTypeLabel(machine))
                        .join('/')}）`
                    : ''}
                  {' · '}在制{' '}
                  {worker.pendingTaskCount + worker.inProgressTaskCount}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            disabled={
              pending ||
              selectedOrders.length === 0 ||
              !effectiveWorkerId ||
              (selectedOverrideTaskCount > 0 &&
                overrideReason.trim().length === 0)
            }
            onClick={submitBatch}
            className="min-h-11"
          >
            {pending ? '正在分配…' : '确认分配所选工艺'}
          </Button>
        </div>
        {selectedOverrideTaskCount > 0 ? (
          <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <label
              htmlFor="batch-override-reason"
              className="text-sm font-medium text-warning-foreground"
            >
              非推荐派工原因（{selectedOverrideTaskCount} 项）
            </label>
            <textarea
              id="batch-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              maxLength={200}
              rows={2}
              placeholder="例如：临时支援，已确认本人可完成"
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              原因将写入每张工单的操作日志，最多 200 字。
            </p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          每张工单使用独立事务；只创建该师傅兼容的剩余任务。其他工艺继续留在待排产，全部分配完成后才会开放给师傅开工。单次最多 30 张。
        </p>
        {state?.status === 'success' ? (
          <p role="status" className="text-sm text-success-foreground">
            已为 {state.assigned.length} 张工单分配{' '}
            {state.assigned
              .reduce((sum, order) => sum + order.tasksCreated, 0)
              .toLocaleString()}{' '}
            个任务；其中{' '}
            {state.assigned.filter((order) => order.fullyScheduled).length}{' '}
            张已完成全部排产。
          </p>
        ) : null}
        {state?.status === 'partial' ? (
          <div role="alert" className="space-y-1 text-sm text-warning-foreground">
            <p>
              已为 {state.assigned.length} 张分配任务，另有{' '}
              {state.failed.length} 张未处理：
            </p>
            <ul className="list-disc pl-5">
              {state.failed.map((failure) => (
                <li key={failure.orderId}>
                  {failure.orderNo ??
                    orders.find((order) => order.id === failure.orderId)
                      ?.orderNo ??
                    failure.orderId}
                  ：{failure.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {state?.status === 'unauthorized' ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-destructive"
          >
            <p>{state.message}</p>
            <Link
              href="/login?from=/foreman/scheduling"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              重新登录
            </Link>
          </div>
        ) : errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </section>

      <div
        className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="待排产工单列表"
        tabIndex={0}
      >
        <table className="w-full min-w-[1160px] text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-14 px-2 py-1 text-center">
                <SelectionCheckbox
                  checked={allSelected}
                  disabled={!effectiveWorkerId || selectAllIds.length === 0}
                  onChange={toggleAll}
                  label="选择全部与当前师傅匹配的工单"
                />
              </th>
              <th className="px-3 py-2 text-left">工单</th>
              <th className="px-3 py-2 text-left">客户 / 提交人</th>
              <th className="px-3 py-2 text-left">款式 / 数量</th>
              <th className="min-w-72 px-3 py-2 text-left">工艺</th>
              <th className="px-3 py-2 text-left">交期 / 提交时间</th>
              <th className="px-3 py-2 text-left">批量状态</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map((order) => {
              const compatibleTaskCount = effectiveWorkerId
                ? (order.compatibleTaskCounts[effectiveWorkerId] ?? 0)
                : 0;
              const checkboxDisabled =
                !effectiveWorkerId ||
                order.batchBlockReason !== null ||
                compatibleTaskCount === 0 ||
                (selected.size >= MAX_BATCH_ORDERS &&
                  !selected.has(order.id));
              return (
              <tr key={order.id} className="align-top">
                <td className="px-2 py-2 text-center">
                  <SelectionCheckbox
                    checked={selected.has(order.id)}
                    disabled={checkboxDisabled}
                    onChange={() => toggleOrder(order.id)}
                    label={`选择工单 ${order.orderNo}`}
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex max-w-64 flex-wrap items-center gap-2">
                    <span className="font-sans tabular-nums text-foreground">
                      {order.orderNo}
                    </span>
                    {order.isUrgent ? (
                      <Badge variant="destructive">急单</Badge>
                    ) : null}
                    {order.kind === OrderKind.REWORK ? (
                      <Badge variant="outline">重做单</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 max-w-64 break-words font-medium">
                    {order.customName ?? '未命名工单'}
                  </p>
                  {order.sourceOrder ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      原单 {order.sourceOrder.orderNo}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <p className="max-w-48 break-words">
                    {order.customerRef ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.submitter.displayName}（
                    {roleLabel(order.submitter.role)}）
                  </p>
                </td>
                <td className="px-3 py-3 font-sans tabular-nums">
                  <p>{order.itemCount} 款</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.totalQuantity.toLocaleString()} 个 ·{' '}
                    {order.internalTaskCount} 个内部任务
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    已排 {order.assignedTaskCount} · 待排{' '}
                    {order.remainingTaskCount}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex max-w-96 flex-wrap gap-1.5">
                    {order.craftSummaries.map((craft) => (
                      <Badge
                        key={craft.id}
                        variant={craft.isOutsource ? 'secondary' : 'outline'}
                        className="h-auto max-w-full whitespace-normal break-all py-1 text-left"
                      >
                        {craft.name}
                        {craft.count > 1 ? ` ×${craft.count}` : ''}
                        {craft.assignedCount > 0
                          ? ` · 已排 ${craft.assignedCount}`
                          : ''}
                        {craft.isHybrid
                          ? ' · 外协+回厂'
                          : craft.isOutsource
                            ? ' · 外协'
                            : ''}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  <p>{formatDateShanghai(order.promisedDate, '未设置交期')}</p>
                  <p className="mt-1">
                    {formatDateShanghai(
                      order.submittedAt ?? order.createdAt,
                      '-',
                    )}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {order.batchBlockReason ? (
                    <p className="max-w-48 text-xs text-warning-foreground">
                      {order.batchBlockReason}
                    </p>
                  ) : !effectiveWorkerId ? (
                    <p className="max-w-48 text-xs text-muted-foreground">
                      剩余 {order.remainingTaskCount} 项，可由{' '}
                      {order.compatibleWorkerIds.length} 位师傅分步承接
                    </p>
                  ) : compatibleTaskCount > 0 ? (
                    <p className="max-w-48 text-xs text-success-foreground">
                      当前师傅可承接 {compatibleTaskCount} 项
                      {(order.overrideTaskCounts[effectiveWorkerId] ?? 0) > 0
                        ? `（其中 ${order.overrideTaskCounts[effectiveWorkerId]} 项需说明）`
                        : '（均为推荐项）'}
                      {compatibleTaskCount < order.remainingTaskCount
                        ? `，另 ${order.remainingTaskCount - compatibleTaskCount} 项待派`
                        : '，本次可完成排产'}
                    </p>
                  ) : (
                    <p className="max-w-48 text-xs text-muted-foreground">
                      当前师傅没有匹配的待排工艺
                    </p>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/foreman/scheduling/${order.id}`}
                    className={buttonVariants({
                      size: 'sm',
                      className: 'min-h-11',
                    })}
                  >
                    单独排产
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
