import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { SalesOrdersList } from '../SalesOrdersList';
import { query, row } from './sales-orders-list-fixtures';

let host: HTMLElement;
let root: Root;

afterEach(() => {
  root.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  host.remove();
  window.history.replaceState({}, '', window.location.pathname);
});

// The list cell shows the 160px OSS thumbnail; the enlarged gallery must load
// the original so style details stay legible (Codex review 2026-09-29).
it('opens the style photo gallery with full-size images, not the list thumbnails', async () => {
  await page.viewport(393, 852);
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
  await page.viewport(393, 852);
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

it('keeps all tracking and copy actions behind a visible desktop logistics entry', async () => {
  await page.viewport(1440, 900);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const order = { ...row(), shipment: { carrier: '中通', trackingNo: 'DESKTOP-TRACKING', additionalCount: 1 }, shipments: [
    { carrier: '中通', trackingNo: 'DESKTOP-TRACKING' }, { carrier: '顺丰', trackingNo: 'SECOND-TRACKING' },
  ] };
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-30T00:00:00.000Z" />));
  await expect.element(page.getByRole('button', { name: '查看物流', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看物流', exact: true }).click();
  const firstSection = document.querySelector('[data-slot=sheet-content] [role=region] section');
  expect(firstSection?.querySelector('h3')?.textContent).toBe('发货 · 2 个运单');
  await expect.element(page.getByRole('dialog').getByRole('button', { name: '复制运单号 DESKTOP-TRACKING' })).toBeVisible();
  await expect.element(page.getByRole('dialog').getByRole('button', { name: '复制运单号 SECOND-TRACKING' })).toBeVisible();
});


it('opens desktop order-number previews without losing the photo gallery and full-detail action', async () => {
  await page.viewport(1280, 800);
  const photo = { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=#thumb', previewUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=#full', fileName: '正面.jpg' };
  const order = { ...row(), items: [{ ...row().items[0]!, thumbnail: photo }] };
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-30T00:00:00Z" />));
  const table = host.querySelector('table')!;
  expect(table.querySelectorAll('img')).toHaveLength(0);
  await page.getByRole('button', { name: order.orderNo, exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect.element(drawer.getByRole('link', { name: '查看完整详情' })).toHaveAttribute('href', '/orders/order-1');
  await expect.element(drawer.getByText('记录版本 2', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '预览款式照片：端午定制，共 1 款' }).click();
  await expect.element(page.getByRole('img', { name: '第 1 款 端午定制 图1 的款式照片' })).toHaveAttribute('src', photo.previewUrl);
});

it('keeps ledger rows compact from 768px and confines horizontal scrolling to the table', async () => {
  host = document.createElement('div'); host.className = 'admin-viewport'; document.body.appendChild(host); root = createRoot(host);
  const order = { ...row(), pricingAttentionReason: null, pendingChangeRequest: null, needsAction: false };
  flushSync(() => root.render(<SalesOrdersList orders={[order]} query={query()} nowIso="2026-08-30T00:00:00Z" />));
  for (const width of [768, 1280, 1920]) {
    await page.viewport(width, 900);
    await expect.element(page.getByRole('region', { name: '销售工单明细表' })).toBeVisible();
    await expect.element(page.getByRole('list', { name: '销售工单列表', includeHidden: true })).not.toBeVisible();
    const ledgerRow = host.querySelector<HTMLElement>('[data-sales-order-row]')!;
    expect(ledgerRow.getBoundingClientRect().height).toBeLessThanOrEqual(76);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const scrollArea = host.querySelector<HTMLElement>('[data-slot=table-container]')!;
    if (width === 768) {
      expect(scrollArea.scrollWidth).toBeGreaterThan(scrollArea.clientWidth);
      for (const target of ledgerRow.querySelectorAll<HTMLElement>('button, a[href]')) {
        expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.viewport(393, 852);
  await expect.element(page.getByRole('list', { name: '销售工单列表' })).toBeVisible();
  await expect.element(page.getByRole('region', { name: '销售工单明细表', includeHidden: true })).not.toBeVisible();
});


it.each([
  [401, '<html>Prisma failure</html>', '登录已过期，请重新登录。'],
  [403, '{"error":"Secret reason"}', '工单不存在或无权查看，请返回工单列表。'],
  [404, '{}', '工单不存在或无权查看，请返回工单列表。'],
  [500, '<html>Prisma failure</html>', '工单明细加载失败，请返回列表后重新打开。'],
  [200, '<html>Prisma failure</html>', '工单明细加载失败，请返回列表后重新打开。'],
  [200, JSON.stringify({ order: { orderNo: 'ANOTHER-ORDER' } }), '工单明细加载失败，请返回列表后重新打开。'],
])('handles remote preview response %i without exposing raw errors', async (status, body, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.history.replaceState({}, '', `${window.location.pathname}#wo=REMOTE-ORDER`);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  flushSync(() => root.render(<SalesOrdersList orders={[row()]} query={query()} nowIso="2026-08-30T00:00:00Z" />));
  const drawer = page.getByRole('dialog');
  await expect.element(drawer.getByText(message, { exact: true })).toBeVisible();
  await expect.element(drawer).not.toHaveTextContent(/Prisma|Secret|ANOTHER-ORDER|不匹配/);
  await drawer.getByRole('button', { name: '返回工单列表' }).click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await page.viewport(393, 852);
  await page.getByRole('button', { name: '端午定制', exact: true }).click();
  await expect.element(page.getByRole('dialog').getByRole('link', { name: '查看完整详情' })).toBeVisible();
});
