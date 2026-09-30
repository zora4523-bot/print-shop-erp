import type { LaunchOptions } from 'puppeteer';

/** Single download on the Web process, including the wait for the serial pool. */
export const PDF_DIRECT_BUDGET_MS = 45_000;
/** One HEAVY render, measured from the moment it owns the pool slot. */
export const PDF_WORKER_RENDER_BUDGET_MS = 60_000;
/**
 * Upper bound for a single CDP command, `Page.printToPDF` included. It equals
 * the longest render budget: a command outliving the whole budget can never
 * produce a usable PDF. It is not the cleanup bound — PdfBrowserPool applies
 * its own close/kill deadlines — so it must stay above the slowest legitimate
 * printToPDF measured on real large orders
 * (docs/audits/2026-09-30-pdf-browser-lifecycle.md).
 */
export const PDF_PROTOCOL_TIMEOUT_MS = PDF_WORKER_RENDER_BUDGET_MS;

/**
 * Every Chromium launch for PDF work uses these options. Puppeteer's own
 * signal handlers are disabled: on SIGINT they call `process.exit(130)`, which
 * would cut Next's graceful shutdown and the worker's queue drain. Puppeteer
 * still kills the browser's process group on normal process `exit`.
 */
export function pdfLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    timeout: 20_000,
    protocolTimeout: PDF_PROTOCOL_TIMEOUT_MS,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
}
