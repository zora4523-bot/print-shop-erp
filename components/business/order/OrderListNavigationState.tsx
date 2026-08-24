'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';

function replaceListState(values: {
  selectedOrderId?: string;
  scrollY?: number;
}) {
  const url = new URL(window.location.href);
  if (values.selectedOrderId) {
    url.searchParams.set('selected', values.selectedOrderId);
  } else {
    url.searchParams.delete('selected');
  }
  if (values.scrollY && values.scrollY > 0) {
    url.searchParams.set('scroll', String(Math.round(values.scrollY)));
  } else {
    url.searchParams.delete('scroll');
  }
  window.history.replaceState(window.history.state, '', url);
}

function markSelectedOrderRow(orderId: string | null) {
  document.querySelectorAll<HTMLElement>('[data-order-id]').forEach((row) => {
    if (row.dataset.orderId === orderId) {
      row.dataset.state = 'selected';
    } else {
      delete row.dataset.state;
    }
  });
}

/**
 * Restores the exact list position after browser-back and keeps that position
 * in the current history entry without triggering a Next.js navigation.
 */
export function OrderListScrollState({
  selectedOrderId,
  scrollY,
}: {
  selectedOrderId?: string;
  scrollY?: number;
}) {
  const restoredRef = useRef(false);

  useEffect(() => {
    const applyLiveSelection = () => {
      const liveSelected = new URL(window.location.href).searchParams.get(
        'selected',
      );
      markSelectedOrderRow(liveSelected ?? selectedOrderId ?? null);
    };
    applyLiveSelection();
    window.addEventListener('pageshow', applyLiveSelection);
    window.addEventListener('popstate', applyLiveSelection);
    return () => {
      window.removeEventListener('pageshow', applyLiveSelection);
      window.removeEventListener('popstate', applyLiveSelection);
    };
  }, [selectedOrderId]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      if (scrollY !== undefined) {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
        return;
      }
      if (!selectedOrderId) return;
      document
        .querySelector<HTMLElement>(`[data-order-id="${selectedOrderId}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollY, selectedOrderId]);

  useEffect(() => {
    let frame = 0;
    const persistNow = () => {
      // A detail link updates `selected` synchronously immediately before
      // navigation. Read the live history entry here so `pagehide` cannot
      // overwrite that newer selection with this component's older prop.
      const liveSelected =
        new URL(window.location.href).searchParams.get('selected') ??
        selectedOrderId;
      replaceListState({
        selectedOrderId: liveSelected || undefined,
        scrollY: window.scrollY,
      });
    };
    const persistAfterScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(persistNow);
    };
    window.addEventListener('scroll', persistAfterScroll, { passive: true });
    window.addEventListener('pagehide', persistNow);
    return () => {
      window.removeEventListener('scroll', persistAfterScroll);
      window.removeEventListener('pagehide', persistNow);
      window.cancelAnimationFrame(frame);
    };
  }, [selectedOrderId]);

  return null;
}

export function OrderListDetailLink({
  orderId,
  href,
  className,
  children,
}: {
  orderId: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function rememberSelection(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    replaceListState({ selectedOrderId: orderId, scrollY: window.scrollY });
    // Browser back may restore the list from the back/forward cache instead of
    // asking the Server Component to render again. Persist the visual state in
    // that DOM snapshot as well as in the URL so the operator returns to an
    // immediately highlighted row in both navigation paths.
    markSelectedOrderRow(orderId);
  }

  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      onClick={rememberSelection}
    >
      {children}
    </Link>
  );
}
