import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { pdfStatusResponse } from '../status-response';
async function harness(initial = 202) {
  const response = pdfStatusResponse({ status: initial, title: '等待', message: '等待', code: initial === 503 ? 'PDF_WORKER_UNAVAILABLE' : undefined, retryUrl: '/api/orders/o/pdf?jobId=j' }, { orderId: 'o', operator: false, json: false });
  const html = await response.text(); const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  let now = 0; const callbacks: (() => Promise<void>)[] = [];
  const nodes = new Map(['main', 'retry', 'title', 'message', 'code'].map(id => [id, { href: 'https://erp.test/api/orders/o/pdf?jobId=j', textContent: '', removeAttribute: vi.fn() }]));
  let href = nodes.get('retry')!.href;
  Object.defineProperty(nodes.get('retry'), 'href', { get: () => href, set: (value: string) => { href = new URL(value, 'https://erp.test').href; } });
  const fetch = vi.fn(); const replace = vi.fn();
  runInNewContext(script!, { document: { querySelector: () => nodes.get('main'), getElementById: (id: string) => nodes.get(id) }, Date: { now: () => now }, URL, AbortSignal, fetch, location: { replace }, addEventListener: vi.fn(), setTimeout: (fn: () => Promise<void>) => callbacks.push(fn) });
  return { fetch, replace, nodes, callbacks, advance: (ms: number) => { now += ms; }, tick: async () => { expect(callbacks.length).toBeGreaterThan(0); await callbacks.shift()!(); } };
}
const unavailable = () => Response.json({ state: 'failed', code: 'PDF_WORKER_UNAVAILABLE', title: '暂不可用', message: '稍后重试', retryUrl: '/api/orders/o/pdf?jobId=j' }, { status: 503 });
it.each([202, 503])('recovers the same queued job from a %s page', async initial => {
  const h = await harness(initial); h.fetch.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(Response.json({ state: 'ready' }));
  await h.tick(); await h.tick(); expect(h.replace).toHaveBeenCalled();
  expect(String(h.fetch.mock.calls[1][0])).toContain('jobId=j');
});
it('bounds unavailable recovery and never retries a business failure or authorization denial', async () => {
  const h = await harness(); h.fetch.mockResolvedValue(unavailable()); h.advance(120000); await h.tick(); expect(h.callbacks).toHaveLength(0);
  for (const response of [Response.json({ state: 'failed', code: 'PDF_VERSION_CHANGED', retryUrl: '/api/orders/o/pdf', title: '已更新', message: '重试' }, { status: 500 }), new Response('', { status: 401 }), new Response('', { status: 403 })]) {
    const h = await harness(); h.fetch.mockResolvedValue(response); await h.tick(); expect(h.callbacks).toHaveLength(0);
  }
});
it('retries transient network errors within a finite budget', async () => {
  const h = await harness(); h.fetch.mockRejectedValue(new Error('offline'));
  await h.tick(); await h.tick(); await h.tick(); expect(h.callbacks).toHaveLength(0);
});
