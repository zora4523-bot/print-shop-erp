'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog, type PageHeaderBack } from '@/components/ui-business';
import { Button } from '@/components/ui/button';
import { shouldProtectOrderFormLeave, useOrderFormLeaveGuard } from './use-order-form-leave-guard';

/**
 * 新建工单页的离开保护，整批只有一处（Codex 对抗审查 2026-09-30 第三轮）。
 *
 * 工作台持有「整批是否有会丢失的内容」：每张保活的 OrderForm 与打样入口各自上报
 * 未保存改动、未上传文件、提交 / 上传进行中；工作台内所有站内离开入口（各分支页头返回、
 * 结果页「查看工单」）都经过同一个 `guard(href)`，确认层与保存失败提示也只在工作台层渲染，
 * 不随分支卸载。`beforeunload` 用同一口径，由工作台统一挂载；站内链接走 Next 客户端导航，
 * 不会触发 `beforeunload`，因此不会重复弹出。Cmd/Ctrl 新标签打开时 Next 不调用 onNavigate。
 */
export type LocalDraftSaveFailure = 'unserializable' | 'storage';

export type OrderLeaveState = {
  /** 当前显示的工单（未保存改动只对当前工单拦截；其余工单切换时已落草稿）。 */
  active: boolean;
  dirty: boolean;
  pendingFileCount: number;
  submitted: boolean;
  /** 提交或上传进行中：返回锁定，不弹确认。 */
  busy: boolean;
};

type LeaveContextValue = {
  report: (key: string, state: OrderLeaveState | null) => void;
  setPersist: (key: string, persist: (() => LocalDraftSaveFailure | null) | undefined) => void;
  guard: (href: string) => (event: { preventDefault(): void }) => void;
  pending: boolean;
};

const OrderCreationLeaveContext = createContext<LeaveContextValue | null>(null);

const FAILURE_TEXT: Record<LocalDraftSaveFailure, string> = {
  storage: '浏览器无法写入本机草稿（存储已关闭或空间已满）',
  unserializable: '表单内容无法存为本机草稿',
};

/** 「本单」直接接后文；「工单 N」后加空格，读作「工单 2 已填写…」。 */
const subject = (label: string) => (label === '本单' ? label : `${label} `);

type Plan = {
  losesFiles: boolean;
  fileLines: string[];
  draftKeys: string[];
  draftLines: string[];
};

/** 按实际状态列出离开的后果：哪些未上传文件会丢、哪些工单的填写会先存为本机草稿。 */
export function planOrderCreationLeave(
  reports: Readonly<Record<string, OrderLeaveState>>,
  labelFor: (key: string) => string,
  removedFileCount = 0,
): Plan & { guarded: boolean; busy: boolean } {
  const fileLines: string[] = [];
  const draftKeys: string[] = [];
  const draftLines: string[] = [];
  let guarded = removedFileCount > 0;
  let busy = false;
  for (const [key, state] of Object.entries(reports)) {
    busy ||= state.busy;
    if (state.submitted) continue;
    const label = labelFor(key);
    if (state.pendingFileCount > 0) {
      guarded = true;
      fileLines.push(`${label === '本单' ? '本单' : `${label} 的`} ${state.pendingFileCount} 个未上传的设计文件将丢失。`);
    }
    if (state.dirty) {
      draftKeys.push(key);
      guarded ||= shouldProtectOrderFormLeave({ enabled: state.active, dirty: true, pendingFileCount: 0, submitted: false });
      draftLines.push(`${subject(label)}已填写的内容将保存为本机草稿。`);
    }
  }
  if (removedFileCount > 0) fileLines.push(`已移除的工单中 ${removedFileCount} 个未上传的设计文件将丢失。`);
  return { guarded, busy, losesFiles: fileLines.length > 0, fileLines, draftKeys, draftLines };
}

type Failure = { href: string; reasons: string[]; losses: string[] };

/**
 * 工作台调用：返回 Provider 包裹器、页头返回 props、链接守卫与确认层（含保存失败提示）。
 * `labelFor` 把上报 key（工单 id，可带 `:sample` 后缀）翻译成「本单」/「工单 N」。
 */
