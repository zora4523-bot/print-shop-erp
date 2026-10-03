'use client';

import { useNavigationGuard } from '@/components/ui-business';

export type PendingOrderEditorNavigation = {
  /** Display/debug information only; resume preserves the original navigation. */
  href: string;
  resume: () => void;
};

/**
 * Admin / sales order editors on the shared navigation guard: links replay
 * the original click (keeping Next Link replace/scroll), back/forward are
 * cancelled before App Router sees popstate and resumed by entry key, and
 * browsers without the Navigation API keep link and beforeunload protection.
 */
export function useAdminOrderLeaveGuard({
  protectedLeave,
  onBlocked,
  blockUnload,
}: {
  protectedLeave: boolean;
  onBlocked: (navigation: PendingOrderEditorNavigation) => void;
  /** Reload/close protection when it must outlive `protectedLeave` (defaults to it). */
  blockUnload?: () => boolean;
}): { allowNavigation: () => void } {
  const { release } = useNavigationGuard({
    when: protectedLeave,
    blockUnload: blockUnload ?? protectedLeave,
    onBlocked: ({ href, resume }) => onBlocked({ href, resume }),
  });
  return { allowNavigation: release };
}
