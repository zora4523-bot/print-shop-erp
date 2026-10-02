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
  await expect.element(page.getByText('等待打印服务恢复，将自动更新进度；如长时间未恢复，请联系管理员。')).toBeVisible();
  await page.getByRole('button', { name: '刷新进度' }).click();
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

it('shows manual refresh loading and completion even when progress has not changed', async () => {
  const unavailable = { ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) };
  m.fetch.mockResolvedValue(unavailable);
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByRole('button', { name: '等待打印服务恢复' })).toBeDisabled();
  const response = Promise.withResolvers<typeof unavailable>();
  m.fetch.mockReturnValueOnce(response.promise);
  await page.getByRole('button', { name: '刷新进度' }).click();
  await expect.element(page.getByRole('button', { name: '正在刷新…' })).toBeDisabled();
  expect(m.fetch).toHaveBeenCalledTimes(2);
  response.resolve(unavailable);
  await expect.element(page.getByText('进度已刷新。')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '刷新进度' })).toBeEnabled();
  expect(m.start).toHaveBeenCalledTimes(1);
});

it('automatically resumes the same task after the print service recovers', async () => {
  const originalTimeout = globalThis.setTimeout;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) =>
    originalTimeout(handler, delay === 10_000 ? 0 : delay, ...args));
  try {
    m.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) });
    mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
    await expect.element(page.getByRole('link', { name: '打开 PDF' })).toBeVisible();
    expect(m.start).toHaveBeenCalledTimes(1);
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(timer.mock.calls.some(([, delay]) => delay === 10_000)).toBe(true);
  } finally { timer.mockRestore(); }
});

it('reports a failed manual refresh and permits another attempt', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByRole('button', { name: '等待打印服务恢复' })).toBeVisible();
  m.fetch.mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: '刷新进度' }).click();
  await expect.element(page.getByText('刷新未成功，请稍后重试。')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '刷新进度' })).toBeEnabled();
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', completed: 2, total: 2, issues: [] }) });
  await page.getByRole('button', { name: '刷新进度' }).click();
  await expect.element(page.getByRole('link', { name: '打开 PDF' })).toBeVisible();
  expect(m.start).toHaveBeenCalledTimes(1);
});

it('ends manual refresh loading when the status request times out', async () => {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByRole('button', { name: '等待打印服务恢复' })).toBeVisible();
  const timeoutController = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
  try {
    m.fetch.mockImplementationOnce((_input: RequestInfo | URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
    }));
    await page.getByRole('button', { name: '刷新进度' }).click();
    await expect.element(page.getByRole('button', { name: '正在刷新…' })).toBeDisabled();
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeoutController.abort();
    await expect.element(page.getByText('刷新未成功，请稍后重试。')).toBeVisible();
    await expect.element(page.getByRole('button', { name: '刷新进度' })).toBeEnabled();
  } finally { timeout.mockRestore(); }
});

it.each(['unavailable', 'network'] as const)('bounds %s retries and allows a manual restart', async kind => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const original = globalThis.setTimeout; let next: (() => void) | undefined;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    if (delay === 10_000 && typeof handler === 'function') { next = () => handler(); return original(() => undefined, 2147483647); }
    return original(handler, delay, ...args);
  });
  try {
    if (kind === 'network') m.fetch.mockRejectedValue(new Error('offline'));
    else m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'unavailable', completed: 0, total: 2, issues: [] }) });
    mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
    await expect.poll(() => Boolean(next)).toBe(true);
    clock.mockReturnValue(now + 120000); const poll = next!; next = undefined; poll();
    await expect.element(page.getByText('暂时无法获取进度，已停止自动查询。请点击刷新进度重试。')).toBeVisible();
    expect(next).toBeUndefined(); expect(m.fetch).toHaveBeenCalledTimes(2);
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', completed: 2, total: 2, issues: [] }) });
    await page.getByRole('button', { name: '刷新进度' }).click();
    await expect.element(page.getByRole('link', { name: '打开 PDF' })).toBeVisible();
    expect(m.start).toHaveBeenCalledOnce();
  } finally { timer.mockRestore(); clock.mockRestore(); }
});
it.each([401, 403])('stops polling after authorization status %i', async status => {
  m.fetch.mockResolvedValue({ ok: false, status });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await expect.element(page.getByText('登录已失效或无权查看，请重新登录后重试。')).toBeVisible();
  expect(m.fetch).toHaveBeenCalledOnce();
});
