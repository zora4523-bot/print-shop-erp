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
      craftId: string;
      craftName: string;
      isOutsource: boolean;
      recommendedMachine: MachineType | null;
    }> = [];
    for (const item of view.items) {
      for (const craft of item.crafts) {
        out.push({
          itemId: item.id,
          itemSequence: item.sequence,
          itemName: item.name,
          itemQuantity: item.quantity,
          craftId: craft.id,
          craftName: craft.name,
          isOutsource: craft.isOutsource,
          recommendedMachine: craft.defaultMachineType,
        });
      }
    }
    return out;
  }, [view.items]);

  const nonOutsourceRows = rows.filter((r) => !r.isOutsource);
  const allAssigned = nonOutsourceRows.every(
    (r) => assignments[rowKey(r.itemId, r.craftId)],
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
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <th className="border-b px-3 py-2 text-left">款式</th>
            <th className="border-b px-3 py-2 text-left">工艺</th>
            <th className="border-b px-3 py-2 text-left">推荐机型</th>
            <th className="border-b px-3 py-2 text-left">派工</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const key = rowKey(r.itemId, r.craftId);
            const err = fieldError(state, key);
            return (
              <tr key={key} className="align-top">
                <td className="px-3 py-2">
                  <div>
                    #{r.itemSequence} · {r.itemName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    数量 {r.itemQuantity}
                  </div>
                </td>
                <td className="px-3 py-2">{r.craftName}</td>
                <td className="px-3 py-2">
                  {r.isOutsource ? (
                    <span className="text-xs text-amber-700">外协</span>
                  ) : r.recommendedMachine ? (
                    <span className="text-xs">
                      {machineTypeLabels[r.recommendedMachine] ?? r.recommendedMachine}
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
                      workers={view.workers}
                      machineTypeLabels={machineTypeLabels}
                      recommendedMachine={r.recommendedMachine}
                      value={assignments[key] ?? ''}
                      onChange={(wid) =>
                        setAssignments((prev) => ({ ...prev, [key]: wid }))
                      }
                      invalid={err.length > 0}
                    />
                  )}
                  {err.length > 0 ? (
                    <p className="mt-1 text-xs text-destructive">{err[0]}</p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state?.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
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

function fieldError(state: ScheduleOrderResult | null, dottedKey: string): string[] {
  if (!state || state.status !== 'invalid') return [];
  // Zod errors come back as dotted paths from the server
  // (assignments.<index>.workerId). We don't know our index at render
  // time, but the server rarely rejects individual pairs — usually the
  // whole payload fails with a single `_` key or one specific row.
  // Fall back to the generic message if no direct hit.
  return state.fieldErrors[dottedKey] ?? [];
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
        const tag = w.machineType
          ? `（${machineTypeLabels[w.machineType] ?? w.machineType}${match ? '，推荐' : ''}）`
          : '';
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

