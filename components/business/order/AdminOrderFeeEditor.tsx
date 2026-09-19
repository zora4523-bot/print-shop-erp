'use client';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { formatMoney } from '@/lib/dashboard/format';
import { useRouter } from 'next/navigation';
import { previewOrderPricingReviewAction, finalizeOrderPricingAction } from '@/actions/order';
import type { PreviewOrderPricingReviewResult, FinalizeOrderPricingMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ActionNotice } from '@/components/ui-business';
import { useOrderEditorAuxiliary } from './use-order-editor-auxiliary';
import { adminFeeRows, feeEditorCommand, feeEditorTotal } from '@/lib/order/admin-fee-draft';

function errorMessage(result: PreviewOrderPricingReviewResult | FinalizeOrderPricingMutationResult | null) {
  if (result?.status === 'error') return result.message;
  if (result?.status === 'invalid') return Object.values(result.fieldErrors).flat().join('；');
  return null;
}
export function AdminOrderFeeEditor({ orderId, canEditCommercial = false }: { orderId: string; canEditCommercial?: boolean }) {
  const router = useRouter();
  const [previewState, previewAction] = useActionState<PreviewOrderPricingReviewResult | null, unknown>(previewOrderPricingReviewAction, null);
  const [result, saveAction] = useActionState<FinalizeOrderPricingMutationResult | null, unknown>(finalizeOrderPricingAction, null);
  const [busy, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const auxiliary = useOrderEditorAuxiliary({ dirty: Object.keys(values).length > 0 || reason !== '', pending: busy });
  const preview = previewState?.status === 'success' ? previewState.preview : null;
  const rows = preview ? adminFeeRows(preview) : [];
  const total = preview ? feeEditorTotal(preview, rows, values) : null;
  const error = errorMessage(result) ?? errorMessage(previewState);
  useEffect(() => { if (result?.status === 'success') router.refresh(); }, [result, router]);
  return <section id="admin-fee-editor" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <Button type="button" className="min-h-11" variant="outline" aria-expanded={open} disabled={busy || auxiliary.blocked} onClick={() => { setOpen(!open); if (!open) startTransition(() => previewAction({ orderId, editAll: true })); }}>编辑全部收费</Button>
    {open ? <>
      {busy && !preview ? <p role="status">正在读取收费明细…</p> : null}
      {error ? <ActionNotice tone="error" title={error} /> : null}
      {preview && canEditCommercial ? <a href="#commercial-fees" className="inline-flex min-h-11 items-center text-sm underline">编辑逐款制版、附加收费与优惠调整</a> : null}
      {preview ? <fieldset disabled={busy || auxiliary.blocked || result?.status === 'success'} className="min-w-0 space-y-4">
        {rows.map((row) => <div key={row.key} className="min-w-0 space-y-3 rounded-lg border p-3">
          <h3 className="break-words text-sm font-medium">{row.label}</h3>
          <div className="grid gap-3 sm:grid-cols-2">{row.fields.map((field) => <div key={field.key} className="min-w-0 space-y-2">
            <label className="block space-y-1 text-sm"><span>{field.label}（元）</span><Input className="min-h-11" inputMode="decimal" value={values[field.key] ?? field.value} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>
            <p className="text-xs text-muted-foreground">参考价 {field.reference === null ? '待核价' : field.scale === 4 ? formatUnitPrice(field.reference) : formatMoney(field.reference)} · 最多 {field.scale} 位小数</p>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={field.reference === null} onClick={() => setValues((current) => ({ ...current, [field.key]: field.reference! }))}>采用参考价</Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => setValues((current) => ({ ...current, [field.key]: '0' }))}>免收</Button></div>
          </div>)}</div>
        </div>)}
        <label className="block space-y-1 text-sm"><span>定价依据（必填）</span><Textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <p className="break-words text-sm" aria-live="polite">工单总额：{formatMoney(preview.currentTotalAmount)} → {total === null ? '待填写' : formatMoney(total)}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={!reason.trim() || total === null} onClick={() => startTransition(() => saveAction(feeEditorCommand(preview, values, reason)))}>{busy ? '正在保存…' : '保存收费'}</Button><Button type="button" className="min-h-11" variant="outline" onClick={() => { setValues({}); setReason(''); }}>还原输入</Button></div>
      </fieldset> : null}
      {result?.status === 'success' ? <ActionNotice tone="success" title={`收费已保存，工单总额 ${formatMoney(result.totalAmount)}`} /> : null}
    </> : null}
  </section>;
}
