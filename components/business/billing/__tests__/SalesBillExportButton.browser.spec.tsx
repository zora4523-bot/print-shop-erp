import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { SalesBillExportButton } from '../SalesBillExportButton';
import '@/app/globals.css';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('keeps failed downloads on the page and allows retry without saving JSON or login HTML', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValueOnce(new Response('{"error":"private"}', { status: 503 })).mockResolvedValueOnce(new Response('login', { headers: { 'Content-Type': 'text/html' } }));
  const create = vi.spyOn(URL, 'createObjectURL');
  flushSync(() => root.render(<SalesBillExportButton href="/api/sales/bills/export" label="导出当前账单" />));
  await userEvent.click(page.getByRole('link', { name: '导出当前账单' }));
  await expect.element(page.getByRole('alert')).toHaveTextContent('暂时无法下载');
  await userEvent.click(page.getByRole('link', { name: '导出当前账单' }));
  await expect.element(page.getByRole('alert')).toHaveTextContent('未收到有效');
  expect(fetch).toHaveBeenCalledTimes(2); expect(create).not.toHaveBeenCalled();
  expect(host.querySelector('a')?.hasAttribute('download')).toBe(true);
});

it('guards duplicate downloads and aborts an unfinished request when unmounted', async () => {
  let signal: AbortSignal | undefined;
  const fetch = vi.spyOn(window, 'fetch').mockImplementation((_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise(() => undefined);
  });
  flushSync(() => root.render(<SalesBillExportButton href="/api/sales/bills/export" label="导出账单" />));
  const link = host.querySelector('a')!;
  flushSync(() => { link.click(); link.click(); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(link.getAttribute('aria-disabled')).toBe('true');
  flushSync(() => root.render(null)); expect(signal?.aborted).toBe(true);
});
