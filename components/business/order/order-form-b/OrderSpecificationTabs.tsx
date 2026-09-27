'use client';

import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { EditorTabs } from '@/components/ui/editor-tabs';
import { MAX_ORDER_ITEMS_PER_ORDER } from '@/lib/order/limits';
import type { CreateOrderInput } from '@/lib/auth/schemas';

export function OrderSpecificationTabs({ id, indexes, items, itemFields, activeIndex, errors, disabled, removeRef, navRef, onSelect, onAdd, onRemove }: {
  id: string;
  indexes: readonly number[];
  items: CreateOrderInput['items'];
  itemFields: readonly { id: string }[];
  activeIndex: number;
  errors?: { items?: readonly (object | undefined)[] };
  disabled: boolean;
  removeRef: Ref<HTMLButtonElement>;
  navRef: Ref<HTMLDivElement>;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return <div className="space-y-4">
    <h2 className="text-base font-semibold">规格与数量</h2>
    <div className="flex flex-wrap items-start gap-2">
      {/* 窄屏下标签独占一行：标签文字随数量 / 「待完善」变长时，不把后面的按钮挤到下一行，
          否则正在输入的数量、每包数量会整体下跳（order-entry-stability 的契约）。 */}
      <div className="w-full min-w-0 @min-[560px]:w-auto">
        <EditorTabs ref={navRef} id={id} label="规格明细" variant="outline" disabled={disabled}
          tabs={indexes.map((index) => ({ value: itemFields[index].id,
            label: `${items[index].specification || '选择规格'} · ${items[index].quantity} 个${errors?.items?.[index] ? ' · 待完善' : ''}` }))}
          value={itemFields[activeIndex].id} onChange={(value) => onSelect(itemFields.findIndex((entry) => entry.id === value))} />
      </div>
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || items.length >= MAX_ORDER_ITEMS_PER_ORDER} onClick={onAdd}>＋ 增加规格</Button>
      {indexes.length > 1 ? <Button type="button" variant="destructive" className="min-h-11 bg-background hover:bg-destructive/5 dark:bg-background dark:hover:bg-destructive/5" ref={removeRef} disabled={disabled} onClick={onRemove}>
        移除当前规格
      </Button> : null}
    </div>
  </div>;
}
