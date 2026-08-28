'use client';

import {
  useActionState,
  useMemo,
  useState,
  useTransition,
} from 'react';
import type { FormEvent } from 'react';
import { createOrderChangeRequestAction } from '@/actions/order';
import type { CreateOrderChangeRequestMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveOrderItemFoilSides } from '@/lib/order/pricing-route';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type ItemOption = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  specification: string | null;
  frontFoilColors?: string[];
  backFoilColors?: string[];
  foilColors: string[];
  isDoubleSided?: boolean;
};

type EditableItem = {
  selected: boolean;
  /** Submitted value; keep the imported matcher text until the user edits it. */
  name: string;
  displayName: string;
  quantity: number;
  displaySpecification: string;
  frontFoilColors: string;
  backFoilColors: string;
};

type OrderItemChangePayload =
  | {
      operation: 'UPDATE';
      itemId: string;
      name: string;
      quantity: number;
      frontFoilColors: string[];
      backFoilColors: string[];
    }
  | {
      operation: 'ADD';
      templateItemId: string;
      name: string;
      quantity: number;
      frontFoilColors: string[];
      backFoilColors: string[];
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

export function createOrderChangeEditableItem(item: ItemOption): EditableItem {
  const specification = item.specification ?? '';
  const foilSides = resolveOrderItemFoilSides(item);
  return {
    selected: false,
    name: item.name,
    displayName: externalPriceBusinessText(item.name),
    quantity: item.quantity,
    displaySpecification: specification
      ? externalPriceBusinessText(specification)
      : '',
    frontFoilColors: foilSides.frontFoilColors.join('、'),
    backFoilColors: foilSides.backFoilColors.join('、'),
  };
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
        createOrderChangeEditableItem(item),
      ]),
    ),
  );
  const [addEnabled, setAddEnabled] = useState(false);
  const [templateItemId, setTemplateItemId] = useState(items[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState(1);
  const [newFrontFoilColors, setNewFrontFoilColors] = useState('');
  const [newBackFoilColors, setNewBackFoilColors] = useState('');

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
    if (pending || !canSubmit) return;
    const changes: OrderItemChangePayload[] = items.flatMap((item) => {
      const current = editable[item.id];
      if (!current.selected) return [];
      return [
        {
          operation: 'UPDATE' as const,
          itemId: item.id,
          name: current.name,
          quantity: current.quantity,
          frontFoilColors: splitColors(current.frontFoilColors),
          backFoilColors: splitColors(current.backFoilColors),
        },
      ];
    });
    if (addEnabled) {
      changes.push({
        operation: 'ADD',
        templateItemId,
        name: newName,
        quantity: newQuantity,
        frontFoilColors: splitColors(newFrontFoilColors),
        backFoilColors: splitColors(newBackFoilColors),
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
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="min-w-0 space-y-4"
    >
      <p className="text-xs text-muted-foreground">
        勾选要修改的款式；可改款式名、数量和正反面烫金颜色。已开工款式不能改数量。
        新增款式继承规格、纸张、工艺和计价参数。
      </p>
      <fieldset className="min-w-0 space-y-3">
        <legend className="sr-only">选择并修改现有款式</legend>
        {items.map((item) => {
          const current = editable[item.id];
          return (
            <div key={item.id} className="min-w-0 rounded-lg border p-3">
              <label className="flex min-h-11 min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={current.selected}
                  disabled={pending}
                  onChange={(event) =>
                    updateItem(item.id, { selected: event.target.checked })
                  }
                  className="size-4 shrink-0"
                />
                <span className="admin-wrap-anywhere min-w-0 font-medium">
                  #{item.sequence} · {externalPriceBusinessText(item.name)}
                </span>
              </label>
              {current.selected ? (
                <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2">
                  <label className="min-w-0 space-y-1 text-sm">
                    <span>款式名称</span>
                    <Input
                      value={current.displayName}
                      maxLength={64}
                      required
                      disabled={pending}
                      onChange={(event) =>
                        updateItem(item.id, {
                          name: event.target.value,
                          displayName: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-sm">
                    <span>数量</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={current.quantity}
                      required
                      disabled={pending}
                      onChange={(event) =>
                        updateItem(item.id, {
                          quantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="min-w-0 space-y-1 text-sm">
                    <span>规格</span>
                    <p className="admin-wrap-anywhere min-h-11 min-w-0 rounded-md border bg-muted/30 px-3 py-2.5">
                      {current.displaySpecification || '未填'}
                    </p>
                  </div>
                  <label className="min-w-0 space-y-1 text-sm">
                    <span>正面烫金颜色（多个用顿号分隔）</span>
                    <Input
                      value={current.frontFoilColors}
                      maxLength={200}
                      disabled={pending}
                      onChange={(event) =>
                        updateItem(item.id, {
                          frontFoilColors: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-sm">
                    <span>反面烫金颜色（多个用顿号分隔）</span>
                    <Input
                      value={current.backFoilColors}
                      maxLength={200}
                      disabled={pending}
                      onChange={(event) =>
                        updateItem(item.id, {
                          backFoilColors: event.target.value,
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

      <fieldset className="min-w-0 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">增加款式</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={addEnabled}
            disabled={pending}
            onChange={(event) => setAddEnabled(event.target.checked)}
            className="size-4"
          />
          <span className="text-sm">本次申请需要新增一款</span>
        </label>
        {addEnabled ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2">
            <label className="min-w-0 space-y-1 text-sm">
              <span>参考现有款式（继承规格、纸张、工艺和计价参数）</span>
              <select
                value={templateItemId}
                disabled={pending}
                onChange={(event) => setTemplateItemId(event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.sequence} · {externalPriceBusinessText(item.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>新款式名称</span>
              <Input
                value={newName}
                maxLength={64}
                required
                disabled={pending}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm">
              <span>数量</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={newQuantity}
                required
                disabled={pending}
                onChange={(event) => setNewQuantity(Number(event.target.value))}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm lg:col-span-2">
              <span>正面烫金颜色（可多色）</span>
              <Input
                value={newFrontFoilColors}
                maxLength={200}
                disabled={pending}
                onChange={(event) => setNewFrontFoilColors(event.target.value)}
              />
            </label>
            <label className="min-w-0 space-y-1 text-sm lg:col-span-2">
              <span>反面烫金颜色（可多色）</span>
              <Input
                value={newBackFoilColors}
                maxLength={200}
                disabled={pending}
                onChange={(event) => setNewBackFoilColors(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className="block min-w-0 space-y-1 text-sm">
        <span className="font-medium">修改原因</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          required
          disabled={pending}
          className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
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
