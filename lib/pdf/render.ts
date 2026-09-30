import type { Browser, BrowserContext, LaunchOptions, Page, PDFOptions } from 'puppeteer';

export const PDF_PRINT_READY_TIMEOUT_MS = 12_000;

// Thin wrapper around Puppeteer's HTML → PDF flow. Kept in lib/pdf so
// the same helper can render the order print view now and, later,
// salary slips / bills / CDR cover sheets without duplicating the
// launch boilerplate.
//
// Reuse is opt-in during HEAVY worker bootstrap; Web/inline rendering stays isolated.
import { PdfBrowserPool } from './browser-pool';
import { PDF_WORKER_RENDER_BUDGET_MS, pdfLaunchOptions } from './launch-options';
let workerPool: PdfBrowserPool | undefined;
export function enableWorkerPdfBrowserReuse() {
  workerPool ??= new PdfBrowserPool(async () => {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch(pdfLaunchOptions());
  });
}
export async function closeWorkerPdfBrowser() {
  const pool = workerPool;
  workerPool = undefined;
  await pool?.close();
}

export type RenderPdfOptions = {
  html: string;
  requireArtwork?: boolean;
  onArtworkUnavailable?: () => void;
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
  context?: BrowserContext;
  // Durable workers abort this when they can no longer prove lease ownership.
  signal?: AbortSignal;
};

export async function renderHtmlToPdf(opts: RenderPdfOptions): Promise<Buffer> {
  if (workerPool && !opts.browser && !opts.launch) {
    return workerPool.run(
      (browser, context, signal) => renderHtmlToPdf({ ...opts, browser, context, signal }),
      { ...(opts.signal ? { signal: opts.signal } : {}), budgetMs: PDF_WORKER_RENDER_BUDGET_MS },
    );
  }
  const puppeteer = await import('puppeteer');
  if (!opts.browser) {
    const pool = new PdfBrowserPool(() => puppeteer.default.launch({ ...pdfLaunchOptions(), ...opts.launch }));
    try {
      return await pool.run((browser, context, signal) => renderHtmlToPdf({ ...opts, browser, context, signal }),
        { signal: opts.signal, budgetMs: PDF_WORKER_RENDER_BUDGET_MS });
    } finally { await pool.close(); }
  }
  const browser = opts.browser;
  const expectedVersion = process.env.PDF_CHROMIUM_VERSION;
  if (expectedVersion && (await browser.version()).split('/').pop() !== expectedVersion) {
    throw new PdfBrowserVersionMismatchError();
  }
  const page: Page = await (opts.context ?? browser).newPage();
  const abortRender = () => { void page.close().catch(() => undefined); };
  opts.signal?.addEventListener('abort', abortRender, { once: true });
  try {
    opts.signal?.throwIfAborted();
    // Puppeteer 25 separates DOM lifecycle from network-idle waiting.
    // Preserve zero active requests before rendering remote artwork thumbnails.
    await page.setContent(opts.html, { waitUntil: 'load' });
    await page.waitForNetworkIdle({ concurrency: 0, signal: opts.signal });
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
    const fontStatus = await page.evaluate(() => document.querySelector('[data-print-fonts="required"]')
      ? document.documentElement.dataset.printFonts ?? 'unprepared' : null);
    if (fontStatus !== null && fontStatus !== 'ready') throw new PrintFontUnavailableError();
    const pagination = await page.evaluate(() => document.querySelector('.work-order-document')
      ? document.documentElement.dataset.printPagination ?? 'unprepared'
      : null);
    if (pagination !== null && pagination !== 'ready') throw new PrintLayoutOverflowError();
    opts.signal?.throwIfAborted();
    if ((opts.requireArtwork || opts.onArtworkUnavailable) && await page.evaluate(() => document.querySelector('.thumb.image-failed') !== null)) {
      if (opts.requireArtwork) throw new PrintArtworkUnavailableError();
      opts.onArtworkUnavailable?.();
    }
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
  }
}

export class PrintLayoutOverflowError extends Error {
  constructor() {
    super('打印内容超出 A4 页面，请检查过长的单条内容后重新生成');
    this.name = 'PrintLayoutOverflowError';
  }
}

export class PrintFontUnavailableError extends Error {
  constructor() {
    super('打印字体未就绪，已停止生成 PDF');
    this.name = 'PrintFontUnavailableError';
  }
}

class PdfBrowserVersionMismatchError extends Error {
  constructor() {
    super('PDF_BROWSER_VERSION_MISMATCH');
    this.name = 'PDF_BROWSER_VERSION_MISMATCH';
  }
}

export class PrintArtworkUnavailableError extends Error {
  constructor() { super('PRINT_ARTWORK_UNAVAILABLE'); this.name = 'PrintArtworkUnavailableError'; }
}
