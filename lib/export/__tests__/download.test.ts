import { afterEach, expect, it, vi } from 'vitest';
import { fetchExportFile } from '../download';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
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
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});

it('maps a response-header timeout into a recoverable message', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, { signal }: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))));
  const result = expect(fetchExportFile('/api/file')).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(60_000);
  await result;
});

it.each(['caller', 'timeout', 'already-aborted'] as const)('forwards %s cancellation without AbortSignal.any or timeout', async source => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'any'); vi.spyOn(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  const caller = new AbortController();
  if (source === 'already-aborted') caller.abort(new DOMException('caller stopped', 'AbortError'));
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_href, { signal }: { signal: AbortSignal }) => {
    if (source === 'caller') caller.abort(new DOMException('caller stopped', 'AbortError'));
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }));
  const result = expect(fetchExportFile('/api/file', caller.signal)).rejects.toThrow(source === 'timeout' ? '超时' : 'caller stopped');
  if (source === 'timeout') await vi.advanceTimersByTimeAsync(60_000);
  await result;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
it('downloads normally without AbortSignal.any', async () => {
  vi.spyOn(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('csv', { headers: { 'Content-Type': 'text/csv' } })));
  expect((await fetchExportFile('/api/file', new AbortController().signal)).fileName).toBe('bills.csv');
});
it('allows a slow response body past 60 seconds but still supports caller cancellation', async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let stream: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_href, { signal }: { signal: AbortSignal }) => {
    receivedSignal = signal;
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } }), { headers: { 'Content-Type': 'text/csv' } }));
  }));
  const download = fetchExportFile('/api/file', caller.signal);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(receivedSignal?.aborted).toBe(false);
  stream!.enqueue(new TextEncoder().encode('large csv')); stream!.close();
  expect((await download).blob.size).toBe(9);
  const next = fetchExportFile('/api/file', caller.signal);
  await vi.advanceTimersByTimeAsync(120_000);
  const cancelled = expect(next).rejects.toThrow('caller stopped');
  caller.abort(new DOMException('caller stopped', 'AbortError'));
  await cancelled;
});
