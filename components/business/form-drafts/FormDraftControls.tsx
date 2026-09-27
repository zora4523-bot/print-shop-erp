'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { CreationIdentity, FormDraftContext, FormDraftPayload, FormKind, SupplementContext } from '@/lib/form-drafts/model';
import { cleanupDrafts, completeDraft } from '@/lib/form-drafts/storage';
import { supplementParams } from '@/lib/form-drafts/return-context';
import { claimDraft } from '@/lib/form-drafts/ownership';
import type { useFormDraft } from './useFormDraft';

export function DraftIdentityFields({ identity }: { identity: CreationIdentity }) {
  return <><input type="hidden" name="draftId" value={identity.draftId} /><input type="hidden" name="clientRequestId" value={identity.clientRequestId} /></>;
}

export function DraftNotice<T extends FormDraftPayload>({ draft }: { draft: ReturnType<typeof useFormDraft<T>> }) {
  if (!draft.candidate && !draft.message && draft.status?.status !== 'created') return null;
  return <section aria-label="录入恢复" className="space-y-3 rounded-lg border p-4">
    {draft.message ? <p role="status" className="text-sm">{draft.message}</p> : null}
    {draft.conflict ? <p className="text-sm">另一标签页也在使用这份录入，请返回原标签页，或核对后选择另建一单。</p> : null}
    {draft.candidate && !draft.completed ? <p className="text-sm">发现上次未完成的录入。{draft.checking ? '正在核对是否已创建…' : '请选择继续录入或另建。'}</p> : null}
    {draft.status?.status === 'created' ? <>
      <p className="text-sm">这份录入已经创建过单据。</p>
      <Link href={draft.status.href} className="inline-flex min-h-11 items-center text-primary underline">查看已创建单据</Link>
      {draft.status.differences.length ? <ul className="space-y-1 text-sm">{draft.status.differences.map((change) => <li key={change.label}>{change.label}：原单据为“{change.before}”，当前为“{change.after}”</li>)}</ul> : null}
    </> : null}
    <div className="flex flex-wrap gap-3">
      {draft.candidate && !draft.status ? <Button type="button" variant="outline" disabled={draft.checking} onClick={draft.retry}>重新核对</Button> : null}
      {draft.candidate && !draft.completed && draft.status?.status !== 'created' ? <Button type="button" variant="outline" disabled={draft.checking} onClick={draft.resume}>继续上次录入</Button> : null}
      {draft.status ? <Button type="button" variant="outline" disabled={draft.checking} onClick={() => draft.startAnother(true)}>另建一单</Button> : null}
      {draft.candidate && draft.status ? <Button type="button" variant="outline" disabled={draft.checking} onClick={() => draft.startAnother(false)}>重新填写</Button> : null}
      {draft.fallbackHref ? <a href={draft.fallbackHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline">在新标签页补充资料</a> : null}
      {draft.message ? <Button type="button" variant="outline" onClick={draft.refresh}>更新可选资料</Button> : null}
    </div>
  </section>;
}

export function SupplementLink({ href, disabled, onSupplement, children }: { href: string; disabled: boolean; onSupplement: () => void; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined}
    className="inline-flex min-h-11 items-center text-xs text-primary hover:underline"
    onClick={(event) => {
      if (disabled) { event.preventDefault(); return; }
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSupplement(); }
    }}>{children}</a>;
}

/** Mounted only inside an authenticated shell. Login/sign-out stays native. */
export function AuthenticatedDraftCleanup({ actorId, allowed }: { actorId: string; allowed: FormKind[] }) {
  useEffect(() => { try { cleanupDrafts(sessionStorage, actorId, allowed); } catch { /* Forms offer a storage fallback. */ } }, [actorId, allowed]);
  return null;
}

/** The server has verified this exact actor, request, draft and created entity. */
export function CompletedDraftCleanup({ context }: { context: FormDraftContext }) {
  useEffect(() => { try { completeDraft(sessionStorage, context); } catch { /* Recovery rechecks the immutable server record. */ } }, [context]);
  return null;
}

export function SupplementFields({ context }: { context?: SupplementContext | null }) {
  if (!context) return null;
  return <>{Object.entries(supplementParams(context)).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</>;
}

export function SupplementOwnership({ actorId, context }: { actorId: string; context: SupplementContext | null }) {
  useEffect(() => {
    if (!context) return;
    const owner = claimDraft(actorId, context.draftId, () => {});
    return () => owner.close();
  }, [actorId, context]);
  return null;
}
