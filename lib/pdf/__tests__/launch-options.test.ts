import { afterEach, expect, it, vi } from 'vitest';
const puppeteer = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('puppeteer', () => ({ default: puppeteer, TimeoutError: class extends Error {} }));
import { PDF_DIRECT_BUDGET_MS, PDF_PROTOCOL_TIMEOUT_MS, PDF_WORKER_RENDER_BUDGET_MS, pdfLaunchOptions } from '../launch-options';
import { renderHtmlToPdf } from '../render';

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

it('never lets Puppeteer take over process signals', () => {
  // Puppeteer's SIGINT handler calls process.exit(130), cutting Next's graceful
  // shutdown and the worker's queue drain.
  expect(pdfLaunchOptions()).toMatchObject({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
});

it('keeps every CDP command within the longest render budget, never below it', () => {
  expect(PDF_PROTOCOL_TIMEOUT_MS).toBe(Math.max(PDF_DIRECT_BUDGET_MS, PDF_WORKER_RENDER_BUDGET_MS));
  expect(pdfLaunchOptions().protocolTimeout).toBe(PDF_PROTOCOL_TIMEOUT_MS);
});

it('uses the shared options for the one-off launch path, caller flags last', async () => {
  puppeteer.launch.mockRejectedValue(new Error('stop after launch'));
  await expect(renderHtmlToPdf({ html: '<html></html>', launch: { dumpio: true } })).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
  expect(puppeteer.launch).toHaveBeenCalledWith({ ...pdfLaunchOptions(), dumpio: true });
});

it('uses the shared options for the HEAVY and Web pools', async () => {
  puppeteer.launch.mockRejectedValue(new Error('no browser'));
  const { enableWorkerPdfBrowserReuse, closeWorkerPdfBrowser } = await import('../render');
  enableWorkerPdfBrowserReuse();
  await expect(renderHtmlToPdf({ html: '<html></html>' })).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
  await closeWorkerPdfBrowser();
  const once = vi.spyOn(process, 'once').mockImplementation(() => process);
  const { renderDirectOrderPdf } = await import('../direct');
  await expect(renderDirectOrderPdf({
    orderId: 'o', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 's', baseUrl: 'https://erp.test',
    html: async () => '<html></html>', signal: new AbortController().signal, regenerate: false,
  })).rejects.toMatchObject({ name: 'PdfBrowserUnavailableError' });
  expect(puppeteer.launch).toHaveBeenCalledTimes(2);
  for (const [options] of puppeteer.launch.mock.calls) expect(options).toEqual(pdfLaunchOptions());
  // The Web pool hooks shutdown only once it has tried to own a Chromium.
  expect(once.mock.calls.map(([signal]) => signal)).toEqual(['SIGINT', 'SIGTERM']);
});
