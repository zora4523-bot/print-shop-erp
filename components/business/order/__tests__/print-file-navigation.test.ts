import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPrintFile } from '../print-file-navigation';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// 业主 2026-10-02 点打印即记已打印：批量打印先取得文件；失败、取消、超时都要给出原因并释放界面。
describe('fetchPrintFile', () => {
  it('returns the file, or the server’s own message on an HTTP error', async () => {
    const blob = new Blob(['%PDF']);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(blob, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ error: '工单内容已变化，请返回列表重新选择并生成' }, { status: 409 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 })));
    const ok = await fetchPrintFile('/api/orders/batch-print/j?view=download', new AbortController().signal);
    expect(ok.ok && await ok.blob.text()).toBe('%PDF');
    await expect(fetchPrintFile('/x', new AbortController().signal)).resolves.toEqual({ ok: false, message: '工单内容已变化，请返回列表重新选择并生成' });
    await expect(fetchPrintFile('/x', new AbortController().signal)).resolves.toEqual({ ok: false, message: '打印文件暂不可用，请重新生成' });
  });

  it('distinguishes cancellation, timeout and network failure', async () => {
    const hang = (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    vi.stubGlobal('fetch', vi.fn(hang));
    const controller = new AbortController();
    const cancelled = fetchPrintFile('/x', controller.signal);
    controller.abort();
    await expect(cancelled).resolves.toEqual({ ok: false, message: '已取消' });

    vi.useFakeTimers();
    const timedOut = fetchPrintFile('/x', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(timedOut).resolves.toEqual({ ok: false, message: '取得文件超时，请检查网络后重试' });
    vi.useRealTimers();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchPrintFile('/x', new AbortController().signal)).resolves.toEqual({ ok: false, message: '网络异常' });
  });
});
