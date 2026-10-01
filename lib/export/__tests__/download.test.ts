import { afterEach, expect, it, vi } from 'vitest';
import { fetchExportFile } from '../download';
afterEach(() => vi.unstubAllGlobals());
it.each([401, 404, 409, 410, 503])('rejects status %i instead of downloading JSON', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"private"}', { status })));
  await expect(fetchExportFile('/api/file')).rejects.toThrow();
});
it('rejects login HTML even with status 200', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('login', { headers: { 'Content-Type': 'text/html' } })));
  await expect(fetchExportFile('/api/file')).rejects.toThrow('有效');
});
it('accepts CSV with its sanitized filename and forwards an abort signal', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('\uFEFF账单', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="../bills.csv"' } }));
  vi.stubGlobal('fetch', fetch); const controller = new AbortController();
  const result = await fetchExportFile('/api/file', controller.signal);
  expect(result.fileName).toBe('.._bills.csv'); expect(result.blob.size).toBeGreaterThan(0);
  expect(fetch).toHaveBeenCalledWith('/api/file', { cache: 'no-store', signal: expect.any(AbortSignal) });
  controller.abort(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('maps a bounded download timeout into a recoverable message', async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { controller.abort(); return Promise.reject(new DOMException('expired', 'TimeoutError')); }));
  await expect(fetchExportFile('/api/file')).rejects.toThrow('超时'); timeout.mockRestore();
});
