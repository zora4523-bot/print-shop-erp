import type { Browser, Page } from 'puppeteer';
import { TimeoutError } from 'puppeteer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_PRINT_READY_TIMEOUT_MS,
  renderHtmlToPdf,
} from '../render';

function renderHarness() {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    emulateMediaType: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue('ready'),
    pdf: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
  return { browser, page };
}

afterEach(() => vi.unstubAllEnvs());
describe('renderHtmlToPdf', () => {
  it('rejects browser version drift before creating a render page', async () => {
    const { browser } = renderHarness();
    browser.version = vi.fn().mockResolvedValue('Chrome/147.0.0.1');
    vi.stubEnv('PDF_CHROMIUM_VERSION', '147.0.0.2');
    await expect(renderHtmlToPdf({ html: '<html></html>', browser })).rejects.toThrow('PDF_BROWSER_VERSION_MISMATCH');
    expect(browser.newPage).not.toHaveBeenCalled();
  });

  it.each(['failed', 'loading', 'unprepared'])('rejects unavailable print fonts (%s)', async (state) => {
    const { browser, page } = renderHarness();
    vi.mocked(page.evaluate).mockResolvedValue(state);
    await expect(renderHtmlToPdf({ html: '<html></html>', browser })).rejects.toMatchObject({ name: 'PrintFontUnavailableError' });
    expect(page.pdf).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
  });
  it.each(['overflow', 'unprepared', 'pending'])('rejects unverified pagination (%s) instead of exporting clipped content', async (state) => {
    const { browser, page } = renderHarness();
    vi.mocked(page.evaluate).mockResolvedValueOnce('ready').mockResolvedValue(state);
    await expect(renderHtmlToPdf({ html: '<html></html>', browser }))
      .rejects.toMatchObject({ name: 'PrintLayoutOverflowError' });
    expect(page.pdf).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
  });
  it('waits for print readiness and enforces the A4 color-print contract', async () => {
    const { browser, page } = renderHarness();

    const result = await renderHtmlToPdf({
      html: '<html><body>print</body></html>',
      browser,
      // Invariant options must win over accidental caller overrides.
      pdf: {
        format: 'Letter',
        printBackground: false,
        preferCSSPageSize: false,
        margin: { top: '20mm' },
      },
    });

    expect(page.setContent).toHaveBeenCalledWith(
      '<html><body>print</body></html>',
      { waitUntil: 'load' },
    );
    expect(page.waitForNetworkIdle).toHaveBeenCalledWith({ concurrency: 0, signal: undefined });
    expect(page.waitForNetworkIdle).toHaveBeenCalledBefore(vi.mocked(page.pdf));
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        timeout: PDF_PRINT_READY_TIMEOUT_MS,
        signal: undefined,
      },
    );
    expect(page.emulateMediaType).toHaveBeenCalledWith('print');
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(Buffer.from(result)).toEqual(Buffer.from([1, 2, 3]));
    expect(page.close).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('continues after the bounded readiness timeout', async () => {
    const { browser, page } = renderHarness();
    vi.mocked(page.waitForFunction).mockRejectedValue(
      new TimeoutError('print readiness timed out'),
    );

    await expect(
      renderHtmlToPdf({ html: '<html></html>', browser }),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));

    expect(page.emulateMediaType).toHaveBeenCalledWith('print');
    expect(page.pdf).toHaveBeenCalledOnce();
  });

  it('preserves abort semantics while waiting for readiness', async () => {
    const { browser, page } = renderHarness();
    const controller = new AbortController();
    vi.mocked(page.waitForFunction).mockImplementation(async () => {
      controller.abort();
      throw new Error('page wait interrupted');
    });

    await expect(
      renderHtmlToPdf({
        html: '<html></html>',
        browser,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(page.pdf).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });
});

it('rejects failed uploaded artwork before producing a cacheable PDF', async () => {
  const { browser, page } = renderHarness();
  vi.mocked(page.evaluate).mockResolvedValueOnce('ready').mockResolvedValueOnce('ready').mockResolvedValueOnce(true);
  await expect(renderHtmlToPdf({ html: '<html></html>', browser, requireArtwork: true })).rejects.toMatchObject({ name: 'PrintArtworkUnavailableError' });
  expect(page.pdf).not.toHaveBeenCalled();
  expect(page.close).toHaveBeenCalledOnce();
});

it('preserves the warning PDF contract while reporting incomplete artwork to the cache', async () => {
  const { browser, page } = renderHarness();
  vi.mocked(page.evaluate).mockResolvedValueOnce('ready').mockResolvedValueOnce('ready').mockResolvedValueOnce(true);
  const unavailable = vi.fn();
  await renderHtmlToPdf({ html: '<html></html>', browser, onArtworkUnavailable: unavailable });
  expect(unavailable).toHaveBeenCalledOnce();
  expect(page.pdf).toHaveBeenCalledOnce();
});
