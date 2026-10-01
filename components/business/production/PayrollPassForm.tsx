'use client';

import { useActionState, useState } from 'react';
import { updatePayrollPassAction } from '@/actions/production-payroll-pass';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DisabledReason, FormMessage } from '@/components/ui-business';

export function PayrollPassForm({ operationId, revision, passCount, sequences }: {
  operationId: string; revision: number; passCount: number; sequences: number[];
}) {
  const [state, action, pending] = useActionState(updatePayrollPassAction, null);
  const [count, setCount] = useState(String(passCount));
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(false);
  return <form action={action} aria-busy={pending} className="space-y-3 rounded-lg border p-3" aria-label={`款式 ${sequences.join('、')} 计薪次数`}>
    <p className="text-sm font-medium">局部烫金 · 款式 {sequences.join('、')}</p>
    <input type="hidden" name="operationId" value={operationId} />
    <input type="hidden" name="expectedRevision" value={revision} />
    <fieldset disabled={pending} className="space-y-3">
      <div className="space-y-2"><Label htmlFor={`passes-${operationId}`}>计薪过版次数</Label><Input id={`passes-${operationId}`} name="passCount" type="number" min={1} max={999} step={1} required value={count} onChange={(e) => { setCount(e.target.value); setReview(false); }} /></div>
      <div className="space-y-2"><Label htmlFor={`reason-${operationId}`}>调整原因</Label><Input id={`reason-${operationId}`} name="reason" minLength={2} maxLength={500} required value={reason} onChange={(e) => { setReason(e.target.value); setReview(false); }} /></div>
      {review ? <div className="space-y-2 text-sm">
        <h3 className="font-medium">调整计薪次数</h3>
        <p>{passCount} 次 → {count} 次</p>
        <p>适用于本工序所有款式的后续报工，已报工资保持原金额。</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? '正在保存…' : '保存计薪次数'}</Button><Button type="button" variant="outline" onClick={() => setReview(false)}>取消</Button></div>
      </div> : (() => {
        const blocked = count === String(passCount) ? '次数未改变，无需调整。'
          : !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 999 ? '计薪过版次数须为 1 至 999 的整数。'
            : reason.trim().length < 2 ? '调整原因至少 2 个字。' : null;
        return blocked ? <DisabledReason cause="prerequisite" reason={blocked}><Button type="button" variant="outline" disabled>核对调整</Button></DisabledReason>
          : <Button type="button" variant="outline" onClick={() => setReview(true)}>核对调整</Button>;
      })()}
    </fieldset>
    {state && <div role={state.status === 'error' ? 'alert' : 'status'}><FormMessage fieldId={`result-${operationId}`} tone={state.status}>{state.message}</FormMessage></div>}
  </form>;
}
