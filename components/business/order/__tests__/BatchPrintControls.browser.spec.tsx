import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import '@/app/globals.css';
const m = vi.hoisted(() => ({ start: vi.fn(), fetch: vi.fn() }));
vi.mock('@/actions/order-batch-print', () => ({ requestBatchPrintAction: m.start }));
import { BatchPrintControls } from '../BatchPrintControls';
const originalFetch = globalThis.fetch.bind(globalThis);
let root: Root;
let host: HTMLDivElement;
function items(count: number) { return Array.from({ length: count }, (_, i) => ({ id: `order-${i}`, orderNo: `GD-${i}`, status: OrderStatus.PENDING_FACTORY, canSchedule: true })); }
function mount(count = 2) { flushSync(() => root.render(<BatchPrintControls selectedItems={items(count)} />)); }
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div'); host.className = 'p-4'; host.setAttribute('role', 'main'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('/api/orders/batch-print/') ? m.fetch(input, init) : originalFetch(input, init));
  m.start.mockResolvedValue({ status: 'queued', jobId: 'job-1' });
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', completed: 2, total: 2, issues: [] }) });
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); document.documentElement.classList.remove('dark'); });
it('submits selected order and offers both download and preview', async () => {
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByRole('link', { name: '下载 PDF' })).toBeVisible();
  expect(m.start).toHaveBeenCalledWith({ requestId: expect.any(String), orderIds: ['order-0', 'order-1'] });
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/api/orders/batch-print/job-1?view=download');
  await expect.element(page.getByRole('link', { name: '打开 PDF' })).toBeVisible();
});
it('disables submissions larger than 50 orders', async () => {
  mount(51); await expect.element(page.getByRole('button', { name: '打印所选（51）' })).toBeDisabled();
  expect(m.start).not.toHaveBeenCalled();
});
it('keeps the same task when the worker is offline', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByText('打印服务暂不可用，请稍后查看进度；如仍不可用，请联系管理员。')).toBeVisible();
  await page.getByRole('button', { name: '查看进度' }).click();
  expect(m.start).toHaveBeenCalledTimes(1);
});
it('identifies the failed order and allows another submission', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'failed', completed: 1, total: 2, issues: [{ position: 2, message: '工单内容已变化' }] }) });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByText('GD-1：工单内容已变化')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '打印所选（2）' })).toBeEnabled();
  expect(host.querySelector('a')).toBeNull();
});
it.each([375, 390, 768, 1024, 1280, 1440])('fits %i px in light and dark themes', async (width) => {
  await page.viewport(width, 900);
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark);
    mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
    await expect.element(page.getByRole('link', { name: '下载 PDF' })).toBeVisible();
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    expect(await commands.checkShellAccessibility('body')).toEqual([]);
  }
});

it('identifies results from the previous selection', async () => {
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByRole('link', { name: '下载 PDF' })).toBeVisible();
  mount(1);
  await expect.element(page.getByText('所选工单已变化，下方生成结果仍对应此前提交的 2 单。')).toBeVisible();
  expect(host.querySelector('a')?.getAttribute('href')).toContain('job-1');
});

it('explains queueing and disables repeated submissions', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'pending', phase: 'queued', completed: 0, total: 2, issues: [] }) });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByText('正在排队，请勿重复提交。')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '正在准备打印…' })).toBeDisabled();
});

it('continues checking after two minutes and exposes the finished PDF', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const originalTimeout = globalThis.setTimeout;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) =>
    originalTimeout(handler, delay === 10_000 ? 0 : delay, ...args));
  try {
    m.fetch.mockResolvedValueOnce({ ok: true, json: async () => {
      clock.mockReturnValue(now + 130_000);
      return { status: 'pending', phase: 'merging', completed: 2, total: 2, issues: [] };
    } });
    mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
    await expect.element(page.getByRole('link', { name: '下载 PDF' })).toBeVisible();
    expect(timer.mock.calls.some(([, delay]) => delay === 10_000)).toBe(true);
  } finally { timer.mockRestore(); clock.mockRestore(); }
});
