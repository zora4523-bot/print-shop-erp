'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { OrderEditorAuxiliaryContext, useOrderEditorAuxiliaryController } from './use-order-editor-auxiliary';
import { useAdminOrderLeaveGuard, type PendingOrderEditorNavigation } from './use-admin-order-leave-guard';

/** Coordinates basic metadata and independently saved internal order forms. */
export function InternalOrderEditWorkspace({ children, auxiliary }: { children: ReactNode; auxiliary: ReactNode }) {
  const main = useRef<HTMLFieldSetElement>(null);
  const baseline = useRef<string | null>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [navigation, setNavigation] = useState<PendingOrderEditorNavigation | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const controller = useOrderEditorAuxiliaryController(dirty);
  const onBlocked = useCallback((next: PendingOrderEditorNavigation) => {
    if (controller.pending) return;
    focusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNavigation(next);
  }, [controller.pending]);
  const { allowNavigation } = useAdminOrderLeaveGuard({
    protectedLeave: dirty || controller.dirty || controller.pending, onBlocked,
  });
  function readMain() {
    return JSON.stringify(Array.from(main.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? [])
      .map((input) => [input.name, input.value, input instanceof HTMLInputElement ? input.checked : null]));
  }
  useEffect(() => {
    baseline.current = readMain();
    return () => { if (changeTimer.current) clearTimeout(changeTimer.current); };
  }, []);
  return <OrderEditorAuxiliaryContext.Provider value={controller.context}>
    <fieldset ref={main} disabled={controller.dirty || controller.pending} className="min-w-0"
      onChangeCapture={() => {
        if (changeTimer.current) clearTimeout(changeTimer.current);
        // Read after React commits controlled and serialized shipment values.
        changeTimer.current = setTimeout(() => setDirty(readMain() !== baseline.current), 0);
      }}>{children}</fieldset>
    {auxiliary}
    <ConfirmActionController level="L2" open={navigation !== null}
      onOpenChange={(open) => { if (!open) setNavigation(null); }} focusReturnRef={focusReturnRef}
      onConfirm={() => { allowNavigation(); navigation?.resume(); }}>
      <ConfirmActionDialog action="放弃未保存修改" changes={[]}
        consequences={['本次未保存的填写内容将丢失。']} confirmText="放弃修改并离开" />
    </ConfirmActionController>
  </OrderEditorAuxiliaryContext.Provider>;
}
