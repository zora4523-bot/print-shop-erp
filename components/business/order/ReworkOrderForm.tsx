'use client';

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createReworkOrderAction } from '@/actions/order';
import type { CreateReworkOrderMutationResult } from '@/actions/order.types';
import { ReworkCause } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
};

type ReworkItemOption = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  crafts: CraftOption[];
};

type Props = {
  sourceOrderId: string;
  items: ReworkItemOption[];
};

const REWORK_CAUSE_LABELS: Record<ReworkCause, string> = {
  [ReworkCause.QUALITY]: '质量问题',
  [ReworkCause.LOGISTICS_DAMAGE]: '物流损毁',
  [ReworkCause.OTHER]: '其他原因',
};

export function ReworkOrderForm({ sourceOrderId, items }: Props) {
  const router = useRouter();
  const [state, action] = useActionState<
    CreateReworkOrderMutationResult | null,
    unknown
  >(createReworkOrderAction, null);
  const [pending, startTransition] = useTransition();
  const [cause, setCause] = useState<ReworkCause>(ReworkCause.QUALITY);
  const [reason, setReason] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(
    () => new Set(),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.quantity])),
  );
  const [selectedCrafts, setSelectedCrafts] = useState<
    Record<string, Set<string>>
  >(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        new Set(item.crafts.map((craft) => craft.id)),
      ]),
    ),
  );

  useEffect(() => {
    if (state?.status === 'success') {
      router.push(`/orders/${state.orderId}`);
    }
  }, [router, state]);

  const selectedCount = selectedItems.size;
  const canSubmit = useMemo(
    () =>
      selectedCount > 0 &&
      reason.trim().length > 0 &&
      [...selectedItems].every(
        (itemId) =>
          (quantities[itemId] ?? 0) > 0 &&
          (selectedCrafts[itemId]?.size ?? 0) > 0,
      ),
    [quantities, reason, selectedCrafts, selectedCount, selectedItems],
  );

  function toggleItem(itemId: string) {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleCraft(itemId: string, craftId: string) {
    setSelectedCrafts((current) => {
      const nextForItem = new Set(current[itemId] ?? []);
      if (nextForItem.has(craftId)) nextForItem.delete(craftId);
      else nextForItem.add(craftId);
      return { ...current, [itemId]: nextForItem };
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const payload = {
      sourceOrderId,
      cause,
      reason,
      items: items
        .filter((item) => selectedItems.has(item.id))
        .map((item) => ({
          sourceOrderItemId: item.id,
          quantity: quantities[item.id],
          craftIds: [...(selectedCrafts[item.id] ?? [])],
        })),
    };
    startTransition(() => action(payload));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">重做原因类型</span>
          <select
            value={cause}
            onChange={(event) => setCause(event.target.value as ReworkCause)}
            className="min-h-11 w-full rounded-md border bg-background px-3 py-2"
          >
            {Object.entries(REWORK_CAUSE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">详细原因</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            required
            className="w-full rounded-md border bg-background px-3 py-2"
            placeholder="例如：运输途中受潮，重做第 1 款 500 个"
          />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          选择重做款式、数量和工艺
        </legend>
        <ol className="space-y-3">
          {items.map((item) => {
            const selected = selectedItems.has(item.id);
            return (
              <li key={item.id} className="min-w-0 rounded-lg border p-3">
                <label className="flex min-h-11 min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleItem(item.id)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="admin-wrap-anywhere min-w-0 font-medium">
                    #{item.sequence} · {item.name}
                  </span>
                </label>
                {selected ? (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <label className="block max-w-56 space-y-1 text-sm">
                      <span>重做数量（原数量 {item.quantity}）</span>
                      <Input
                        type="number"
                        min={1}
                        max={item.quantity}
                        step={1}
                        value={quantities[item.id] ?? item.quantity}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <fieldset>
                      <legend className="text-xs font-medium text-muted-foreground">
                        重做工艺
                      </legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.crafts.map((craft) => (
                          <label
                            key={craft.id}
                            className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={
                                selectedCrafts[item.id]?.has(craft.id) ?? false
                              }
                              onChange={() => toggleCraft(item.id, craft.id)}
                              className="h-4 w-4"
                            />
                            <span>
                              {craft.name}
                              {craft.isOutsource ? '（外协）' : ''}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </fieldset>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p role="alert" className="text-sm text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? '创建中…' : `创建重做单（${selectedCount} 款）`}
        </Button>
        <span className="text-xs text-muted-foreground">
          重做单不计客户应收，但生产任务仍正常记录师傅工资。
        </span>
      </div>
    </form>
  );
}
