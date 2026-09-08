'use client';

import { useCallback, useEffect, useRef } from 'react';

type NavigationResult = {
  committed: Promise<unknown>;
  finished: Promise<unknown>;
};

type BrowserNavigation = EventTarget & {
  traverseTo: (key: string) => NavigationResult;
};

type BrowserNavigateEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string; sameDocument: boolean };
};

export type PendingOrderEditorNavigation = {
  /** Display/debug information only; resume preserves the original navigation. */
  href: string;
  resume: () => void;
};

export function isDifferentOrderEditorPage(
  current: string,
  next: string,
): boolean {
  const from = new URL(current);
  const to = new URL(next, from);
  return (
    from.origin === to.origin &&
    (from.pathname !== to.pathname || from.search !== to.search)
  );
}

/**
 * Guard admin drafts without inserting duplicate history entries or replacing
 * Next's history state. Navigation API cancellation happens before App Router
 * receives popstate, so cancelling keeps both the URL and the draft in place.
 * Older browsers retain link and full-document beforeunload protection.
 */
export function useAdminOrderLeaveGuard({
  protectedLeave,
  onBlocked,
}: {
  protectedLeave: boolean;
  onBlocked: (navigation: PendingOrderEditorNavigation) => void;
}): { allowNavigation: () => void } {
  const released = useRef(false);
  const allowNavigation = useCallback(() => {
    released.current = true;
  }, []);

  useEffect(() => {
    if (!protectedLeave) return;
    released.current = false;
  }, [protectedLeave]);

  useEffect(() => {
    if (!protectedLeave) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (released.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (
        released.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        (link.target && link.target !== '_self') ||
        link.hasAttribute('download') ||
        !isDifferentOrderEditorPage(location.href, link.href)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onBlocked({
        href: link.href,
        resume: () => {
          released.current = true;
          // Replaying the original link preserves Next Link's replace/scroll
          // options instead of converting every action into router.push.
          link.click();
        },
      });
    };
    const navigation = (window as Window & { navigation?: BrowserNavigation })
      .navigation;
    const onNavigate = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigateEvent;
      if (
        released.current ||
        event.defaultPrevented ||
        event.navigationType !== 'traverse' ||
        !event.cancelable ||
        !event.destination.sameDocument ||
        !isDifferentOrderEditorPage(location.href, event.destination.url)
      )
        return;
      event.preventDefault();
      const { key, url } = event.destination;
      onBlocked({
        href: url,
        resume: () => {
          released.current = true;
          const result = navigation!.traverseTo(key);
          // A second user navigation can abort these promises. Do not turn a
          // cancelled browser traversal into an unhandled application error.
          void result.committed.catch(() => undefined);
          void result.finished.catch(() => {
            released.current = false;
          });
        },
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    navigation?.addEventListener('navigate', onNavigate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
      navigation?.removeEventListener('navigate', onNavigate);
    };
  }, [onBlocked, protectedLeave]);

  return { allowNavigation };
}
