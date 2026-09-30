'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog, type PageHeaderBack } from '@/components/ui-business';
import { Button } from '@/components/ui/button';
import { useOrderFormLeaveGuard } from './use-order-form-leave-guard';

export type LocalDraftSaveFailure = 'unserializable' | 'storage' | 'unavailable';
export type OrderLeaveState = {
  /** Visibility never implies persistence. Hidden editors retain their reports. */
  active: boolean;
  /** Current content differs from the last successfully persisted content. */
  dirty: boolean;
  pendingFileCount: number;
  submitted: boolean;
  busy: boolean;
};

type LeaveContextValue = {
  report: (key: string, state: OrderLeaveState | null) => void;
  setPersist: (key: string, persist: (() => LocalDraftSaveFailure | null) | undefined) => void;
  guard: (href: string) => (event: { preventDefault(): void }) => void;
  navigate: (href: string) => void;
  finishOrder: (key: string) => void;
  pending: boolean;
};
const OrderCreationLeaveContext = createContext<LeaveContextValue | null>(null);
const FAILURE_TEXT: Record<LocalDraftSaveFailure, string> = {
  storage: '浏览器无法写入本机草稿（存储已关闭或空间已满）',
  unserializable: '表单内容无法存为本机草稿',
  unavailable: '当前内容暂时无法保存，请留在本页重试',
};
const subject = (label: string) => (label === '本单' ? label : `${label} `);
const belongsTo = (key: string, orderId: string) => key === orderId || key.startsWith(`${orderId}:`);

function planOrderCreationLeave(
  reports: Readonly<Record<string, OrderLeaveState>>,
  labelFor: (key: string) => string,
  removedFileCount = 0,
) {
  const fileLines: string[] = [];
  const draftKeys: string[] = [];
  const draftLines: string[] = [];
  let busy = false;
  for (const [key, state] of Object.entries(reports)) {
    busy ||= state.busy;
    if (state.submitted) continue;
    const label = labelFor(key);
    if (state.pendingFileCount > 0) {
      fileLines.push(`${label === '本单' ? '本单' : `${label} 的`} ${state.pendingFileCount} 个未上传的设计文件将丢失。`);
    }
    if (state.dirty) {
      draftKeys.push(key);
      draftLines.push(`${subject(label)}已填写的内容将保存为本机草稿。`);
    }
  }
  if (removedFileCount > 0) fileLines.push(`已移除的工单中 ${removedFileCount} 个未上传的设计文件将丢失。`);
  return { guarded: fileLines.length > 0 || draftKeys.length > 0, busy, losesFiles: fileLines.length > 0, fileLines, draftKeys, draftLines };
}

type Failure = { href: string | null; failed: Record<string, LocalDraftSaveFailure> };

