import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
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

  flushSync(() =>
    root.render(<ReceiptNotice receipt={receiptFromLocation()} noun="BOM" />),
  );

  await expect.element(page.getByRole('status')).toHaveTextContent('BOM已创建');
  await expect.poll(() => window.location.search).toBe('?page=2');
  expect(window.location.pathname).toBe('/owner/boms/bom1');
  expect(window.location.hash).toBe('#items');
  // The notice stays rendered after the URL is cleaned: the receipt lives in
  // the server-rendered tree, not in the address bar.
  await expect.element(page.getByRole('status')).toBeVisible();
});

it('leaves the address bar alone when nothing is rendered', async () => {
  window.history.replaceState(null, '', '/owner/bills/archive/b1?issued=1');

  flushSync(() => root.render(<ReceiptNotice receipt={receiptFromLocation()} />));

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(host.innerHTML).toBe('');
  expect(window.location.search).toBe('?issued=1');
});
