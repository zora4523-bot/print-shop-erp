'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrderFormLeaveGuard } from './use-order-form-leave-guard';
import { Button } from '@/components/ui/button';
import { OrderForm, type OrderFormProps } from './OrderForm';
import type { OrderCreatedEntry, OrderCreationEditor, OrderEditorSnapshot } from './order-creation-editor';

type Entry = { id: string; primary?: boolean; created?: OrderCreatedEntry; done?: boolean; recovered?: boolean };
const MAX_BATCH_ORDERS = 10;

function readEntries(key: string): Entry[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (Array.isArray(data) && data.length > 0 && data.length <= MAX_BATCH_ORDERS && data.every((entry) =>
      entry && typeof entry.id === 'string' && /^[\da-f-]{36}$/i.test(entry.id) &&
      (!entry.created || (typeof entry.created.orderId === 'string' && typeof entry.created.orderNo === 'string' && ['draft', 'fees', 'submit'].includes(entry.created.intent))),
    ) && new Set(data.map((entry) => entry.id)).size === data.length) {
      return data.map((entry) => ({ ...entry, recovered: Boolean(entry.created) }));
    }
  } catch { /* The editor remains usable when session storage is unavailable. */ }
  return [{ id: crypto.randomUUID(), primary: true }];
}

/**
 * 审查 #47：切换工单标签时，`editor.save()` 必须同步执行——OrderForm 以
 * `key={active.id}` 挂载，切换后旧表单立即卸载，推迟到空闲就读不到它的状态。
 * 能推迟的只有 sessionStorage 持久化（条目列表本身没变，只是再落一次盘），
 * 这里放到空闲回调里，让切换的那一帧只做快照 + 重渲染。
 * `<Activity>` 保活各张表单已评估、暂不采用：隐藏态会卸载 effect，OrderForm
 * 的 registerEditor / 草稿自动保存 / 离开守卫都依赖 effect，需改 OrderForm 内部。
 */
function whenIdle(task: () => void) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 1000 });
  } else {
    window.setTimeout(task, 0);
  }
}

