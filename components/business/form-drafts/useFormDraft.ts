'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { getFormCreationStatusAction, resolveSupplementAction } from '@/actions/form-drafts';
import { FORM_PATHS, type FormDraftContext, type FormDraftPayload, type StoredDraft, type SupplementContext } from '@/lib/form-drafts/model';
import { completedDraftIdentity, completeDraft, listDrafts, saveDraft } from '@/lib/form-drafts/storage';
import { readSupplementContext, supplementCreateHref } from '@/lib/form-drafts/return-context';
import { claimDraft } from '@/lib/form-drafts/ownership';

type CreationStatus = Awaited<ReturnType<typeof getFormCreationStatusAction>>;
const storageMessage = '无法暂存当前内容，请在新标签页补充资料；返回后点击“更新可选资料”。';

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 8000); })])
    .finally(() => clearTimeout(timer));
}

function applySupplement<T extends FormDraftPayload>(payload: T, context: SupplementContext, entityId: string): T | null {
  if (context.origin === 'purchase-new' && 'supplierPartyId' in payload) return { ...payload, [context.target]: entityId };
  if (context.origin === 'bom-new' && 'rows' in payload) {
    if (context.target === 'categoryNodeId') return { ...payload, categoryNodeId: entityId };
    const rowId = context.target.slice(4);
    if (!payload.rows.some((row) => row.rowId === rowId)) return null;
    return { ...payload, rows: payload.rows.map((row) => row.rowId === rowId ? { ...row, materialId: entityId } : row) };
  }
  return null;
}

function captureNativeInput<T extends FormDraftPayload>(form: HTMLFormElement | null, initial: T): T {
  if (!form) return initial;
  const value = (name: string, fallback: string) => {
    const field = form.elements.namedItem(name);
    return field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? field.value : fallback;
  };
  const fields = Object.fromEntries(Object.entries(initial).filter(([, field]) => typeof field === 'string').map(([key, field]) => [key, value(key, String(field))]));
  return { ...initial, ...fields, ...('rows' in initial ? { rows: initial.rows.map((row, index) => ({
    rowId: row.rowId, materialId: value(`items.${index}.materialId`, row.materialId),
    quantity: value(`items.${index}.quantity`, row.quantity), remark: value(`items.${index}.remark`, row.remark),
  })) } : {}) };
}

