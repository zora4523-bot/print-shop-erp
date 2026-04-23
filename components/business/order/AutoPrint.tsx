'use client';

import { useEffect } from 'react';

// Print-view is used in two modes:
//   1. Browser print — user clicks "打印" → new tab opens with
//      ?autoprint=1 → this component fires window.print() once the
//      layout mounts and closes the tab on afterprint.
//   2. Puppeteer PDF — server hits the same URL WITHOUT the query
//      param, so auto-print stays off and page.pdf() captures the DOM
//      cleanly.
//
// Gating on the flag keeps the two callers from colliding.
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const onAfterPrint = () => {
      // Best-effort tab close. Browsers only honor window.close() on
      // windows that scripts opened, so fall back to leaving the tab
      // open silently rather than throwing.
      try {
        window.close();
      } catch {
        // no-op
      }
    };
    window.addEventListener('afterprint', onAfterPrint);
    // Defer the print() call by one tick so images / QR SVGs have had
    // a chance to paint before the dialog snapshots the layout.
    const handle = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [enabled]);
  return null;
}
