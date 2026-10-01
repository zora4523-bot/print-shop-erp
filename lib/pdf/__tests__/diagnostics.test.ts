import { afterEach, expect, it, vi } from 'vitest';
import { logPdfFailure } from '../diagnostics';
import { pdfStatusResponse } from '../status-response';
afterEach(() => vi.restoreAllMocks());
it.each([
  ['PdfBusyError', 'PDF_BUSY', 503], ['PdfBrowserUnavailableError', 'PDF_BROWSER_UNAVAILABLE', 503],
  ['TimeoutError', 'PDF_RENDER_TIMEOUT', 500], ['PrintFontUnavailableError', 'PDF_FONT_UNAVAILABLE', 503],
  ['secret-name', 'PDF_GENERATION_FAILED', 500],
])('classifies %s without exposing error text', async (name, code, status) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const error = new Error('https://secret.example?token=PRIVATE'); error.name = String(name);
  const failure = logPdfFailure(error, { mode: 'direct', stage: 'render', started: performance.now() });
  expect(failure).toMatchObject({ code, status });
  const response = pdfStatusResponse({ ...failure, title: 'PDF', retryUrl: '/retry' }, { orderId: 'o', json: false, operator: false });
  expect(response.headers.get('X-Request-Id')).toBe(failure.requestId);
  expect(log.mock.calls[0][1]).toMatchObject({ requestId: failure.requestId, code });
  expect(JSON.stringify(log.mock.calls) + await response.text()).not.toMatch(/PRIVATE|secret/);
});
