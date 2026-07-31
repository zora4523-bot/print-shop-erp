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
import { createOrderChangeRequestAction } from '@/actions/order';
import type { CreateOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ItemOption = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  specification: string | null;
  foilColors: string[];
};

type EditableItem = {
  selected: boolean;
  name: string;
  quantity: number;
  specification: string;
  foilColors: string;
};

type OrderItemChangePayload =
  | {
      operation: 'UPDATE';
      itemId: string;
      name: string;
      quantity: number;
      specification: string | null;
      foilColors: string[];
    }
  | {
      operation: 'ADD';
      templateItemId: string;
      name: string;
      quantity: number;
      specification: string | null;
      foilColors: string[];
    };

type Props = {
  orderId: string;
  items: ItemOption[];
};

function splitColors(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，、]/)
        .map((color) => color.trim())
        .filter(Boolean),
    ),
  ];
}

function StateMessage({
  state,
}: {
  state: CreateOrderChangeRequestMutationResult | null;
}) {
  if (!state || state.status === 'success') return null;
  const message =
    state.status === 'error'
      ? state.message
      : Object.values(state.fieldErrors).flat()[0] ?? '请检查申请内容';
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function OrderChangeRequestForm({ orderId, items }: Props) {
  const router = useRouter();
  const [state, action] = useActionState<
    CreateOrderChangeRequestMutationResult | null,
    unknown
  >(createOrderChangeRequestAction, null);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [editable, setEditable] = useState<Record<string, EditableItem>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          selected: false,
          name: item.name,
          quantity: item.quantity,
          specification: item.specification ?? '',
          foilColors: item.foilColors.join('、'),
        },
      ]),
    ),
  );
  const [addEnabled, setAddEnabled] = useState(false);
  const [templateItemId, setTemplateItemId] = useState(items[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState(1);
  const [newSpecification, setNewSpecification] = useState('');
  const [newFoilColors, setNewFoilColors] = useState('');

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  const selectedCount = Object.values(editable).filter(
    (item) => item.selected,
  ).length;
  const canSubmit = useMemo(
    () =>
      reason.trim().length > 0 &&
      (selectedCount > 0 ||
        (addEnabled &&
          Boolean(templateItemId) &&
          newName.trim().length > 0 &&
          newQuantity > 0)),
    [
      addEnabled,
      newName,
      newQuantity,
      reason,
      selectedCount,
      templateItemId,
    ],
  );

  function updateItem(itemId: string, patch: Partial<EditableItem>) {
    setEditable((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const changes: OrderItemChangePayload[] = items.flatMap((item) => {
      const current = editable[item.id];
      if (!current.selected) return [];
      return [
        {
          operation: 'UPDATE' as const,
          itemId: item.id,
          name: current.name,
          quantity: current.quantity,
          specification: current.specification || null,
          foilColors: splitColors(current.foilColors),
        },
      ];
    });
    if (addEnabled) {
      changes.push({
        operation: 'ADD',
        templateItemId,
        name: newName,
        quantity: newQuantity,
        specification: newSpecification || null,
        foilColors: splitColors(newFoilColors),
      });
    }
    startTransition(() =>
      action({
        orderId,
        reason,
        items: changes,
      }),
    );
  }

  if (state?.status === 'success') {
    return (
      <div
        role="status"
        className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
      >
        修改申请已提交，管理员批准前工单内容不会变化。
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        勾选要修改的款式；可改款式名、数量、规格和烫金颜色。已开工款式不能改数量。
      </p>
      <fieldset className="space-y-3">
        <legend className="sr-only">选择并修改现有款式</legend>
        {items.map((item) => {
          const current = editable[item.id];
          return (
            <div key={item.id} className="min-w-0 rounded-lg border p-3">
              <label className="flex min-h-11 min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={current.selected}
                  onChange={(event) =>
                    updateItem(item.id, { selected: event.target.checked })
                  }
                  className="size-4 shrink-0"
                />
                <span className="admin-wrap-anywhere min-w-0 font-medium">
                  #{item.sequence} · {item.name}
                </span>
              </label>
              {current.selected ? (
                <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>款式名称</span>
                    <Input
                      value={current.name}
                      maxLength={64}
                      required
                      onChange={(event) =>
                        updateItem(item.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>数量</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={current.quantity}
                      required
                      onChange={(event) =>
                        updateItem(item.id, {
                          quantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>规格</span>
                    <Input
                      value={current.specification}
                      maxLength={64}
                      onChange={(event) =>
                        updateItem(item.id, {
                          specification: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>烫金颜色（多个用顿号分隔）</span>
                    <Input
                      value={current.foilColors}
                      maxLength={200}
                      onChange={(event) =>
                        updateItem(item.id, {
                          foilColors: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">增加款式</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={addEnabled}
            onChange={(event) => setAddEnabled(event.target.checked)}
            className="size-4"
          />
          <span className="text-sm">本次申请需要新增一款</span>
        </label>
        {addEnabled ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>参考现有款式（继承纸张、工艺和单价）</span>
              <select
                value={templateItemId}
                onChange={(event) => setTemplateItemId(event.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-3 py-2"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.sequence} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>新款式名称</span>
              <Input
                value={newName}
                maxLength={64}
                required
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>数量</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={newQuantity}
                required
                onChange={(event) => setNewQuantity(Number(event.target.value))}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>规格</span>
              <Input
                value={newSpecification}
                maxLength={64}
                onChange={(event) => setNewSpecification(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>烫金颜色（可多色）</span>
              <Input
                value={newFoilColors}
                maxLength={200}
                onChange={(event) => setNewFoilColors(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">修改原因</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          required
          className="w-full rounded-md border bg-background px-3 py-2"
          placeholder="写明客户要求、交期影响等，方便管理员审核"
        />
      </label>
      <StateMessage state={state} />
      <Button type="submit" disabled={pending || !canSubmit} className="min-h-11">
        {pending ? '提交中…' : `提交修改申请${selectedCount ? `（${selectedCount} 款）` : ''}`}
      </Button>
    </form>
  );
}
