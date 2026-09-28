'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { publishProductionDispatchAction } from '@/actions/production-dispatch';

type OrderRow = { id: string; name: string; revision: number; version: number; tasks: Array<{ key: string; label: string; quantity: string; workerId: string; locked: boolean; options: Array<{ id: string; name: string }> }> };
export function ProductionDispatchForm({ orders, actorId }: { orders: OrderRow[]; actorId: string }) {
  const [assignments, setAssignments] = useState(() => Object.fromEntries(orders.map(order => [order.id, Object.fromEntries(order.tasks.map(task => [task.key, task.workerId]))])));
  const [requestKey] = useState(() => globalThis.crypto.randomUUID());
  const [state, action, pending] = useActionState(publishProductionDispatchAction, null);
  const [reviewing, setReviewing] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const draftKey = `production-dispatch:${actorId}:${orders.map(order => `${order.id}:${order.version}:${order.revision}`).join(',')}`;
  useEffect(() => { if (state?.ok) localStorage.removeItem(draftKey); }, [state, draftKey]);
  const complete = orders.every(order => order.tasks.length > 0 && order.tasks.every(task => assignments[order.id]?.[task.key]));
  return <form action={action} aria-busy={pending} className="min-w-0 space-y-5">
    <input type="hidden" name="payload" value={JSON.stringify({ requestKey, orders: orders.map(order => ({ id: order.id, revision: order.revision, version: order.version, assignments: assignments[order.id] })) })} />
    {orders.map(order => <fieldset key={order.id} disabled={pending || state?.ok || reviewing} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <legend className="px-1 font-semibold">{order.name} · v{order.version}</legend>
      {order.tasks.map((task, index) => <div key={task.key} className="grid min-w-0 items-center gap-2 sm:grid-cols-2">
        <label htmlFor={`${order.id}-${index}`} className="break-words">{task.label} · {task.quantity} 个</label>
        <select id={`${order.id}-${index}`} className="min-h-11 min-w-0 rounded-md border bg-background px-3" disabled={task.locked} value={assignments[order.id]?.[task.key] ?? ''} onChange={event => setAssignments(current => ({ ...current, [order.id]: { ...current[order.id], [task.key]: event.target.value } }))} required>
          <option value="">选择生产师傅</option>{task.options.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
        </select>
      </div>)}
    </fieldset>)}
    {reviewing ? <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">发布排单</h2><p>已选择的师傅负责对应生产。尚未下发的工单将下发并生成打印任务。</p><div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={pending || state?.ok}>{pending ? '正在发布…' : '发布排单'}</Button><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setReviewing(false)}>返回修改</Button></div></section>
      : <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={!complete || pending || state?.ok} onClick={() => setReviewing(true)}>核对排单</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => { localStorage.setItem(draftKey, JSON.stringify(assignments)); setDraftNotice('草稿已保存到本机'); }}>保存草稿</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => {
        try { const draft: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); if (!draft || typeof draft !== 'object') { setDraftNotice('本机没有这批工单的草稿'); return; }
          const next = { ...assignments }; for (const order of orders) { const row = (draft as Record<string, unknown>)[order.id]; if (!row || typeof row !== 'object') continue; next[order.id] = { ...next[order.id] }; for (const task of order.tasks) { const value = (row as Record<string, unknown>)[task.key]; if (!task.locked && typeof value === 'string' && task.options.some(option => option.id === value)) next[order.id][task.key] = value; } } setAssignments(next); setDraftNotice('已恢复草稿，请核对师傅');
        } catch { setDraftNotice('草稿无法读取，请重新选择师傅'); }
      }}>恢复草稿</Button></div>}
    <p role="status" className={state && !state.ok ? 'text-destructive' : 'text-muted-foreground'}>{state?.message ?? draftNotice}</p>
    <Link className="inline-flex min-h-11 items-center underline" href="/orders?queue=production">返回工单列表</Link>
  </form>;
}
