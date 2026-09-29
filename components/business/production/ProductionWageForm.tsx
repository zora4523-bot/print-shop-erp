'use client';

import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { allocateProductionWagesAction } from '@/actions/production-dispatch';

type Allocation = { workerId: string; name: string; amount: string; revision: number };
export function ProductionWageForm({ jobId, owner, wages, workers }: { jobId: string; owner: { id: string; name: string }; wages: Allocation[]; workers: Array<{ id: string; name: string }> }) {
  const [rows, setRows] = useState<Allocation[]>(wages.length ? wages : [{ workerId: owner.id, name: owner.name, amount: '', revision: -1 }]);
  const [requestKey] = useState(() => globalThis.crypto.randomUUID());
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState('');
  const [state, action, pending] = useActionState(allocateProductionWagesAction, null);
  return <form action={reviewing ? action : undefined} onSubmit={event => { if (!reviewing) { event.preventDefault(); setReviewing(true); } }} aria-busy={pending} className="space-y-3">
    <input type="hidden" name="payload" value={JSON.stringify({ jobId, requestKey, reason, allocations: rows.map(row => ({ workerId: row.workerId, amount: row.amount, expectedRevision: row.revision })) })} />
    <h3 className="font-medium">登记最终提成</h3>
    <p className="text-sm text-muted-foreground">填写本次生产各人的最终应得金额。</p>
    <fieldset disabled={pending || reviewing || state?.ok} className="space-y-3">
    {rows.map((row, index) => <div key={index} className="grid min-w-0 gap-2 sm:grid-cols-[1fr_1fr_auto]">
      {row.revision >= 0 || row.workerId === owner.id ? <label htmlFor={`${jobId}-wage-${index}`} className="flex min-h-11 items-center">{row.name}</label> : <select aria-label={`参与师傅 ${index + 1}`} className="min-h-11 min-w-0 rounded-md border bg-background px-3" value={row.workerId} required onChange={event => setRows(current => current.map((item, i) => i !== index ? item : { ...item, workerId: event.target.value, name: workers.find(worker => worker.id === event.target.value)?.name ?? '' }))}><option value="">选择协作师傅</option>{workers.filter(worker => !rows.some((other, i) => i !== index && other.workerId === worker.id)).map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>}
      <Input id={`${jobId}-wage-${index}`} aria-label={`${row.name || '协作师傅'}最终提成（元）`} className="min-h-11" type="number" step="0.01" min="0" max="9999999999.99" value={row.amount} required onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} />
      {row.revision < 0 && row.workerId !== owner.id && <Button type="button" variant="outline" className="min-h-11" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>移除协作师傅</Button>}
    </div>)}
    <Button type="button" variant="outline" className="min-h-11" disabled={pending || rows.length >= 20 || state?.ok} onClick={() => setRows(current => [...current, { workerId: '', name: '', amount: '', revision: -1 }])}>添加协作师傅提成</Button>
    <div className="space-y-1"><label htmlFor={`${jobId}-wage-reason`}>金额依据</label><Input id={`${jobId}-wage-reason`} className="min-h-11" value={reason} maxLength={500} required onChange={event => setReason(event.target.value)} /></div>
    </fieldset>
    {reviewing && <section className="space-y-2 rounded-lg border p-3" aria-label="核对提成金额"><h4 className="font-medium">核对最终提成</h4>{rows.map(row => {
      const before = wages.find(wage => wage.workerId === row.workerId)?.amount;
      const difference = new Decimal(row.amount || '0').minus(before || '0');
      return <p key={row.workerId} className="break-words">{row.name}：{before ? formatMoney(before) : '待补录'} → {formatMoney(row.amount)}（变动 {formatMoney(difference)}）</p>;
    })}<p className="break-words">金额依据：{reason}</p></section>}
    <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={pending || state?.ok}>{!reviewing ? '核对提成' : pending ? '正在登记…' : '登记提成'}</Button>{reviewing && <Button type="button" variant="outline" className="min-h-11" disabled={pending || state?.ok} onClick={() => setReviewing(false)}>返回修改</Button>}</div>
    {state && <p role="status" className={state.ok ? 'text-muted-foreground' : 'text-destructive'}>{state.message}</p>}
  </form>;
}
