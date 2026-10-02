import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { CdrHistoryRow } from '@/lib/cdr/history';
import '@/app/globals.css';

const m = vi.hoisted(() => ({ create: vi.fn(), progress: vi.fn(), refresh: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock('@/actions/cdr-workbench', () => ({ createWorkbenchBundleAction: m.create, getWorkbenchBundleProgressAction: m.progress }));
vi.mock('next/navigation', () => ({ useRouter: () => m.router }));
vi.mock('../RevokeBundleForm', () => ({ RevokeBundleForm: () => null }));
import { CdrWorkbench } from '../CdrWorkbench';
const old: CdrHistoryRow = { id: 'old', status: 'FAILED', isMock: false, downloadUrl: '', expiresAt: '2026-10-04T00:00:00Z', revokedAt: null, createdAt: '2026-10-01T00:00:00Z', createdByName: '管理员', orderCount: 1, fileCount: 2, downloadCount: 0, failureMessage: '打包失败' };
const pendingRow = { ...old, id: 'new', status: 'PENDING', failureMessage: null };
let host: HTMLDivElement; let root: Root;
let download: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  m.create.mockResolvedValue({ status: 'queued', bundleId: 'new' });
  flushSync(() => root.render(<CdrWorkbench orders={[]} bundles={[old]} mock={false} now="2026-10-02T00:00:00Z" />));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); download.mockRestore(); });
async function regenerate() {
  await page.getByText(/^下载记录（最近 1 条）/).click();
  await page.getByRole('button', { name: '按原工单重新生成', exact: true }).click();
}
it('tracks a history regeneration and automatically downloads its ready result once', async () => {
  m.progress.mockResolvedValue({ ...pendingRow, status: 'READY', downloadUrl: '/api/cdr/bundles/test-token' });
  await regenerate();
  await expect.poll(() => m.progress.mock.calls.length).toBe(1);
  expect(m.progress).toHaveBeenCalledWith('new');
  expect((m.create.mock.calls[0][1] as FormData).get('bundleId')).toBe('old');
  await expect.element(page.getByText('下载包已就绪', { exact: true })).toBeVisible();
  await expect.poll(() => download.mock.calls.length).toBe(1);
  expect(m.router.refresh).toHaveBeenCalledOnce();
});
it('clears an old warning when manual retry successfully reads a pending bundle', async () => {
  m.progress.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pendingRow);
  await regenerate();
  await expect.element(page.getByText('进度读取失败，请刷新进度重试')).toBeVisible();
  await page.getByRole('button', { name: '刷新进度', exact: true }).click();
  await expect.poll(() => m.progress.mock.calls.length).toBe(2);
  await expect.element(page.getByText('进度读取失败，请刷新进度重试')).not.toBeInTheDocument();
  await expect.element(page.getByText('正在生成下载包', { exact: true })).toBeVisible();
  expect(download).not.toHaveBeenCalled();
});
it('replaces a prior progress warning when a new history submission is accepted', async () => {
  m.progress.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...pendingRow, id: 'newer' });
  await regenerate();
  await expect.element(page.getByText('进度读取失败，请刷新进度重试')).toBeVisible();
  m.create.mockResolvedValue({ status: 'queued', bundleId: 'newer' });
  await page.getByRole('button', { name: '按原工单重新生成', exact: true }).click();
  await expect.poll(() => m.progress.mock.calls.length).toBe(2);
  expect(m.progress).toHaveBeenLastCalledWith('newer');
  await expect.element(page.getByText('进度读取失败，请刷新进度重试')).not.toBeInTheDocument();
});