export function useFormDraft<T extends FormDraftPayload>(initialContext: FormDraftContext, initialPayload: T, formRef: RefObject<HTMLFormElement | null>) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [identity, setIdentity] = useState(initialContext);
  const [candidate, setCandidate] = useState<StoredDraft | null>(null);
  const [status, setStatus] = useState<CreationStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [fallbackHref, setFallbackHref] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [completed, setCompleted] = useState(false);
  const current = useRef({ identity: initialContext, payload: initialPayload });
  const initialized = useRef(false);
  const freshIdentityStarted = useRef(false);
  const editedDuringMount = useRef(false);
  const finished = useRef(false);
  const owner = useRef<ReturnType<typeof claimDraft> | null>(null);
  const mounted = useRef(false);
  const conflictSeen = useRef(false);
  const markConflict = () => { conflictSeen.current = true; setConflict(true); };

  function write(next: T, context = current.current.identity, supplement: SupplementContext | null = null) {
    if (finished.current) return false;
    try {
      const saved = saveDraft(sessionStorage, { ...context, schemaVersion: 1, savedAt: Date.now(), payload: next, supplement } as StoredDraft);
      if (!saved) {
        finished.current = true; setCompleted(true);
        setMessage('这份录入已经保存，请查看已创建单据或另建一单。');
        void check({ ...context, payload: next, supplement: null, schemaVersion: 1, savedAt: Date.now() } as StoredDraft);
      }
      if (saved && !supplement) {
        const query = new URLSearchParams(window.location.search);
        if (!query.has('draft') && !query.has('form_origin')) consumeReturn(context);
      }
      return saved;
    } catch { setMessage(storageMessage); return false; }
  }

  function install(next: T, context: FormDraftContext) {
    current.current = { identity: context, payload: next };
    setIdentity(context);
    setPayload(next);
  }

  function consumeReturn(context: FormDraftContext) {
    // Null lets Next copy its bookkeeping AND synchronize the canonical URL.
    window.history.replaceState(null, '', `${FORM_PATHS[context.kind]}?draft=${context.draftId}`);
  }

  async function check(draft: StoredDraft, comparePayload = true): Promise<CreationStatus | null> {
    setChecking(true);
    try {
      let result = await bounded(getFormCreationStatusAction({ kind: draft.kind, draftId: draft.draftId, clientRequestId: draft.clientRequestId, ...(comparePayload ? { payload: draft.payload } : {}) }));
      if (!mounted.current) return null;
      if (result.status === 'created' && comparePayload && editedDuringMount.current && current.current.identity.clientRequestId === draft.clientRequestId && JSON.stringify(current.current.payload) !== JSON.stringify(draft.payload)) {
        result = { ...result, differences: [{ label: '录入内容', before: '原单据已保存', after: '核对期间内容已更改，请查看原单据并选择是否另建' }] };
      }
      setStatus(result);
      if (result.status === 'created' && result.differences.length === 0) {
        finished.current = true;
        setCompleted(true);
        try { completeDraft(sessionStorage, draft); } catch { /* Server status still prevents resubmission. */ }
      }
      return result;
    } catch {
      if (mounted.current) {
        setStatus(null);
        setMessage('暂时无法确认是否已经创建，请保留内容并重新核对；不要重复新建。');
      }
      return null;
    } finally { if (mounted.current) setChecking(false); }
  }

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    async function restore() {
      // A user can type into server-rendered controls before hydration finishes.
      // Capture that native input before any status update renders defaults.
      const nativePayload = editedDuringMount.current ? current.current.payload : captureNativeInput(formRef.current, initialPayload);
      let drafts: StoredDraft[];
      try { drafts = listDrafts(sessionStorage, initialContext.actorId, initialContext.kind); }
      catch { setMessage(storageMessage); initialized.current = true; return; }
      const search = Object.fromEntries(new URLSearchParams(window.location.search));
      const returning = readSupplementContext(search);
      const requestedId = returning?.draftId ?? search.draft;
      const completedIdentity = completedDraftIdentity(sessionStorage, { ...initialContext, draftId: requestedId ?? initialContext.draftId });
      if (completedIdentity) {
        const context = { ...initialContext, ...completedIdentity };
        const completedDraft = { ...context, payload: initialPayload, supplement: null, schemaVersion: 1, savedAt: Date.now() } as StoredDraft;
        install(initialPayload, context);
        setCandidate(completedDraft);
        finished.current = true; setCompleted(true);
        await check(completedDraft, false);
        initialized.current = true;
        return;
      }
      let draft = requestedId ? drafts.find((entry) => entry.draftId === requestedId) : drafts[0];
      // Strict Mode replays mount effects. A native edit saved by this same
      // mount is not an older flow that should suddenly ask for restoration.
      if (freshIdentityStarted.current && draft?.draftId === initialContext.draftId && !draft.supplement) draft = undefined;
      if (!draft) {
        freshIdentityStarted.current = true;
        if (requestedId) setMessage('此标签页没有可恢复的录入。如果从新标签页补充资料，请回原标签页点击“更新可选资料”。');
        initialized.current = true;
        install(nativePayload, initialContext);
        if (JSON.stringify(nativePayload) !== JSON.stringify(initialPayload)) write(nativePayload, initialContext);
        owner.current = claimDraft(initialContext.actorId, initialContext.draftId, markConflict);
        // Back/forward cache can retain server props after tombstone expiry or
        // eviction. Verify even a seemingly fresh identity before enabling it.
        await check({ ...initialContext, payload: nativePayload, supplement: null, schemaVersion: 1, savedAt: Date.now() } as StoredDraft);
        return;
      }
      // Install the old identity before checking. Never mint a replacement key
      // while a previous submit may still be in flight.
      setCandidate(draft);
      current.current.identity = { ...initialContext, draftId: draft.draftId, clientRequestId: draft.clientRequestId };
      setIdentity(current.current.identity);
      owner.current = claimDraft(draft.actorId, draft.draftId, markConflict);
      const [exclusive, result] = await Promise.all([owner.current.ready, check(draft)]);
      if (disposed) return;
      initialized.current = true;
      const matches = returning && draft.supplement && Object.entries(returning).every(([key, value]) => draft.supplement?.[key as keyof SupplementContext] === value);
      if (result?.status !== 'not-created' || !matches || !exclusive || conflictSeen.current || !initialContext.sessionScope || draft.sessionScope !== initialContext.sessionScope) return;
      let restored = draft.payload as T;
      let focusTarget: string | null = null;
      if (search.form_entityId) {
        try {
          const validated = await bounded(resolveSupplementAction({ context: returning, entityId: search.form_entityId }));
          if (disposed) return;
          if (validated.status === 'valid') {
            const filled = applySupplement(restored, returning!, validated.entityId);
            if (filled) restored = filled;
            else { setMessage('原物料行已删除，请手动选择新物料。'); focusTarget = 'items.0.materialId'; }
          } else { setMessage(validated.message); focusTarget = returning!.target; }
        } catch { setMessage('暂时无法核对新资料，请手动选择；其余录入已保留。'); focusTarget = returning!.target; }
      }
      install(restored, current.current.identity);
      setCandidate(null);
      write(restored);
      consumeReturn(current.current.identity);
      if (focusTarget) {
        const rowIndex = 'rows' in restored ? restored.rows.findIndex((row) => `row:${row.rowId}` === focusTarget) : -1;
        const fieldId = rowIndex >= 0 ? `items.${rowIndex}.materialId` : focusTarget;
        requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      }
    }
    void restore();
    return () => { disposed = true; mounted.current = false; owner.current?.close(); };
    // Each page instance initializes exactly once; server option refreshes must
    // not replace controlled inputs or allocate a new request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(next: T | ((previous: T) => T)) {
    const previous = initialized.current ? current.current.payload : captureNativeInput(formRef.current, current.current.payload);
    const value = typeof next === 'function' ? next(previous) : next;
    editedDuringMount.current = true;
    current.current.payload = value;
    setPayload(value);
    if (initialized.current) write(value);
  }

  function resume() {
    if (!candidate || checking || completed) return;
    const context = { ...identity, sessionScope: initialContext.sessionScope };
    install(candidate.payload as T, context);
    setCandidate(null);
    // Explicit continuation retains the old request key even across logins.
    if (!status || status.status === 'not-created') write(candidate.payload as T, context);
    consumeReturn(context);
    setMessage(conflict ? '另一标签页也在使用这份录入；继续保存会核对同一张单据。' : '已恢复上次录入，请核对可选资料；刚创建的资料请手动选择。');
  }

  function startAnother(keepContent: boolean) {
    if (checking || (candidate && !status)) return;
    const context = { ...initialContext, draftId: crypto.randomUUID(), clientRequestId: crypto.randomUUID() };
    const next = keepContent ? (candidate?.payload as T | undefined) ?? current.current.payload : initialPayload;
    finished.current = false;
    setCompleted(false);
    owner.current?.close();
    owner.current = claimDraft(context.actorId, context.draftId, markConflict);
    install(next, context);
    conflictSeen.current = false;
    setCandidate(null); setStatus(null); setConflict(false); setMessage('');
    write(next, context); consumeReturn(context);
  }

  function supplement(entityType: SupplementContext['entityType'], target: string, manage = false) {
    const context: SupplementContext = { origin: identity.kind, draftId: identity.draftId, nonce: crypto.randomUUID(), entityType, target };
    const href = supplementCreateHref(context, manage);
    if (!write(current.current.payload, identity, context)) {
      // The source stays mounted. A separate tab cannot silently consume this
      // flow's nonce; the explicit refresh only replaces server-provided options.
      setFallbackHref(href);
      return;
    }
    owner.current?.close();
    router.push(href);
  }

  return {
    payload, update, identity, candidate, status, checking, completed, message, conflict, fallbackHref,
    blocked: checking || completed || Boolean(candidate) || status?.status === 'created',
    editingBlocked: completed || Boolean(candidate) || status?.status === 'created',
    resume, startAnother, supplement,
    retry: async () => {
      const result = await check(candidate ?? { ...current.current.identity, payload: current.current.payload, supplement: null, schemaVersion: 1, savedAt: Date.now() } as StoredDraft);
      if (result) setMessage(result.status === 'not-created' ? '尚未创建单据，可以继续录入。' : '');
    },
    refresh: () => router.refresh(),
  };
}
