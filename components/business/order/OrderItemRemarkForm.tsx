'use client';

import { useActionState, useId, useState } from 'react';
import { editItemRemarkAction } from '@/actions/order-item-remark';
import type { OrderMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FormMessage, formMessageId } from '@/components/ui-business';
import { useOrderEditorAuxiliary } from './use-order-editor-auxiliary';

export function OrderItemRemarkForm({ orderId, itemId, sequence, version, initial }: {
  orderId: string; itemId: string; sequence: number; version: number; initial: string | null;
}) {
  const id = useId();
  const [value, setValue] = useState(initial ?? '');
  const [state, action, pending] = useActionState<OrderMutationResult | null, FormData>(
    editItemRemarkAction.bind(null, orderId, itemId), null,
  );
  const dirty = value.trim() !== (initial ?? '');
  const auxiliary = useOrderEditorAuxiliary({ dirty, pending });
  const error = state?.status === 'invalid'
    ? Object.values(state.fieldErrors).flat().join('；')
    : state?.status === 'error' ? state.message : null;
  return <form action={action} aria-busy={pending} className="min-w-0 space-y-2">
    <input type="hidden" name="expectedEditVersion" value={version} />
    <Label htmlFor={id}>第 {sequence} 款备注</Label>
    <Textarea id={id} name="remark" value={value} maxLength={1000}
      aria-invalid={Boolean(error)} aria-describedby={error ? formMessageId(id) : undefined}
      aria-errormessage={error ? formMessageId(id) : undefined}
      disabled={pending || auxiliary.blocked} onChange={(event) => setValue(event.target.value)} />
    {error ? <FormMessage fieldId={id}>{error}</FormMessage> : null}
    {state?.status === 'success' ? <FormMessage fieldId={`${id}-saved`} tone="success">已保存</FormMessage> : null}
    {auxiliary.blocked ? <p className="text-sm text-muted-foreground">请先保存其他修改，再修改款式备注。</p> : null}
    <Button type="submit" className="min-h-11" disabled={pending || auxiliary.blocked || !dirty}>
      {pending ? '保存中…' : '保存款式备注'}
    </Button>
  </form>;
}
