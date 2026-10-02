import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import '@/app/globals.css';
const m = vi.hoisted(() => ({ start: vi.fn(), fetch: vi.fn(), record: vi.fn(), refresh: vi.fn(), openTab: vi.fn(), fetchFile: vi.fn(), deliverFile: vi.fn() }));
vi.mock('@/components/business/order/print-file-navigation', () => ({ openBlankPrintTab: m.openTab, fetchPrintFile: m.fetchFile, deliverPrintFile: m.deliverFile }));
vi.mock('@/actions/order-batch-print', () => ({ requestBatchPrintAction: m.start }));
vi.mock('@/actions/order-print-record', () => ({ recordBatchPrintAction: m.record }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
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
  m.record.mockResolvedValue({ status: 'success', marked: 2 });
  m.fetchFile.mockResolvedValue({ ok: true, blob: pdf });
  m.deliverFile.mockReturnValue(null);
});
const pdf = new Blob(['%PDF-test'], { type: 'application/pdf' });
// 打开 / 下载链接在测试里不真正导航，只验证点击时的记录。
function stayOnPage(event: MouseEvent) { if ((event.target as Element | null)?.closest('a')) event.preventDefault(); }
beforeEach(() => document.addEventListener('click', stayOnPage, true));
afterEach(() => document.removeEventListener('click', stayOnPage, true));
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

// 业主 2026-10-02：打开或下载打印文件即记已打印。先取得文件，再整批记录，记录成功才把已取得的文件
// 交给管理员；任一步失败都留在本页、可重试，不会出现没拿到文件却已记录。
it('fetches the file, records it, then hands the fetched file over and refreshes the list', async () => {
  let settle!: (value: unknown) => void;
  m.record.mockImplementationOnce(() => new Promise((done) => { settle = done; }));
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await page.getByRole('link', { name: '下载 PDF' }).click();
  await page.getByRole('link', { name: '打开 PDF' }).click();
  await expect.element(page.getByText('正在记为已打印…', { exact: true })).toBeVisible();
  expect(m.fetchFile).toHaveBeenCalledOnce();
  expect(m.fetchFile).toHaveBeenCalledWith('/api/orders/batch-print/job-1?view=download', expect.any(AbortSignal));
  expect(m.record).toHaveBeenCalledWith({ jobId: 'job-1', attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(m.fetchFile.mock.invocationCallOrder[0]).toBeLessThan(m.record.mock.invocationCallOrder[0]!);
  // 交付进行中不能生成新一批，免得结果和重试落到另一批上。
  await expect.element(page.getByRole('button', { name: '打印所选（2）' })).toBeDisabled();
  expect(m.deliverFile).not.toHaveBeenCalled();
  settle({ status: 'success', marked: 2 });
  await expect.element(page.getByText('已记为已打印 2 单。', { exact: true })).toBeVisible();
  expect(m.deliverFile).toHaveBeenCalledWith(pdf, 'download', null, 'orders-job-1.pdf');
  await expect.poll(() => m.refresh.mock.calls.length, { timeout: 2000 }).toBe(1);
  await expect.element(page.getByRole('button', { name: '打印所选（2）' })).toBeEnabled();
});
it('opens the preview tab during the click and offers a link when the browser blocks it', async () => {
  const tab = { close: vi.fn() };
  m.openTab.mockReturnValue(tab);
  m.deliverFile.mockReturnValueOnce(null).mockReturnValueOnce('blob:print-file');
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await page.getByRole('link', { name: '打开 PDF' }).click();
  expect(m.openTab).toHaveBeenCalledOnce();
  await expect.poll(() => m.deliverFile.mock.calls.length).toBe(1);
  expect(m.deliverFile).toHaveBeenCalledWith(pdf, 'inline', tab, 'orders-job-1.pdf');
  expect(tab.close).not.toHaveBeenCalled();
  m.openTab.mockReturnValue(null);
  await page.getByRole('link', { name: '打开 PDF' }).click();
  await expect.element(page.getByRole('link', { name: '打开打印文件', exact: true })).toHaveAttribute('href', 'blob:print-file');
  // 新的一次打开是新的打印尝试。
  expect(m.record.mock.calls[1]?.[0].attemptId).not.toBe(m.record.mock.calls[0]?.[0].attemptId);
});
it('keeps the page and does not record when the file cannot be fetched, and can be cancelled', async () => {
  const tab = { close: vi.fn() };
  m.openTab.mockReturnValue(tab);
  m.fetchFile.mockResolvedValueOnce({ ok: false, message: '打印文件暂不可用，请返回列表重新生成' });
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await page.getByRole('link', { name: '打开 PDF' }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('未能取得打印文件：打印文件暂不可用，请返回列表重新生成');
  expect(tab.close).toHaveBeenCalledOnce();
  expect(m.record).not.toHaveBeenCalled();
  expect(m.deliverFile).not.toHaveBeenCalled();
  // 取文件挂起时可以取消，取消后释放界面、可重试。
  m.fetchFile.mockImplementationOnce((_url: string, signal: AbortSignal) => new Promise((done) => {
    signal.addEventListener('abort', () => done({ ok: false, message: '已取消' }));
  }));
  await page.getByRole('button', { name: '重试打开', exact: true }).click();
  await expect.element(page.getByText('正在取得打印文件…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('未能取得打印文件：已取消');
  await expect.element(page.getByRole('button', { name: '打印所选（2）' })).toBeEnabled();
  expect(m.record).not.toHaveBeenCalled();
});
it('retries a failed record with the same attempt, reusing the fetched file when the record may have gone through', async () => {
  m.record.mockResolvedValueOnce({ status: 'error', message: '工单内容已变化，请重新选择并生成' }).mockRejectedValueOnce(new Error('offline'));
  mount(); await page.getByRole('button', { name: '打印所选（2）' }).click();
  await page.getByRole('link', { name: '下载 PDF' }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('未能取得打印文件：工单内容已变化，请重新选择并生成');
  expect(m.deliverFile).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '重试下载', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('未能取得打印文件：网络异常');
  expect(m.fetchFile).toHaveBeenCalledTimes(2);
  // 记录时网络中断（可能已记上）：重试只补记录，用已取得的文件，不再重新取。
  await page.getByRole('button', { name: '重试下载', exact: true }).click();
  await expect.poll(() => m.deliverFile.mock.calls.length).toBe(1);
  expect(m.fetchFile).toHaveBeenCalledTimes(2);
  const attempts = m.record.mock.calls.map((call) => call[0].attemptId);
  expect(new Set(attempts).size).toBe(1);
  expect(m.record).toHaveBeenCalledTimes(3);
  expect(m.start).toHaveBeenCalledOnce();
  // 刷新由页面级协调器合并：紧接上一次刷新时会在一秒内补一次尾随刷新。
  await expect.poll(() => m.refresh.mock.calls.length, { timeout: 2000 }).toBe(1);
});
