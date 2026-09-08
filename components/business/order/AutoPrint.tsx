'use client';

import { useEffect, useRef, useState } from 'react';
import { paginatePrintDocument } from '@/lib/order/print-pagination';

export const PRINT_READY_EVENT = 'print-ready';
export const PRINT_READY_TIMEOUT_MS = 12_000;
export const PRINT_ASSET_TIMEOUT_MS = 8_000;
const MAX_FAILED_FIGURES_IN_WARNING = 6;

type PrintReadyDocument = Pick<
  Document,
  'documentElement' | 'addEventListener' | 'removeEventListener'
>;

type PrintReadyWindow = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'
>;

/**
 * A full document load executes the template's inline readiness script. A
 * Next.js client navigation does not execute newly inserted inline scripts,
 * so the hydrated print route runs the same asset check here as well.
 */
export function preparePrintDocument(
  documentTarget: Document,
  windowTarget: Window,
): () => void {
  const printRoot = documentTarget.querySelector<HTMLElement>('.work-order-document');
  if (printRoot?.dataset.printPrepared === 'true') {
    return () => undefined;
  }
  documentTarget.documentElement.dataset.printReady = 'false';
  delete documentTarget.documentElement.dataset.printPagination;

  let cancelled = false;
  const cleanups: Array<() => void> = [];
  const failedFigures = new Set<string>();
  const images = Array.from(
    documentTarget.querySelectorAll<HTMLImageElement>(
      'img[data-print-artwork="true"]',
    ),
  );

  const waitForImage = (image: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      let settled = false;
      const finish = (failed: boolean) => {
        if (settled) return;
        settled = true;
        windowTarget.clearTimeout(timeoutHandle);
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        if (failed) {
          const thumb = image.closest<HTMLElement>('.thumb');
          thumb?.classList.add('image-failed');
          const fig = thumb?.dataset.fig;
          if (fig) failedFigures.add(fig);
        }
        resolve();
      };
      const onLoad = () => finish(false);
      const onError = () => finish(true);
      const timeoutHandle = windowTarget.setTimeout(
        () => finish(true),
        PRINT_ASSET_TIMEOUT_MS,
      );

      if (image.complete) {
        finish(image.naturalWidth === 0);
        return;
      }
      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      cleanups.push(() => {
        windowTarget.clearTimeout(timeoutHandle);
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
      });
    });

  const fontsReady = documentTarget.fonts?.ready.catch(() => undefined);
  void Promise.all([fontsReady, ...images.map(waitForImage)]).then(() => {
    if (cancelled) return;
    if (failedFigures.size > 0) {
      const message = formatArtworkFailureWarning(failedFigures);
      documentTarget
        .querySelectorAll<HTMLElement>('.image-load-warning')
        .forEach((warning) => {
          warning.hidden = false;
          warning.textContent = message;
        });
    }
    paginatePrintDocument(documentTarget);
    documentTarget.documentElement.dataset.printReady = 'true';
    documentTarget.dispatchEvent(new Event(PRINT_READY_EVENT));
    windowTarget.dispatchEvent(new Event(PRINT_READY_EVENT));
  }).catch(() => {
    if (cancelled) return;
    documentTarget.documentElement.dataset.printPagination = 'overflow';
    documentTarget.dispatchEvent(new Event(PRINT_READY_EVENT));
    windowTarget.dispatchEvent(new Event(PRINT_READY_EVENT));
  });

  return () => {
    cancelled = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}

export function formatArtworkFailureWarning(figures: Iterable<string>): string {
  const values = [...figures];
  const visibleFigures = values
    .slice(0, MAX_FAILED_FIGURES_IN_WARNING)
    .join('、');
  const remaining =
    values.length > MAX_FAILED_FIGURES_IN_WARNING
      ? ` 等，共 ${values.length} 款`
      : '';
  return `设计图加载失败：图 ${visibleFigures}${remaining}`;
}

/**
 * Wait until the standalone print template says that fonts and images have
 * settled and A4 geometry has been verified. A timeout only prints a document
 * whose pagination already succeeded; missing/broken scripts fail closed.
 */
export function waitForPrintReady(
  documentTarget: PrintReadyDocument,
  windowTarget: PrintReadyWindow,
  onReady: () => void,
  timeoutMs = PRINT_READY_TIMEOUT_MS,
  onError?: () => void,
): () => void {
  let settled = false;
  let readyHandle: number | null = null;
  let fallbackHandle: number | null = null;

  const cleanup = () => {
    documentTarget.removeEventListener(PRINT_READY_EVENT, finish);
    windowTarget.removeEventListener(PRINT_READY_EVENT, finish);
    if (readyHandle !== null) windowTarget.clearTimeout(readyHandle);
    if (fallbackHandle !== null) windowTarget.clearTimeout(fallbackHandle);
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (documentTarget.documentElement.dataset.printPagination === 'ready') onReady();
    else onError?.();
  };

  // Listen on both targets so the standalone template can dispatch the
  // readiness event from either `document` or `window` without coupling the
  // React wrapper to its implementation detail.
  documentTarget.addEventListener(PRINT_READY_EVENT, finish);
  windowTarget.addEventListener(PRINT_READY_EVENT, finish);
  fallbackHandle = windowTarget.setTimeout(finish, timeoutMs);

  if (documentTarget.documentElement.dataset.printReady === 'true') {
    // Keep printing outside the effect setup call and give the final painted
    // frame one task before the browser snapshots it.
    readyHandle = windowTarget.setTimeout(finish, 0);
  }

  return cleanup;
}

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
  const printedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stopPreparing = preparePrintDocument(document, window);
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
    if (enabled) window.addEventListener('afterprint', onAfterPrint);
    const stopWaiting = waitForPrintReady(document, window, () => {
      if (!enabled || printedRef.current) return;
      printedRef.current = true;
      window.print();
    }, PRINT_READY_TIMEOUT_MS, () => setFailed(true));

    return () => {
      stopPreparing();
      stopWaiting();
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [enabled]);
  return failed ? <p role="alert" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
    padding: '1rem', background: '#fff', color: '#a8121a', textAlign: 'center' }}>
    打印页面未能完成排版，已停止自动打印。请刷新页面后重试。
  </p> : null;
}
