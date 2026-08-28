'use client';

import { useEffect } from 'react';

export function shouldProtectOrderFormLeave(args: {
  enabled: boolean;
  dirty: boolean;
  pendingFileCount: number;
  submitted: boolean;
}): boolean {
  return (
    args.enabled &&
    !args.submitted &&
    (args.dirty || args.pendingFileCount > 0)
  );
}

export function useOrderFormLeaveGuard(protectedLeave: boolean): void {
  useEffect(() => {
    if (!protectedLeave) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // `returnValue` remains necessary for browsers that still require the
      // legacy signal before showing their native confirmation dialog.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [protectedLeave]);
}

