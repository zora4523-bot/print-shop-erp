import { OrderPrintLayout } from '../../components/business/order/OrderPrintLayout';
import type { PrintOrder } from '../../components/business/order/OrderPrintLayout.types';

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
  options: { renderedAt?: Date; factoryName?: string } = {},
): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const body = renderToStaticMarkup(
    <OrderPrintLayout
      order={order}
      factoryName={options.factoryName}
      renderedAt={options.renderedAt}
    />,
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
<body>${body}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
