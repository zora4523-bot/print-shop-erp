import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ReceiptNotice } from '../ReceiptNotice';
import { readReceipt } from '@/lib/admin/receipt';
import '@/app/globals.css';

let host: HTMLDivElement;
let root: Root;
const originalHref = window.location.href;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  window.history.replaceState(null, '', originalHref);
});

function receiptFromLocation() {
  return readReceipt(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  );
}

it('shows the receipt and strips only the receipt keys from the address bar', async () => {
  window.history.replaceState(null, '', '/owner/boms/bom1?created=1&page=2#items');
  const replaceState = vi.spyOn(window.history, 'replaceState');

  flushSync(() =>
    root.render(<ReceiptNotice receipt={receiptFromLocation()} noun="BOM" />),
  );

  await expect.element(page.getByRole('status')).toHaveTextContent('BOM已创建');
  await expect.poll(() => window.location.search).toBe('?page=2');
  expect(window.location.pathname).toBe('/owner/boms/bom1');
  expect(window.location.hash).toBe('#items');
  // Next 的 history 包装层只在 state 不带 __NA 时才同步 canonical URL，
  // 所以这里必须是 null，让 Next 自己补内部字段。
  expect(replaceState).toHaveBeenCalledTimes(1);
  expect(replaceState.mock.calls[0]?.[0]).toBeNull();
  replaceState.mockRestore();
  // The notice stays rendered after the URL is cleaned: the receipt lives in
  // the server-rendered tree, not in the address bar.
  await expect.element(page.getByRole('status')).toBeVisible();
});

it('cleans up again when a second receipt with the same keys arrives without remounting', async () => {
  window.history.replaceState(null, '', '/owner/salary/hourly?month=2026-08&marked=Alice&markedPaid=1');
  const messages = {
    marked: (name: string) => ({ title: `${name} 已标记发放` }),
  };
  const read = () =>
    readReceipt(
      Object.fromEntries(new URLSearchParams(window.location.search)),
      ['marked', 'markedPaid'],
    );

  flushSync(() => root.render(<ReceiptNotice receipt={read()} messages={messages} />));
  await expect.poll(() => window.location.search).toBe('?month=2026-08');

  // 第二次操作：Server Action 再次 redirect 到同一页，组件不重挂载。
  window.history.replaceState(null, '', '/owner/salary/hourly?month=2026-08&marked=Bob&markedPaid=1');
  flushSync(() => root.render(<ReceiptNotice receipt={read()} messages={messages} />));

  await expect.element(page.getByRole('status')).toHaveTextContent('Bob 已标记发放');
  await expect.poll(() => window.location.search).toBe('?month=2026-08');
});

it('leaves the address bar alone when nothing is rendered', async () => {
  window.history.replaceState(null, '', '/owner/bills/archive/b1?issued=1');

  flushSync(() => root.render(<ReceiptNotice receipt={receiptFromLocation()} />));

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(host.innerHTML).toBe('');
  expect(window.location.search).toBe('?issued=1');
});
