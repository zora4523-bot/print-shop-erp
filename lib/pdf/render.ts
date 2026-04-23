import type { Browser, LaunchOptions, PDFOptions } from 'puppeteer';

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
  // Extra `page.pdf()` flags if a caller wants a non-A4 size. Defaults
  // come from SPEC 附录 E: A4 portrait with 15mm margins.
  pdf?: PDFOptions;
  // Extra `puppeteer.launch()` flags — mostly for tests, where a
  // pre-existing browser is injected via `browser` below.
  launch?: LaunchOptions;
  // Inject an already-launched browser (tests). When present, launch
  // is skipped and the caller retains responsibility for teardown.
  browser?: Browser;
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

  try {
    const page = await browser.newPage();
    // `networkidle0` is required so OSS-hosted design thumbnails have
    // finished loading before we snapshot. Inline SVG (QR codes)
    // doesn't trigger network activity, but image tags do.
    await page.setContent(opts.html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      ...opts.pdf,
    });
    return Buffer.from(pdf);
  } finally {
    // Only close the browser we launched. A caller-provided browser
    // is someone else's to dispose of (e.g. tests sharing one).
    if (!opts.browser) {
      await browser.close();
    }
  }
}
