'use client';
import Decimal from 'decimal.js';
import { useActionState, useState } from 'react';
import { reviewOrderWagesAction } from '@/actions/order-wage-review';
import type { PieceworkActionResult } from '@/actions/owner-piecework-rules.types';
import type { listOrderWages } from '@/lib/salary/order-wage-review';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FormMessage } from '@/components/ui-business';

type Wage = Awaited<ReturnType<typeof listOrderWages>>[number];
const names = { PARTIAL: '局部烫金', FULL: '专版烫金', PACKING: '包装' };
export function OrderWageReviewForm({ wage }: { wage: Wage }) {
  const [state, action, pending] = useActionState<PieceworkActionResult | null, FormData>(reviewOrderWagesAction, null);
  const [amounts, setAmounts] = useState(wage.groups.map((g) => g.amount));
  const [reason, setReason] = useState(''); const [review, setReview] = useState(false);
  const valid = amounts.every((a, i) => wage.groups[i]!.editable ? /^\d{1,12}(\.\d{1,2})?$/.test(a) : a === wage.groups[i]!.amount) && reason.trim().length >= 2;
  return <form action={action} aria-label={`${names[wage.type]}提成核定`} aria-busy={pending} className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{names[wage.type]}</h3>{wage.reviewRequired && <Badge variant="outline">需人工核定</Badge>}</div>
    {wage.reviewRequired && <p className="text-sm text-muted-foreground">多人接手或计薪条件有变化，请核对各师傅提成。</p>}
    {wage.groups.some((g) => g.voided) && <p className="text-sm text-muted-foreground">已冲正的报工整笔作废、不可改价；确认核定时会自动抵消此前对它做过的人工调整。</p>}
    <input type="hidden" name="operationId" value={wage.id} /><input type="hidden" name="revision" value={wage.revision} />
    <fieldset disabled={pending} className="space-y-3" onChange={() => setReview(false)}>
      {wage.groups.map((group, i) => <div key={group.anchorId} className="grid items-center gap-2 sm:grid-cols-[1fr_160px]">
        <div className="min-w-0 text-sm"><label htmlFor={`wage-${group.anchorId}`}>{group.name} · {group.date}</label><p className="text-muted-foreground">已报 {group.quantity} · 当前提成 {formatMoney(group.amount)}{group.settled ? ' · 已结算' : group.voided ? ' · 已冲正，不可改价' : !group.editable ? ' · 冲正记录' : ''}</p></div>
        <input type="hidden" name="anchorId" value={group.anchorId} />
        <Input id={`wage-${group.anchorId}`} name="amount" aria-label={`${group.name} ${group.date} 核定提成`} inputMode="decimal" readOnly={!group.editable} value={amounts[i]} onChange={(e) => setAmounts((old) => old.map((a, j) => j === i ? e.target.value : a))} />
      </div>)}
      <div className="space-y-1"><label className="text-sm" htmlFor={`wage-reason-${wage.id}`}>核定原因</label><Input id={`wage-reason-${wage.id}`} name="reason" minLength={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </fieldset>
    {review ? <div className="space-y-3 rounded-lg border p-3 text-sm"><h4 className="font-medium">核定工单提成</h4>{wage.groups.map((g, i) => <p key={g.anchorId}>{g.name} · {g.date}：{formatMoney(g.amount)} → {formatMoney(amounts[i]!)}（差额 {formatMoneyDelta(new Decimal(amounts[i]!).minus(g.amount))}）</p>)}<p>核定金额计入对应师傅的工资，已有报工记录保留。</p><div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>保存核定</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>返回修改</Button></div></div> : <Button type="button" variant="outline" disabled={pending || !valid} onClick={() => setReview(true)}>核对提成</Button>}
    {state && <div role={state.status === 'error' ? 'alert' : 'status'}><FormMessage fieldId={`wage-result-${wage.id}`} tone={state.status}>{state.message}</FormMessage></div>}
  </form>;
}