/** Each slot uses the existing authorized create/quote/submit flow and a stable command ID. */
export function OrderCreationWorkspace(props: OrderFormProps) {
  const storageKey = `order-creation-batch:v1:${props.draftScope}:${props.workbenchTransferId ?? 'new'}`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState('');
  const [locked, setLocked] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [removed, setRemoved] = useState<Entry | null>(null);
  const [storageError, setStorageError] = useState(false);
  const editor = useRef<OrderCreationEditor | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, OrderEditorSnapshot>>({});
  const entriesRef = useRef<Entry[]>([]);
  const active = entries.find((entry) => entry.id === activeId);
  const showResult = Boolean(active?.done || active?.recovered);
  const navigationLocked = locked || sampleBusy || Boolean(active?.created && !showResult);
  useOrderFormLeaveGuard(Object.values(snapshots).some((snapshot) => snapshot.files.some((files) => files.length > 0)));

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const restored = readEntries(storageKey);
      try { sessionStorage.setItem(storageKey, JSON.stringify(restored)); } catch { setStorageError(true); }
      entriesRef.current = restored;
      setEntries(restored);
      setActiveId(restored.find((entry) => !entry.created)?.id ?? restored[0].id);
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  const saveEntries = useCallback((next: Entry[]) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch { setStorageError(true); }
    entriesRef.current = next;
    setEntries(next);
  }, [storageKey]);

  const registerEditor = useCallback((value: OrderCreationEditor | null) => {
    editor.current = value;
    if (value) setLocked(!value.canLeave);
  }, []);

  function retainCurrent() {
    if (showResult) return true;
    if (!editor.current?.canLeave || navigationLocked) return false;
    const snapshot = editor.current.save();
    setSnapshots((current) => ({ ...current, [activeId]: snapshot }));
    return true;
  }

  function addOrder() {
    if (!retainCurrent() || entries.length >= MAX_BATCH_ORDERS) return;
    const entry = { id: crypto.randomUUID() };
    saveEntries([...entries, entry]);
    setActiveId(entry.id);
    setLocked(false);
  }

  function removeCurrent() {
    if (entries.length <= 1 || active?.created || !retainCurrent()) return;
    const next = entries.filter((entry) => entry.id !== activeId);
    setRemoved(active ?? null);
    saveEntries(next);
    setActiveId(next[0].id);
  }

  function created(result: OrderCreatedEntry) {
    saveEntries(entriesRef.current.map((entry) => entry.id === activeId ? { ...entry, created: result } : entry));
    setLocked(true);
  }

  function completed(result: OrderCreatedEntry) {
    if (entriesRef.current.length === 1) {
      try { sessionStorage.removeItem(storageKey); } catch { setStorageError(true); }
      return;
    }
    const next = entriesRef.current.map((entry) => entry.id === activeId
      ? { ...entry, done: true, created: { ...result, orderNo: entry.created?.orderNo ?? result.orderNo } }
      : entry);
    saveEntries(next);
    setSnapshots((current) => { const next = { ...current }; delete next[activeId]; return next; });
    setLocked(false);
    const unfinished = next.find((entry) => !entry.created && !entry.done);
    if (unfinished) setActiveId(unfinished.id);
  }

  const canStartNextBatch = entries.length > 0 && entries.every((entry) => entry.created) && showResult && !sampleBusy;

  function startNextBatch() {
    if (!canStartNextBatch) return;
    const entry = { id: crypto.randomUUID() };
    saveEntries([entry]);
    setActiveId(entry.id);
    setRemoved(null);
    setSnapshots({});
    setLocked(false);
  }

  if (!active) return <p role="status" className="p-4 text-sm text-muted-foreground">正在恢复建单草稿…</p>;
  return <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-4">
    <section aria-label="批量新建工单" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={(!showResult && navigationLocked) || entries.length >= MAX_BATCH_ORDERS} onClick={addOrder}>＋ 添加工单</Button>
        {entries.length > 1 && !active.created ? <Button type="button" variant="outline" disabled={navigationLocked} onClick={removeCurrent}>移除当前工单</Button> : null}
        {removed ? <Button type="button" variant="outline" disabled={navigationLocked || entries.length >= MAX_BATCH_ORDERS}
          onClick={() => { if (!retainCurrent()) return; saveEntries([...entries, removed]); setActiveId(removed.id); setRemoved(null); }}>撤销移除</Button> : null}
        {canStartNextBatch ? <Button type="button" variant="outline" onClick={startNextBatch}>开始新一批</Button> : null}
        <span className="text-sm text-muted-foreground">已完成 {entries.filter((entry) => entry.done).length} / {entries.length} 张</span>
      </div>
      <p className="text-xs text-muted-foreground">每张工单独立填写地址、设计款和费用，逐张核对后创建。创建成功后继续下一张。</p>
      <nav aria-label="待建工单" className="flex flex-wrap gap-2">
        {entries.map((entry, index) => <Button key={entry.id} type="button" variant={entry.id === activeId ? 'selected' : 'outline'}
          disabled={!showResult && navigationLocked && entry.id !== activeId} aria-pressed={entry.id === activeId}
          onClick={() => { if (entry.id !== activeId && retainCurrent()) { setActiveId(entry.id); setLocked(false); whenIdle(() => saveEntries(entriesRef.current)); } }}>
          工单 {index + 1}{entry.done ? ' · 已完成' : entry.created ? ' · 已保存' : ''}
        </Button>)}
      </nav>
      {storageError ? <p role="alert" className="text-sm text-destructive">本次批量列表未能保存，请完成当前操作后再关闭页面。</p> : null}
      {entries.length >= MAX_BATCH_ORDERS ? <p role="status" className="text-sm text-muted-foreground">本批已达 {MAX_BATCH_ORDERS} 张，全部保存后可开始新一批。</p> : null}
      {canStartNextBatch && entries.some((entry) => !entry.done) ? <p className="text-sm text-muted-foreground">工单均已保存，未完成的上传或提交可从工单详情继续。</p> : null}
    </section>
    {showResult && active.created ? <section className="space-y-3 rounded-xl border bg-card p-5" role="status">
      <h2 className="text-lg font-semibold">{active.done ? '工单已创建' : '工单已保存，请继续完善'}</h2>
      <p>{active.created.orderNo}</p>
      {!active.done ? <p className="text-sm text-muted-foreground">请到工单详情核对文件、费用和提交状态，继续处理已有工单。</p> : null}
      <Link className="inline-flex min-h-11 items-center underline" href={`/orders/${active.created.orderId}${active.created.intent === 'fees' ? '#admin-fee-editor' : ''}`}>查看工单{active.created.intent === 'fees' ? '并编辑收费' : ''}</Link>
    </section> : <OrderForm {...props} key={active.id}
      draftScope={active.primary ? props.draftScope : `${props.draftScope}:batch:${active.id}`}
      workbenchTransferId={active.primary ? props.workbenchTransferId : undefined}
      submissionId={active.id} initialEditor={snapshots[active.id]} registerEditor={registerEditor}
      lifecycle={{ submissionId: active.id, retainResult: entries.length > 1, onCreated: created, onCompleted: completed, onBusyChange: setSampleBusy }} />}
  </div>;
}