export function useOrderCreationLeave({ labelFor, removedFileCount = 0 }: {
  labelFor: (key: string) => string;
  removedFileCount?: number;
}) {
  const router = useRouter();
  const [reports, setReports] = useState<Record<string, OrderLeaveState>>({});
  const persists = useRef(new Map<string, () => LocalDraftSaveFailure | null>());
  const [target, setTarget] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const plan = planOrderCreationLeave(reports, labelFor, removedFileCount);
  useOrderFormLeaveGuard(plan.guarded || plan.busy);

  const report = useCallback((key: string, state: OrderLeaveState | null) => {
    setReports((current) => {
      if (!state) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      const previous = current[key];
      if (previous && (Object.keys(state) as (keyof OrderLeaveState)[]).every((field) => previous[field] === state[field])) return current;
      return { ...current, [key]: state };
    });
  }, []);
  const setPersist = useCallback((key: string, persist: (() => LocalDraftSaveFailure | null) | undefined) => {
    if (persist) persists.current.set(key, persist);
    else persists.current.delete(key);
  }, []);

  const { guarded, busy } = plan;
  const guard = (href: string) => (event: { preventDefault(): void }) => {
    if (busy) { event.preventDefault(); return; }
    if (!guarded) return;
    event.preventDefault();
    sourceRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFailure(null);
    setTarget(href);
  };
  const context: LeaveContextValue = { report, setPersist, guard, pending: busy };

  function confirmLeave(href: string) {
    const reasons: string[] = [];
    for (const key of plan.draftKeys) {
      const failed = persists.current.get(key)?.() ?? null;
      if (failed) reasons.push(`${labelFor(key)}：${FAILURE_TEXT[failed]}。`);
    }
    if (reasons.length) {
      setFailure({ href, reasons, losses: [...plan.draftKeys.map((key) => `${subject(labelFor(key))}已填写的内容`), ...plan.fileLines.map((line) => line.replace(/将丢失。$/, ''))] });
      return;
    }
    router.push(href);
  }

  const dialog: ReactNode = <>
    {failure ? <ActionNotice tone="error" title="本机草稿未保存，仍在本页"
      description={<>
        {failure.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        <p>可以留在本页继续填写并保存工单；仍然离开将丢失：{failure.losses.join('、')}。</p>
      </>}
      action={<div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setFailure(null)}>留在本页</Button>
        <Button type="button" variant="destructive" className="min-h-11" onClick={() => { const { href } = failure; setFailure(null); router.push(href); }}>仍然离开</Button>
      </div>} /> : null}
    <ConfirmActionController level="L2" open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}
      focusReturnRef={sourceRef} cancelLabel="继续编辑" onConfirm={() => { if (target) confirmLeave(target); }}>
      <ConfirmActionDialog
        action={plan.losesFiles ? '放弃修改并离开' : '保存草稿并离开'}
        changes={[]}
        consequences={[...plan.fileLines, ...plan.draftLines]}
        confirmText={plan.losesFiles ? '放弃修改并离开' : '保存草稿并离开'}
        danger={plan.losesFiles}
      />
    </ConfirmActionController>
  </>;

  return {
    context,
    dialog,
    pending: busy,
    guard,
    back: (href: string, label: string): PageHeaderBack => ({ href, label, pending: busy, onNavigate: guard(href) }),
    Provider: OrderCreationLeaveContext.Provider,
  };
}

/**
 * 表单 / 打样入口调用：上报本分支的离开状态，并取得统一的页头返回。
 * 不在工作台内（单测直接挂 OrderForm）时退回本分支自己的 `beforeunload` 与提交锁。
 */
export function useOrderLeaveReport(
  key: string | undefined,
  state: OrderLeaveState,
  persistDraft?: () => LocalDraftSaveFailure | null,
) {
  const context = useContext(OrderCreationLeaveContext);
  const report = context && key ? context.report : null;
  const setPersist = context && key ? context.setPersist : null;
  const { active, dirty, pendingFileCount, submitted, busy } = state;
  useEffect(() => {
    if (!report || !key) return;
    report(key, { active, dirty, pendingFileCount, submitted, busy });
  }, [report, key, active, dirty, pendingFileCount, submitted, busy]);
  useEffect(() => {
    if (!report || !key) return;
    return () => report(key, null);
  }, [report, key]);
  useEffect(() => {
    if (!setPersist || !key) return;
    setPersist(key, persistDraft);
  });
  useEffect(() => {
    if (!setPersist || !key) return;
    return () => setPersist(key, undefined);
  }, [setPersist, key]);
  useOrderFormLeaveGuard(!report && shouldProtectOrderFormLeave({ enabled: active, dirty, pendingFileCount, submitted }));
  return {
    back: (href: string, label: string): PageHeaderBack => report && context
      ? { href, label, pending: context.pending, onNavigate: context.guard(href) }
      : { href, label, pending: busy },
  };
}
