'use client';
import { useActionState, useState } from 'react';
import { editSalesTextAction } from '@/actions/order-sales-text';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
export function SalesTextEditForm({ orderId, targetId, field, version, value, label }: {
  orderId: string; targetId: string; field: 'itemName' | 'itemRemark' | 'packagingName'; version: number; value: string; label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [state, action, pending] = useActionState(editSalesTextAction.bind(null, orderId, targetId, field), null);
  const busy = pending || Boolean(state?.changed);
  return <form action={action} aria-label={label} aria-busy={busy} className="mt-3 space-y-2 rounded-md border p-3">
    <input type="hidden" name="expectedEditVersion" value={version} />
    <label className="block space-y-1 text-sm"><span>{label}</span>{field === 'itemRemark' ? <Textarea name="value" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} disabled={busy} /> : <Input name="value" value={draft} onChange={(event) => setDraft(event.target.value)} required={field === 'itemName'} maxLength={64} disabled={busy} />}</label>
    {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <Button type="submit" size="sm" disabled={busy}>{pending ? '保存中…' : `保存${label}`}</Button>
  </form>;
}
