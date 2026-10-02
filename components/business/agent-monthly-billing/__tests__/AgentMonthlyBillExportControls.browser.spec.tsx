import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AgentMonthlyBillExportStatus } from '@/generated/prisma/enums';
import '@/app/globals.css';
const { refresh, router, request } = vi.hoisted(() => { const refresh = vi.fn(); return { refresh, router: { refresh }, request: vi.fn() }; });
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/actions/agent-monthly-bill-export', () => ({ requestAgentMonthlyBillExportAction: request }));
import { AgentMonthlyBillExportControls } from '../AgentMonthlyBillExportControls';

let host: HTMLDivElement;
let root: Root;
let poll: (() => void) | undefined;
let intervalId: ReturnType<typeof window.setInterval>;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); refresh.mockReset();
  request.mockReset().mockResolvedValue({ status: 'queued', exportId: 'export-a' });
  const original = window.setInterval;
  vi.spyOn(window, 'setInterval').mockImplementation((handler, delay, ...args) => {
    if (delay === 3_000 && typeof handler === 'function') { poll = () => handler(); intervalId = original.apply(window, [() => undefined, 2_147_483_647]); return intervalId; }
    return original.apply(window, [handler, delay, ...args]);
  });
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.restoreAllMocks(); poll = undefined; });
function mount(status: AgentMonthlyBillExportStatus = AgentMonthlyBillExportStatus.PENDING, empty = false) {
  flushSync(() => root.render(<AgentMonthlyBillExportControls requestKey="key" filter={{}} filteredTotal={1} recent={empty ? [] : [{ id: 'export-a', status, fileName: 'bill.xlsx', matchedBillCount: 1, byteSize: null, expiresAt: '2026-10-02T00:00:00Z', completedAt: null, createdAt: '2026-10-01T00:00:00Z', lastErrorCode: null }]} />));
}

it('pauses on a network failure and lets a manual refresh recover the status', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json({ export: { status: 'READY' } }));
  const clear = vi.spyOn(window, 'clearInterval');
  mount(); poll?.();
  await expect.element(page.getByText('网络连接失败，请手动刷新导出进度。', { exact: true }).last()).toBeVisible();
  expect(clear).toHaveBeenCalledWith(intervalId);
  await userEvent.click(page.getByRole('button', { name: '刷新', exact: true }));
  poll?.();
  await expect.poll(() => refresh.mock.calls.length).toBe(2);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not overlap slow status requests and aborts them on unmount', async () => {
  let signal: AbortSignal | undefined;
  const fetch = vi.spyOn(window, 'fetch').mockImplementation((_input, init) => { signal = init?.signal ?? undefined; return new Promise(() => undefined); });
  mount(); poll?.(); poll?.(); expect(fetch).toHaveBeenCalledTimes(1);
  flushSync(() => root.render(null)); expect(signal?.aborted).toBe(true);
});

it('limits automatic checking and preserves the pending export for a manual refresh', async () => {
  let expire: (() => void) | undefined;
  const original = window.setTimeout;
  vi.spyOn(window, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    if (delay === 120_000 && typeof handler === 'function') { expire = () => handler(); return original.apply(window, [() => undefined, 2_147_483_647]); }
    return original.apply(window, [handler, delay, ...args]);
  });
  mount(); flushSync(() => expire?.());
  await expect.element(page.getByText('导出仍可能在后台生成，自动检查已暂停。可手动刷新，无需重复提交。', { exact: true }).last()).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: '刷新', exact: true }));
  expect(refresh).toHaveBeenCalledOnce();
});

it('does not display malformed response contents and stops checking after an authorization failure', async () => {
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValueOnce(new Response('PRIVATE-SERVER-CONTENT', { headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response('{}', { status: 401 }));
  mount(); poll?.();
  await expect.element(page.getByText('网络连接失败，请手动刷新导出进度。', { exact: true }).last()).toBeVisible();
  expect(host.textContent).not.toContain('PRIVATE');
  await userEvent.click(page.getByRole('button', { name: '刷新', exact: true }));
  poll?.();
  await expect.element(page.getByText('登录已失效，请重新登录后查看导出记录。', { exact: true }).last()).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  [AgentMonthlyBillExportStatus.READY, '导出已生成。'],
  [AgentMonthlyBillExportStatus.FAILED, '导出文件生成失败，请重新导出。'],
  [AgentMonthlyBillExportStatus.EXPIRED, '导出文件已过期，请重新导出。'],
] as const)('replaces queued feedback once when the current export becomes %s', async (status, message) => {
  vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ export: { status } }));
  mount();
  await userEvent.click(page.getByRole('button', { name: '导出当前结果（1 张）', exact: true }));
  await expect.element(page.getByText('正在生成导出文件，完成后会显示下载按钮。', { exact: true })).toBeVisible();
  // The queued action result relies on the action's revalidatePath; only the
  // polling loop refreshes once the export turns terminal.
  expect(refresh).not.toHaveBeenCalled();
  poll?.();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  mount(status);
  await expect.element(page.getByText(message, { exact: true })).toBeVisible();
  expect(host.textContent).not.toContain('正在生成导出文件');
  expect(host.textContent).not.toContain('月账单导出状态已更新');
  if (status !== AgentMonthlyBillExportStatus.READY) {
    await expect.element(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    expect(refresh).toHaveBeenCalledTimes(2);
  }
  const announcements = [...host.querySelectorAll('[role="status"], [role="alert"]')].filter((node) => node.textContent?.trim());
  expect(announcements.map((node) => node.textContent?.trim())).toEqual([message]);
});

it.each([false, true])('has one recovery action for an action error with empty list=%s', async empty => {
  request.mockResolvedValue({ status: 'error', message: '导出失败，请重试。' });
  mount(AgentMonthlyBillExportStatus.PENDING, empty);
  await page.getByRole('button', { name: '导出当前结果（1 张）', exact: true }).click();
  await expect.element(page.getByText('导出失败，请重试。', { exact: true })).toBeVisible();
  const buttons = [...host.querySelectorAll('button')].filter(button => button.textContent?.trim().startsWith('刷新'));
  expect(buttons).toHaveLength(1); buttons[0].click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
});
