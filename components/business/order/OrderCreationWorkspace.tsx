'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
 * 审查 #47：批量建单切换工单时保留各张表单实例，不再 `key={active.id}` 重建。
 *
 * 取舍（方案 A `<Activity>` vs 方案 B 全挂载 + `hidden`，最终为 B 的变体）：
 * - `<Activity mode="hidden">` 会卸载 effect；OrderForm 的草稿自动保存、离开守卫、
 *   registerEditor 都要改成「重新可见时再启」，而隐藏态 DOM 仍留在文档里。
 * - 两种方案都把非当前表单留在文档里，而 OrderForm / OrderFormB 大量使用静态 id
 *   （`customName`、`externalSalesUserId`、`items.0.name`…）。重复 id 会让
 *   label 关联、FormErrorSummary / 跨工单错误跳转（getElementById）命中别的表单。
 * - 因此每张表单渲染进自己的常驻宿主节点（portal），只有当前工单的宿主被挂进
 *   文档；其余宿主脱离文档保活。React 实例、react-hook-form 状态、effect 全部保留，
 *   文档里任何时刻只有一张表单：id 唯一、只提交/校验/播报当前表单、隐藏实例不可聚焦。
 * - 副作用以 `active` 控制：只有当前实例登记 editor、挂离开守卫；自动保存照常
 *   （各自 draftScope 独立）。切换前仍同步调用 `editor.save()`：它落本地草稿，
 *   并给工作台的「未上传文件」离开守卫与「撤销移除」后的重挂载提供快照。
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
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
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

  function created(entryId: string, result: OrderCreatedEntry) {
    saveEntries(entriesRef.current.map((entry) => entry.id === entryId ? { ...entry, created: result } : entry));
    setLocked(true);
  }

  function completed(entryId: string, result: OrderCreatedEntry) {
    if (entriesRef.current.length === 1) {
      try { sessionStorage.removeItem(storageKey); } catch { setStorageError(true); }
      return;
    }
    const next = entriesRef.current.map((entry) => entry.id === entryId
      ? { ...entry, done: true, created: { ...result, orderNo: entry.created?.orderNo ?? result.orderNo } }
      : entry);
    saveEntries(next);
    setSnapshots((current) => { const next = { ...current }; delete next[entryId]; return next; });
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

  const liveEntries = entries.filter((entry) => !entry.done && !entry.recovered);
  const formVisible = Boolean(active && !(showResult && active.created));
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
    </section> : null}
    <div ref={setSlot} className="min-w-0" data-slot="order-creation-active-form" />
    {liveEntries.map((entry) => <KeptAliveOrderForm key={entry.id} id={entry.id} slot={slot} active={formVisible && entry.id === activeId}
      snapshot={snapshots[entry.id]} render={(active, initialEditor) => <OrderForm {...props}
        draftScope={entry.primary ? props.draftScope : `${props.draftScope}:batch:${entry.id}`}
        workbenchTransferId={entry.primary ? props.workbenchTransferId : undefined}
        submissionId={entry.id} initialEditor={initialEditor} registerEditor={registerEditor} active={active}
        lifecycle={{ submissionId: entry.id, retainResult: entries.length > 1, onCreated: (result) => created(entry.id, result),
          onCompleted: (result) => completed(entry.id, result), onBusyChange: (busy) => { if (entry.id === activeId) setSampleBusy(busy); } }} />} />)}
  </div>;
}

/**
 * 常驻宿主：节点随组件创建一次，只在 active 时挂进工作台的表单槽，否则脱离文档保活。
 * initialEditor 在首次挂载时冻结——OrderForm 只在挂载时读它，之后的快照不回灌存活实例。
 */
function KeptAliveOrderForm({ id, slot, active, snapshot, render }: {
  id: string; slot: HTMLElement | null; active: boolean; snapshot?: OrderEditorSnapshot;
  render: (active: boolean, initialEditor?: OrderEditorSnapshot) => ReactNode;
}) {
  const [node] = useState(() => {
    const element = document.createElement('div');
    element.className = 'min-w-0';
    element.dataset.orderFormHost = id;
    return element;
  });
  const [initialEditor] = useState(snapshot);
  useLayoutEffect(() => {
    if (!active || !slot) return;
    slot.append(node);
    return () => node.remove();
  }, [active, node, slot]);
  return createPortal(render(active, initialEditor), node);
}
