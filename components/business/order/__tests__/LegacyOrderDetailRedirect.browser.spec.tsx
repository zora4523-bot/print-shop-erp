import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
const { router } = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
import { LegacyOrderDetailRedirect } from '../LegacyOrderDetailRedirect';
let host: HTMLDivElement;
let root: Root;
const orders = [{ id: 'record-1', orderNo: 'GD 1/甲' }];
const response = (id = 'record-2', orderNo = 'OTHER') => ({ ok: true, json: async () => ({ order: { id, orderNo } }) });
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
});
afterEach(() => {
  flushSync(() => root.unmount()); host.remove();
  history.replaceState(null, '', location.pathname); vi.unstubAllGlobals();
});
function render(hash: string) {
  history.replaceState(null, '', `${location.pathname}${hash}`);
  flushSync(() => root.render(<LegacyOrderDetailRedirect orders={orders} />));
}
it('opens a known legacy link without fetching or adding another history entry', async () => {
  render('#wo=GD%201%2F%E7%94%B2');
  await expect.poll(() => router.replace.mock.calls).toEqual([['/orders/record-1']]);
  expect(fetch).not.toHaveBeenCalled();
});
it('resolves off-page notification links through the authorized endpoint', async () => {
  render('#wo=OTHER');
  await expect.poll(() => router.replace.mock.calls).toEqual([['/orders/record-2']]);
  expect(fetch).toHaveBeenCalledWith('/api/orders/admin/OTHER', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
});
it.each([401,403,404,500])('keeps the list accessible on HTTP %i and supports retry', async (status) => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status } as Response);
  render('#wo=OTHER');
  await expect.element(page.getByRole('button', { name: '重试打开工单' })).toBeVisible();
  expect(router.replace).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '重试打开工单' }).click();
  await expect.poll(() => router.replace.mock.calls).toEqual([['/orders/record-2']]);
});
it('rejects mismatched records', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response('wrong', 'WRONG') as Response);
  render('#wo=OTHER');
  await expect.element(page.getByRole('button', { name: '重试打开工单' })).toBeVisible();
  expect(router.replace).not.toHaveBeenCalled();
});
it('ignores stale responses after the user changes the hash', async () => {
  let finish!: (result: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render('#wo=OTHER');
  history.replaceState(null, '', `${location.pathname}#wo=GD%201%2F%E7%94%B2`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await expect.poll(() => router.replace.mock.calls).toEqual([['/orders/record-1']]);
  finish(response() as Response);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(router.replace).toHaveBeenCalledTimes(1);
});
it('does nothing for ordinary section links', () => {
  render('#fees'); expect(fetch).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
});
