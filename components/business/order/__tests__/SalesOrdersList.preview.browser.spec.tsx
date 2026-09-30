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
  window.history.replaceState({}, '', window.location.pathname);
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
  await page.getByRole('button', { name: '预览款式照片：端午定制，共 1 款' }).click();
  const preview = page.getByRole('img', { name: '第 1 款 端午定制 图1 的款式照片' });
  await expect.element(preview).toHaveAttribute('src', photo.previewUrl);
});


it('previews every tracking number and the real shipment date for the order', async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const order = { ...row(), shippedAt: '2026-08-28T16:00:00.000Z', shipments: [
    { carrier: '中通', trackingNo: '111111' },
    { carrier: '顺丰', trackingNo: '222222' },
  ] };
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-30T00:00:00.000Z" />));
  await page.getByRole('button', { name: '端午定制', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect.element(drawer.getByRole('heading', { name: '发货 · 2 个运单' })).toBeVisible();
  await expect.element(drawer.getByRole('button', { name: '复制运单号 111111' })).toBeVisible();
  await expect.element(drawer.getByRole('button', { name: '复制运单号 222222' })).toBeVisible();
  await expect.element(drawer.getByText('2026/08/29', { exact: true })).toBeVisible();
  await expect.element(drawer.getByText('记录版本 2', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '关闭预览' }).click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

it('keeps tracking and its copy action discoverable in the desktop table', async () => {
  await page.viewport(1440, 900);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const order = { ...row(), shipment: { carrier: '中通', trackingNo: 'DESKTOP-TRACKING', additionalCount: 1 }, shipments: [
    { carrier: '中通', trackingNo: 'DESKTOP-TRACKING' }, { carrier: '顺丰', trackingNo: 'SECOND-TRACKING' },
  ] };
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-30T00:00:00.000Z" />));
  await expect.element(page.getByRole('button', { name: '复制单号', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '另有 1 个运单', exact: true }).click();
  await expect.element(page.getByRole('dialog').getByRole('button', { name: '复制运单号 SECOND-TRACKING' })).toBeVisible();
});
