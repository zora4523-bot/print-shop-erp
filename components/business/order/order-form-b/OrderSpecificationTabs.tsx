'use client';

import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { EditorTabs } from '@/components/ui/editor-tabs';
import { MAX_ORDER_ITEMS_PER_ORDER } from '@/lib/order/limits';
import type { CreateOrderInput } from '@/lib/auth/schemas';

export function OrderSpecificationTabs({ id, indexes, items, itemFields, activeIndex, errors, disabled, removeRef, onSelect, onAdd, onRemove }: {
  id: string;
  indexes: readonly number[];
  items: CreateOrderInput['items'];
  itemFields: readonly { id: string }[];
  activeIndex: number;
  errors?: { items?: readonly (object | undefined)[] };
  disabled: boolean;
  removeRef: Ref<HTMLButtonElement>;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return <div className="mt-5 space-y-3 border-t pt-4">
    <h2 className="text-sm font-semibold">规格与数量</h2>
    <div className="flex flex-wrap items-start gap-2">
      <EditorTabs id={id} label="规格明细" variant="outline" disabled={disabled}
        tabs={indexes.map((index) => ({ value: itemFields[index].id,
          label: `${items[index].specification || '选择规格'} · ${items[index].quantity} 个${errors?.items?.[index] ? ' · 待完善' : ''}` }))}
        value={itemFields[activeIndex].id} onChange={(value) => onSelect(itemFields.findIndex((entry) => entry.id === value))} />
      <Button type="button" variant="outline" disabled={disabled || items.length >= MAX_ORDER_ITEMS_PER_ORDER} onClick={onAdd}>＋ 增加规格</Button>
      {itemFields.length > 1 ? <Button type="button" variant="outline" ref={removeRef} disabled={disabled} onClick={onRemove}>
        {indexes.length === 1 ? '删除设计款' : '移除当前规格'}
      </Button> : null}
    </div>
  </div>;
}
