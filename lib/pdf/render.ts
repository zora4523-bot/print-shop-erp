import type { Browser, LaunchOptions, PDFOptions } from 'puppeteer';

export const PDF_PRINT_READY_TIMEOUT_MS = 12_000;

// Thin wrapper around Puppeteer's HTML → PDF flow. Kept in lib/pdf so
// the same helper can render the order print view now and, later,
// salary slips / bills / CDR cover sheets without duplicating the
// launch boilerplate.
//
// Puppeteer launches a new browser per call for simplicity. That's
// fine for MVP volume (a handful of PDFs per day). If we start seeing
// >1 concurrent render we can memoize the browser across requests —
// for now a fresh browser keeps tests / dev reloads clean.

export type RenderPdfOptions = {
  html: string;
  // Extra `page.pdf()` flags. The work-order paper invariants below (A4,
  // background graphics, CSS page size, and zero Puppeteer margins) always
  // win so preview and downloaded PDF cannot drift apart.
  pdf?: PDFOptions;
  // Extra `puppeteer.launch()` flags — mostly for tests, where a
  // pre-existing browser is injected via `browser` below.
  launch?: LaunchOptions;
  // Inject an already-launched browser (tests). When present, launch
  // is skipped and the caller retains responsibility for teardown.
  browser?: Browser;
  // Durable workers abort this when they can no longer prove lease ownership.
  signal?: AbortSignal;
};

export async function renderHtmlToPdf(opts: RenderPdfOptions): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  const browser =
    opts.browser ??
    (await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...opts.launch,
    }));

  const page = await browser.newPage();
  const abortRender = () => {
    void page.close().catch(() => undefined);
    if (!opts.browser) void browser.close().catch(() => undefined);
  };
  opts.signal?.addEventListener('abort', abortRender, { once: true });
  try {
    opts.signal?.throwIfAborted();
    // `networkidle0` is required so OSS-hosted design thumbnails have
    // finished loading before we snapshot. Inline SVG (QR codes)
    // doesn't trigger network activity, but image tags do.
    await page.setContent(opts.html, { waitUntil: 'networkidle0' });
    opts.signal?.throwIfAborted();
    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.printReady === 'true',
        {
          timeout: PDF_PRINT_READY_TIMEOUT_MS,
          signal: opts.signal,
        },
      );
    } catch (error) {
      // A missing/broken readiness script must not hang PDF production. Only
      // the bounded readiness timeout is recoverable; page crashes and other
      // Puppeteer failures still surface. Abort keeps its original semantics.
      opts.signal?.throwIfAborted();
      if (!(error instanceof puppeteer.TimeoutError)) throw error;
    }
    opts.signal?.throwIfAborted();
    await page.emulateMediaType('print');
    opts.signal?.throwIfAborted();
    const pdf = await page.pdf({
      ...opts.pdf,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    opts.signal?.throwIfAborted();
    return Buffer.from(pdf);
  } finally {
    opts.signal?.removeEventListener('abort', abortRender);
    // Always dispose of the page — when the caller shares a browser,
    // closing only at browser-shutdown would accumulate pages across
    // renders. Swallow errors so a page-close failure doesn't mask
    // the original thrown error on the PDF path.
    await page.close().catch(() => undefined);
    // Only close the browser we launched. A caller-provided browser
    // is someone else's to dispose of (e.g. tests sharing one).
    if (!opts.browser) {
      await browser.close();
    }
  }
}
