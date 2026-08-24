'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

const TIMELINE_GAP_PX = 16;

export function orderDetailTimelineTop(headerHeight: number): string {
  return `calc(var(--admin-header-offset) + ${Math.max(0, headerHeight)}px + ${TIMELINE_GAP_PX}px)`;
}

export function OrderDetailStickyScope({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    const stickyHeader = headerRef.current;
    if (!scope || !stickyHeader) return;

    const updateOffset = () => {
      scope.style.setProperty(
        '--order-detail-timeline-top',
        orderDetailTimelineTop(stickyHeader.offsetHeight),
      );
    };
    updateOffset();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateOffset);
    observer.observe(stickyHeader);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scopeRef} className="space-y-4">
      <div
        ref={headerRef}
        className="sticky z-[9] -mx-1 space-y-3 border-b bg-background/95 px-1 py-3 backdrop-blur-sm"
        style={{ top: 'var(--admin-header-offset)' }}
      >
        {header}
      </div>
      {children}
    </div>
  );
}
