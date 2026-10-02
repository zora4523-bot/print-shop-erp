import { afterEach, expect, it, vi } from 'vitest';
import { fetchExportFile } from '../download';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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

it.each(['caller', 'timeout', 'already-aborted'] as const)('forwards %s cancellation without AbortSignal.any', async source => {
  vi.spyOn(AbortSignal, 'any');
  // Removing the API models browsers that do not provide it at all.
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  const caller = new AbortController();
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  if (source === 'already-aborted') caller.abort(new DOMException('caller stopped', 'AbortError'));
  const removeCaller = vi.spyOn(caller.signal, 'removeEventListener');
  const removeTimeout = vi.spyOn(timeout.signal, 'removeEventListener');
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_href, { signal }: { signal: AbortSignal }) => {
    if (source === 'caller') caller.abort(new DOMException('caller stopped', 'AbortError'));
    if (source === 'timeout') timeout.abort(new DOMException('expired', 'TimeoutError'));
    return Promise.reject(signal.reason);
  }));
  await expect(fetchExportFile('/api/file', caller.signal)).rejects.toThrow(source === 'timeout' ? '超时' : 'caller stopped');
  expect(removeCaller).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(removeTimeout).toHaveBeenCalledWith('abort', expect.any(Function));
});
it('downloads normally without AbortSignal.any', async () => {
  vi.spyOn(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('csv', { headers: { 'Content-Type': 'text/csv' } })));
  expect((await fetchExportFile('/api/file', new AbortController().signal)).fileName).toBe('bills.csv');
});
