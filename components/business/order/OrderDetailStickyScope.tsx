import type { CSSProperties, ReactNode } from 'react';

/** The shell is the only sticky header; retain the shared offset for sidebars and anchors. */
export function OrderDetailStickyScope({ header, children }: { header: ReactNode; children: ReactNode }) {
  return <div className="space-y-4" style={{
    '--order-detail-timeline-top': 'calc(var(--admin-header-offset, 0px) + 16px)',
  } as CSSProperties}>
    <div data-slot="order-page-heading" className="space-y-3 border-b py-3">{header}</div>
    {children}
  </div>;
}