/** One coordinator for batch navigation, persistence failures and browser unload. */
export function useOrderCreationLeave({ labelFor, removedFileCount = 0, enabled = true }: {
  labelFor: (key: string) => string;
  removedFileCount?: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  const [reports, setReports] = useState<Record<string, OrderLeaveState>>({});
  const reportsRef = useRef(reports);
  const persists = useRef(new Map<string, () => LocalDraftSaveFailure | null>());
  const [target, setTarget] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const plan = planOrderCreationLeave(reports, labelFor, removedFileCount);
  useOrderFormLeaveGuard(enabled && (plan.guarded || plan.busy));

  const report = useCallback((key: string, state: OrderLeaveState | null) => {
    const current = reportsRef.current;
    const previous = current[key];
    if (!state && !previous) return;
    if (state && previous && (Object.keys(state) as (keyof OrderLeaveState)[]).every((field) => previous[field] === state[field])) return;
    const next = { ...current };
    if (state) next[key] = state;
    else delete next[key];
    reportsRef.current = next;
    setReports(next);
  }, []);
  const setPersist = useCallback((key: string, persist: (() => LocalDraftSaveFailure | null) | undefined) => {
    if (persist) persists.current.set(key, persist);
    else persists.current.delete(key);
  }, []);
  const finishOrder = useCallback((orderId: string) => {
    for (const [key, state] of Object.entries(reportsRef.current)) {
      if (belongsTo(key, orderId)) report(key, { ...state, dirty: false, pendingFileCount: 0, busy: false, submitted: true });
    }
  }, [report]);
  function currentPlan() { return planOrderCreationLeave(reportsRef.current, labelFor, removedFileCount); }
  function rememberSource() {
    sourceRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  function restoreFocus() {
    window.requestAnimationFrame(() => {
      const source = sourceRef.current;
      if (source?.isConnected && !source.closest('[hidden], [inert]')) { source.focus(); return; }
      document.querySelector<HTMLElement>('[data-order-form-host] input:not(:disabled), [data-order-form-host] select:not(:disabled), [data-slot="page-header"] a')?.focus();
    });
  }
  function dismissFailure() { setFailure(null); restoreFocus(); }
  const guard = (href: string) => (event: { preventDefault(): void }) => {
    const latest = currentPlan();
    if (latest.busy) { event.preventDefault(); return; }
    if (!latest.guarded) return;
    event.preventDefault();
    rememberSource();
    setFailure(null);
    setTarget(href);
  };
  const navigate = (href: string) => {
    let prevented = false;
    guard(href)({ preventDefault: () => { prevented = true; } });
    if (!prevented) router.push(href);
  };

  /** Failure blocks both leaving the page and changing/removing the active slot. */
  function saveDrafts(orderId?: string, href: string | null = null) {
    const latest = currentPlan();
    if (latest.busy) return false;
    const failed: Failure['failed'] = {};
    for (const key of latest.draftKeys.filter((key) => !orderId || belongsTo(key, orderId))) {
      let reason: LocalDraftSaveFailure | null;
      const persist = persists.current.get(key);
      try { reason = persist ? persist() : 'unavailable'; }
      catch { reason = 'storage'; }
      if (reason) failed[key] = reason;
      else report(key, { ...reportsRef.current[key], dirty: false });
    }
    if (Object.keys(failed).length) {
      if (!href) rememberSource();
      setFailure({ href, failed });
      return false;
    }
    setFailure(null);
    return true;
  }
  const failedKeys = failure ? Object.keys(failure.failed).filter((key) => reports[key]?.dirty && !reports[key]?.submitted) : [];
  const visibleFailure = failure && failedKeys.length > 0 ? failure : null;
  useEffect(() => {
    if (!failure || failedKeys.length > 0) return;
    const frame = window.requestAnimationFrame(() => setFailure(null));
    return () => window.cancelAnimationFrame(frame);
  }, [failure, failedKeys.length]);
  const losses = [...plan.draftKeys.map((key) => `${subject(labelFor(key))}已填写的内容`), ...plan.fileLines.map((line) => line.replace(/将丢失。$/, ''))];
  const context: LeaveContextValue = { report, setPersist, guard, navigate, finishOrder, pending: plan.busy };
  const dialog: ReactNode = <>
    {visibleFailure ? <ActionNotice tone="error" title="本机草稿未保存，仍在本页"
      description={<>
        {failedKeys.map((key) => <p key={key}>{labelFor(key)}：{FAILURE_TEXT[visibleFailure.failed[key]]}。</p>)}
        {visibleFailure.href ? <p>可以留在本页继续填写并保存工单；仍然离开将丢失：{losses.join('、')}。</p> : null}
      </>}
      action={<div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={dismissFailure}>留在本页</Button>
        {visibleFailure.href ? <span className="inline-flex rounded-md bg-background"><Button type="button" variant="destructive" className="min-h-11" disabled={plan.busy}
          onClick={() => { const href = visibleFailure.href; if (!href || currentPlan().busy) return; setFailure(null); router.push(href); }}>仍然离开</Button></span> : null}
      </div>} /> : null}
    <ConfirmActionController level="L2" open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}
      focusReturnRef={sourceRef} disabled={plan.busy} cancelLabel="继续编辑" onConfirm={() => { if (target && saveDrafts(undefined, target)) router.push(target); }}>
      <ConfirmActionDialog action={plan.losesFiles ? '放弃修改并离开' : '保存草稿并离开'} changes={[]}
        consequences={[...plan.fileLines, ...plan.draftLines]}
        confirmText={plan.losesFiles ? '放弃修改并离开' : '保存草稿并离开'} danger={plan.losesFiles} />
    </ConfirmActionController>
  </>;
  return {
    context, dialog, pending: plan.busy, guard, saveDrafts,
    back: (href: string, label: string): PageHeaderBack => ({ href, label, pending: plan.busy, onNavigate: guard(href) }),
    Provider: OrderCreationLeaveContext.Provider,
  };
}

/** Standalone editors use exactly the same protection as the batch workspace. */
export function OrderCreationLeaveBoundary({ children }: { children: ReactNode }) {
  const parent = useContext(OrderCreationLeaveContext);
  const local = useOrderCreationLeave({ labelFor: () => '本单', enabled: !parent });
  if (parent) return children;
  return <local.Provider value={local.context}>{local.dialog}{children}</local.Provider>;
}

export function useOrderLeaveNavigation() {
  return useContext(OrderCreationLeaveContext);
}

export function useOrderLeaveReport(
  key: string | undefined,
  state: OrderLeaveState,
  persistDraft?: () => LocalDraftSaveFailure | null,
) {
  const context = useContext(OrderCreationLeaveContext);
  const report = context?.report;
  const setPersist = context?.setPersist;
  const { active, dirty, pendingFileCount, submitted, busy } = state;
  // Layout reporting closes the render/effect gap for navigation and completion callbacks.
  useLayoutEffect(() => {
    if (key) report?.(key, { active, dirty, pendingFileCount, submitted, busy });
  }, [report, key, active, dirty, pendingFileCount, submitted, busy]);
  useLayoutEffect(() => {
    if (!key) return;
    return () => report?.(key, null);
  }, [report, key]);
  useLayoutEffect(() => { if (key) setPersist?.(key, persistDraft); });
  useLayoutEffect(() => {
    if (!key) return;
    return () => setPersist?.(key, undefined);
  }, [setPersist, key]);
  return {
    ...context,
    back: (href: string, label: string): PageHeaderBack => ({ href, label, pending: context?.pending ?? busy, onNavigate: context?.guard(href) }),
  };
}

/** Dispatch completion after every mounted reporter has published its settled state. */
export function useOrderCompletion<T>(value: T | null, busy: boolean, onComplete: (value: T) => void) {
  useEffect(() => {
    if (value === null || busy) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) onComplete(value); });
    return () => { cancelled = true; };
  }, [value, busy, onComplete]);
}
