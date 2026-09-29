'use client';

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createReworkOrderAction } from '@/actions/order';
import type { CreateReworkOrderMutationResult } from '@/actions/order.types';
import { ReworkCause } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

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
  requiresUnitsPerBagInput?: boolean;
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

const MAX_UNITS_PER_BAG = 9_999_999;

function parsedUnitsPerBag(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_UNITS_PER_BAG
    ? parsed
    : undefined;
}

export function ReworkOrderForm({ sourceOrderId, items }: Props) {
  const router = useRouter();
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const [state, action] = useActionState<
    CreateReworkOrderMutationResult | null,
    unknown
  >(createReworkOrderAction, null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const [unitsPerBag, setUnitsPerBag] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, ''])),
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
        (itemId) => {
          const item = items.find((candidate) => candidate.id === itemId);
          return (
            (quantities[itemId] ?? 0) > 0 &&
            (!item?.requiresUnitsPerBagInput ||
              parsedUnitsPerBag(unitsPerBag[itemId]) !== undefined)
          );
        },
      ),
    [items, quantities, reason, selectedCount, selectedItems, unitsPerBag],
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
    if (pending || !canSubmit) return;
    setConfirmOpen(true);
  }

  function submitRework() {
    if (pending || !canSubmit) return;
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
          ...(item.requiresUnitsPerBagInput
            ? { unitsPerBag: parsedUnitsPerBag(unitsPerBag[item.id]) }
            : {}),
        })),
    };
    startTransition(() => action(payload));
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">重做原因类型</span>
          <NativeSelect
            value={cause}
            disabled={pending}
            onChange={(event) => setCause(event.target.value as ReworkCause)}
            className="w-full"
          >
            {Object.entries(REWORK_CAUSE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">详细原因</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            required
            disabled={pending}
            className="w-full"
            placeholder="例如：运输途中受潮，重做第 1 款 500 个"
          />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          选择重做款式、数量和工艺
        </legend>
        <p className="text-xs text-muted-foreground">
          加工工艺可不选；未选加工工艺 = 仅重新打包/入袋。
        </p>
        <ol className="space-y-3">
          {items.map((item) => {
            const selected = selectedItems.has(item.id);
            return (
              <li key={item.id} className="min-w-0 rounded-lg border p-3">
                <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-1 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground">
                  <Checkbox
                    className="-ml-3"
                    checked={selected}
                    disabled={pending}
                    aria-label={`选择重做款式 ${item.sequence}：${item.name}`}
                    onCheckedChange={() => toggleItem(item.id)}
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
                        disabled={pending}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    {item.requiresUnitsPerBagInput ? (
                      <label className="block max-w-56 space-y-1 text-sm">
                        <span>每袋数量（原单未记录）</span>
                        <Input
                          type="number"
                          min={1}
                          max={MAX_UNITS_PER_BAG}
                          step={1}
                          required
                          value={unitsPerBag[item.id] ?? ''}
                          disabled={pending}
                          onChange={(event) =>
                            setUnitsPerBag((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                        <span className="block text-xs text-muted-foreground">
                          该值只用于原单缺失包装事实的这一款，不会覆盖已有包装组。
                        </span>
                      </label>
                    ) : null}
                    <fieldset>
                      <legend className="text-xs font-medium text-muted-foreground">
                        重做工艺
                      </legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.crafts.map((craft) => (
                          <label
                            key={craft.id}
                            className="flex min-h-11 cursor-pointer items-center gap-1 rounded-md border pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground"
                          >
                            <Checkbox
                              checked={
                                selectedCrafts[item.id]?.has(craft.id) ?? false
                              }
                              disabled={pending}
                              aria-label={`重做工艺：${craft.name}${craft.isOutsource ? '（外协）' : ''}`}
                              onCheckedChange={() =>
                                toggleCraft(item.id, craft.id)
                              }
                            />
                            <span>
                              {craft.name}
                              {craft.isOutsource ? '（外协）' : ''}
                            </span>
                          </label>
                        ))}
                        {item.crafts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            原单无可选加工工艺，本款将仅重新打包/入袋。
                          </span>
                        ) : null}
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
        <Button ref={submitButtonRef} type="submit" disabled={pending || !canSubmit}>
          {pending ? '正在创建…' : `创建重做单（${selectedCount} 款）`}
        </Button>
        <ConfirmActionController level="L2" focusReturnRef={submitButtonRef} open={confirmOpen} onOpenChange={setConfirmOpen} disabled={pending || !canSubmit} onConfirm={submitRework}>
          <ConfirmActionDialog action="创建重做单"
            changes={items.filter((item) => selectedItems.has(item.id)).map((item) => ({ label: `第 ${item.sequence} 款重做数量`, old: '未创建', new: `${quantities[item.id]} 个` }))}
            consequences={['创建关联重做工单，不新增客户应收，生产任务正常记录师傅工资。', '原工单状态、应收账单和历史工资保持不变。']}
            confirmText="创建重做单" />
        </ConfirmActionController>
      </div>
    </form>
  );
}
