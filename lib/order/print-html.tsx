import { OrderPrintLayout } from '../../components/business/order/OrderPrintLayout';
import type { PrintOrder } from '../../components/business/order/OrderPrintLayout.types';

const MAX_FILENAME_COMPONENT_LENGTH = 80;

// Standalone HTML is loaded directly by Puppeteer, without AutoPrint's client
// lifecycle. Keep its image/font readiness handshake here instead of rendering
// a <script> through React, which React 19 rejects during client navigation.
const STANDALONE_PRINT_READY_SCRIPT = String.raw`
(() => {
  const root = document.documentElement;
  const images = Array.from(document.querySelectorAll('img[data-print-artwork="true"]'));
  const failedFigures = new Set();
  const recordFailure = (image) => {
    const thumb = image.closest('.thumb');
    if (thumb) {
      thumb.classList.add('image-failed');
      const fig = thumb.getAttribute('data-fig');
      if (fig) failedFigures.add(fig);
    }
  };
  const waitForImage = (image) => new Promise((resolve) => {
    let settled = false;
    const finish = (failed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed) recordFailure(image);
      resolve();
    };
    const timer = setTimeout(() => finish(true), 8000);
    if (image.complete) {
      finish(image.naturalWidth === 0);
      return;
    }
    image.addEventListener('load', () => finish(false), { once: true });
    image.addEventListener('error', () => finish(true), { once: true });
  });
  const fontsReady = document.fonts && document.fonts.ready
    ? document.fonts.ready.catch(() => undefined)
    : Promise.resolve();
  Promise.all([fontsReady, ...images.map(waitForImage)]).finally(() => {
    if (failedFigures.size > 0) {
      const figures = Array.from(failedFigures);
      const preview = figures.slice(0, 6).join('、');
      const remaining = figures.length > 6 ? ' 等，共 ' + figures.length + ' 款' : '';
      const message = '设计图加载失败：图 ' + preview + remaining;
      document.querySelectorAll('.image-load-warning').forEach((node) => {
        node.hidden = false;
        node.textContent = message;
      });
    }
    root.dataset.printReady = 'true';
    window.dispatchEvent(new Event('print-ready'));
  });
})();
`;

// Produces a standalone HTML document for the print layout. Used by
// the PDF route (Puppeteer.setContent) so we don't need a localhost
// hop + cookie forwarding to render the same view.
//
// The component is pure React — no hooks that read session / route,
// no async suspense — so renderToStaticMarkup captures it verbatim.
//
// `react-dom/server` is loaded via dynamic import: Next 16 / Turbopack's
// build-time guard rejects static imports of `react-dom/server` even
// in Route Handlers (the static analysis can't tell that this module
// is only ever pulled by server-only entry points). The dynamic
// import sidesteps the guard and is paid lazily on first call —
// negligible vs. Puppeteer cold start that comes right after.
export async function buildPrintHtml(
  order: PrintOrder,
  options: { factoryName: string },
): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const body = renderToStaticMarkup(
    <OrderPrintLayout order={order} factoryName={options.factoryName} />,
  );

  // Minimal doc shell — the layout injects its own <style>, and all
  // image / QR assets are either absolute URLs (OSS) or inline SVG.
  // Pinning the lang + charset keeps Chinese rendering consistent
  // regardless of Puppeteer's locale.
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>工单 ${escapeHtml(order.orderNo)}</title>
</head>
<body>${body}<script>${STANDALONE_PRINT_READY_SCRIPT}</script></body>
</html>`;
}

export function buildOrderPdfFilename(
  order: Pick<PrintOrder, 'orderNo' | 'customerName'>,
): string {
  const orderNo = sanitizeFilenameComponent(order.orderNo) || '工单';
  const customerName = sanitizeFilenameComponent(order.customerName ?? '');
  return `${orderNo}${customerName ? `_${customerName}` : ''}.pdf`;
}

function sanitizeFilenameComponent(value: string): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]+/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const limited = Array.from(normalized)
    .slice(0, MAX_FILENAME_COMPONENT_LENGTH)
    .join('');
  return limited.replace(/[.\s]+$/g, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
