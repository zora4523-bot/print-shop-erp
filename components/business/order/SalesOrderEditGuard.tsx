'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { useAdminOrderLeaveGuard, type PendingOrderEditorNavigation } from './use-admin-order-leave-guard';

/** Snapshot actual controls, including unnamed controls and files in auxiliary forms. */
export function orderEditFormFingerprint(form: HTMLElement): string {
  return JSON.stringify(Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')).filter((input) => input.type !== 'hidden').map((input) => {
    if (input instanceof HTMLInputElement && input.type === 'file') return Array.from(input.files ?? []).map((file) => [file.name, file.size, file.lastModified]);
    return [input.value, input instanceof HTMLInputElement ? input.checked : null];
  }));
}

const SALES_EDIT_NOTICE_CLASS = 'sales-edit-notice';
const SALES_EDIT_NOTICE_SELECTOR = '[data-sales-edit-notice],.sales-edit-notice';

/** One page boundary for all forms, triggers, portalled dialogs, and navigation. */
export function SalesOrderEditGuard({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const dirtyForms = useRef(new Set<HTMLElement>());
  const baselines = useRef(new Map<HTMLElement, string>());
  const busyRegion = useRef<Element | null>(null);
  const saving = useRef<HTMLElement | null>(null);
  const sawBusy = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ navigation?: PendingOrderEditorNavigation } | null>(null);
  const blockNavigation = useCallback((navigation: PendingOrderEditorNavigation) => setNotice({ navigation }), []);
  // Reload/close stays protected while saving or while any region is busy; in-app navigation is
  // only offered a confirmation when nothing is being saved.
  const blockUnload = useCallback(() => dirtyForms.current.size > 0 || Boolean(busyRegion.current), []);
  useAdminOrderLeaveGuard({ protectedLeave: dirty && !isSaving, onBlocked: blockNavigation, blockUnload });

  useEffect(() => {
    const owner = (target: Element): HTMLElement | null => target.closest('form,[role="dialog"],[role="alertdialog"]');
    const guardedForm = (form: HTMLElement) => root.current?.contains(form) || Boolean(form.closest('[role="dialog"],[role="alertdialog"]'));
    const sync = () => {
      for (const form of document.querySelectorAll<HTMLElement>('form,[role="dialog"],[role="alertdialog"]')) {
        if (!form.closest(SALES_EDIT_NOTICE_SELECTOR) && guardedForm(form) && !baselines.current.has(form)) baselines.current.set(form, orderEditFormFingerprint(form));
      }
      for (const form of baselines.current.keys()) {
        if (!form.isConnected) { baselines.current.delete(form); dirtyForms.current.delete(form); }
      }
      if (saving.current) {
        if (saving.current.getAttribute('aria-busy') === 'true') sawBusy.current = true;
        if (!saving.current.isConnected || (sawBusy.current && saving.current.getAttribute('aria-busy') !== 'true')) {
          saving.current = null; sawBusy.current = false; setSaving(false);
        }
      }
      busyRegion.current = root.current?.querySelector('[aria-busy="true"]') ?? document.querySelector('[role="dialog"] [aria-busy="true"]');
      setDirty(dirtyForms.current.size > 0 || Boolean(busyRegion.current));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
    const changed = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = owner(target);
      if (!form || !guardedForm(form)) return;
      queueMicrotask(() => {
        if (orderEditFormFingerprint(form) === baselines.current.get(form)) dirtyForms.current.delete(form);
        else dirtyForms.current.add(form);
        setDirty(dirtyForms.current.size > 0);
      });
    };
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); setNotice({}); };
    const isNotice = (target: Element) => Boolean(target.closest(SALES_EDIT_NOTICE_SELECTOR));
    const hasOtherDraft = (form: HTMLElement | null) => Array.from(dirtyForms.current).some((owner) => owner !== form);
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || isNotice(event.target)) return;
      if (busyRegion.current && !busyRegion.current.contains(event.target)) { stop(event); return; }
      if (!dirtyForms.current.size) { changed(event); return; }
      const target = event.target;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0 && (!link.target || link.target === '_self') && !link.hasAttribute('download')) {
        const destination = new URL(link.href, location.href);
        if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
        // Same-origin links are handled by the shared leave guard. External links
        // retain native beforeunload confirmation, never silently drop input.
        return;
      }
      const control = target.closest('button,input,select,textarea,[role="button"],[role="checkbox"],[role="switch"],[role="tab"]');
      if (control && (hasOtherDraft(owner(control)) || Boolean(control.closest('[data-slot=dialog-close],[data-slot=alert-dialog-cancel]')))) stop(event);
      else changed(event);
    };
    const submit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      if (!guardedForm(form)) return;
      const submitOwner = event.submitter instanceof Element ? owner(event.submitter) : form;
      if (hasOtherDraft(submitOwner)) { stop(event); return; }
      if (dirtyForms.current.has(form) || (submitOwner && dirtyForms.current.has(submitOwner))) { saving.current = form; sawBusy.current = false; setSaving(true); }
    };
    const dismiss = (event: Event) => {
      if (!dirtyForms.current.size || !(event.target instanceof Element) || isNotice(event.target)) return;
      const dialogs = Array.from(dirtyForms.current).map((form) => form.closest('[role="dialog"],[role="alertdialog"]')).filter(Boolean);
      if (!dialogs.length) return;
      if ((event instanceof KeyboardEvent && event.key === 'Escape') || (event.type === 'pointerdown' && dialogs.every((dialog) => !dialog!.contains(event.target as Node)))) stop(event);
    };
    const beforeInput = (event: Event) => {
      if (!(event.target instanceof Element) || isNotice(event.target)) return;
      if (hasOtherDraft(owner(event.target))) stop(event);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { dismiss(event); return; }
      if (!(event.target instanceof Element) || isNotice(event.target) || event.key === 'Tab' || event.metaKey || event.ctrlKey) return;
      if (event.target.closest('input,select,textarea,button,[role=checkbox],[role=switch]') && hasOtherDraft(owner(event.target))) stop(event);
    };
    const paste = (event: ClipboardEvent) => {
      if (event.target instanceof Element && hasOtherDraft(owner(event.target)) && event.clipboardData?.files.length) stop(event);
    };
    const drop = (event: DragEvent) => {
      if (event.target instanceof Element && (hasOtherDraft(owner(event.target)) || busyRegion.current) && event.dataTransfer?.files.length) stop(event);
    };
    document.addEventListener('drop', drop, true);
    document.addEventListener('paste', paste, true);
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    document.addEventListener('beforeinput', beforeInput, true);
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('pointerdown', dismiss, true);
    return () => { observer.disconnect(); document.removeEventListener('drop', drop, true); document.removeEventListener('paste', paste, true); document.removeEventListener('input', changed, true); document.removeEventListener('change', changed, true); document.removeEventListener('click', click, true); document.removeEventListener('submit', submit, true); document.removeEventListener('beforeinput', beforeInput, true); document.removeEventListener('keydown', keyboard, true); document.removeEventListener('pointerdown', dismiss, true); };
  }, []);

  return <div ref={root} className="space-y-4">
    {children}
    <ConfirmActionController level="L2"
      open={notice !== null}
      onOpenChange={(open) => { if (!open) setNotice(null); }}
      className={SALES_EDIT_NOTICE_CLASS}
      cancelLabel="继续编辑"
      onConfirm={() => {
        const pending = notice?.navigation;
        setNotice(null);
        // Keep the real unsaved state: resume() is a one-shot pass for this
        // navigation, so a cancelled leave stays guarded (reload included).
        pending?.resume();
      }}>
      {notice?.navigation
        ? <ConfirmActionDialog action="离开编辑页？" changes={[]} consequences={['离开后，本页未保存的修改将丢失。']} confirmText="放弃修改并离开" danger />
        : <ConfirmActionDialog action="请先保存当前修改" changes={[]} consequences={['当前内容尚未保存。请保存后再操作其他功能。']} confirmText="知道了" />}
    </ConfirmActionController>
  </div>;
}
