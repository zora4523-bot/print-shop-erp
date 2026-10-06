'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ActionNotice, DisabledReason, PendingLink } from '@/components/ui-business';
import { publishProductionDispatchAction } from '@/actions/production-dispatch';

type OrderRow = {
  id: string; name: string; revision: number; version: number;
  tasks: Array<{
    key: string; label: string; quantity: string; workerId: string; locked: boolean;
    options: Array<{ id: string; name: string }>;
  }>;
};

export function ProductionDispatchForm({ orders, actorId }: { orders: OrderRow[]; actorId: string }) {
  const [assignments, setAssignments] = useState(() => Object.fromEntries(orders.map(order => [order.id, Object.fromEntries(order.tasks.map(task => [task.key, task.workerId]))])));
  const [requestKey] = useState(() => globalThis.crypto.randomUUID());
  const [state, action, pending] = useActionState(publishProductionDispatchAction, null);
  const [reviewing, setReviewing] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const submittedDraftKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const wasReviewing = useRef(false);
  const draftKey = `production-dispatch:${actorId}:${orders.map(order => `${order.id}:${order.version}:${order.revision}`).join(',')}`;
  useEffect(() => {
    // Revalidation can advance the props to a new revision before the receipt arrives.
    if (state?.ok && submittedDraftKey.current) localStorage.removeItem(submittedDraftKey.current);
    if (state?.ok) resultRef.current?.focus();
  }, [state]);
  useEffect(() => {
    if (reviewing) reviewHeadingRef.current?.focus();
    else if (wasReviewing.current) formRef.current?.querySelector<HTMLElement>('select:enabled, button:enabled')?.focus();
    wasReviewing.current = reviewing;
  }, [reviewing]);
  const complete = orders.every(order => order.tasks.length > 0 && order.tasks.every(task => assignments[order.id]?.[task.key]));

  function restoreDraft() {
    try {
      const draft: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (!draft || typeof draft !== 'object') {
        setDraftNotice('本机没有这批工单的草稿');
        return;
      }
      const next = { ...assignments };
      for (const order of orders) {
        const row = (draft as Record<string, unknown>)[order.id];
        if (!row || typeof row !== 'object') continue;
        next[order.id] = { ...next[order.id] };
        for (const task of order.tasks) {
          const value = (row as Record<string, unknown>)[task.key];
          if (!task.locked && typeof value === 'string' && task.options.some(option => option.id === value)) {
            next[order.id][task.key] = value;
          }
        }
      }
      setAssignments(next);
      setDraftNotice('已恢复草稿，请核对师傅');
    } catch {
      setDraftNotice('草稿无法读取，请重新选择师傅');
    }
  }

  if (state?.ok) {
    return (
      <section ref={resultRef} tabIndex={-1} aria-label="排单结果" className="min-w-0 space-y-4">
        <ActionNotice tone="success" title={state.message} />
        <ul className="min-w-0 divide-y">
          {orders.map(order => (
            <li key={order.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
              <span className="admin-wrap-anywhere min-w-0">{order.name}</span>
              <Link href={`/orders/${order.id}#detail-production-records`}
                aria-label={`${order.name}：查看排单结果`}
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
                查看排单结果
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/orders?queue=production" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
          返回工单列表
        </Link>
      </section>
    );
  }

  return (
    <form ref={formRef} action={action} aria-busy={pending} className="min-w-0 space-y-5"
      onSubmit={() => { submittedDraftKey.current = draftKey; }}
      // A failed action is still a resolved action: retain the controlled selection for retry.
      onReset={event => event.preventDefault()}>
      <input type="hidden" name="payload" value={JSON.stringify({ requestKey, orders: orders.map(order => ({ id: order.id, revision: order.revision, version: order.version, assignments: assignments[order.id] })) })} />
      {orders.map(order => (
        <fieldset key={order.id} disabled={pending || reviewing} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
          <legend className="px-1 font-semibold">{order.name} · v{order.version}</legend>
          {order.tasks.map((task, index) => (
            <div key={task.key} className="grid min-w-0 items-center gap-2 sm:grid-cols-2">
              <label htmlFor={`${order.id}-${index}`} className="break-words">{task.label} · {task.quantity} 个</label>
              <NativeSelect id={`${order.id}-${index}`} disabled={task.locked}
                value={assignments[order.id]?.[task.key] ?? ''}
                onChange={event => setAssignments(current => ({ ...current, [order.id]: { ...current[order.id], [task.key]: event.target.value } }))}
                required>
                <option value="">选择生产师傅</option>
                {task.options.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
              </NativeSelect>
              {task.options.length === 0 && <p className="text-sm text-destructive sm:col-span-2">没有符合此工序的在职师傅，请先在员工管理中配置师傅岗位。</p>}
            </div>
          ))}
        </fieldset>
      ))}
      {reviewing ? (
        <Card>
          <CardHeader><h2 ref={reviewHeadingRef} tabIndex={-1} className="font-semibold">发布排单</h2></CardHeader>
          <CardContent className="space-y-3">
            <p>所选师傅负责对应生产；新安排的工单同时生成打印任务。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={pending}>{pending ? '正在发布…' : '发布排单'}</Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setReviewing(false)}>返回修改</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!complete && !pending ? <DisabledReason cause="prerequisite" reason="每道工序都指派师傅后才能核对排单。">
            <Button type="button" className="min-h-11" disabled>核对排单</Button>
          </DisabledReason> : <Button type="button" className="min-h-11" disabled={pending} onClick={() => setReviewing(true)}>核对排单</Button>}
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => {
            localStorage.setItem(draftKey, JSON.stringify(assignments));
            setDraftNotice('草稿已保存到本机');
          }}>保存草稿</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={restoreDraft}>恢复草稿</Button>
        </div>
      )}
      {state?.message || draftNotice ? <ActionNotice tone={state && !state.ok ? 'error' : 'info'} title={state?.message ?? draftNotice} /> : null}
      <PendingLink pending={pending} href="/orders?queue=production"
        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
        返回工单列表
      </PendingLink>
    </form>
  );
}
