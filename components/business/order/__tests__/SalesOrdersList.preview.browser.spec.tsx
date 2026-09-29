import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { SalesOrdersList } from '../SalesOrdersList';
import { query, row } from './sales-orders-list-fixtures';

let host: HTMLElement;
let root: Root;

afterEach(() => {
  root.unmount();
  host.remove();
});

// The list cell shows the 160px OSS thumbnail; the enlarged gallery must load
// the original so style details stay legible (Codex review 2026-09-29).
it('opens the style photo gallery with full-size images, not the list thumbnails', async () => {
  const photo = {
    url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=#thumb',
    previewUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=#full',
    fileName: '端午正面.jpg',
  };
  const order = { ...row(), thumbnail: photo, items: [{ ...row().items[0]!, thumbnail: photo }] };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-27T08:00:00.000Z" />));

  const trigger = host.querySelector<HTMLElement>('[data-sales-order-thumbnail-trigger]')!;
  expect(trigger.querySelector('img')!.getAttribute('src')).toBe(photo.url);
  trigger.click();
  const preview = page.getByRole('img', { name: '第 1 款 端午定制 图1 的款式照片' });
  await expect.element(preview).toHaveAttribute('src', photo.previewUrl);
});
