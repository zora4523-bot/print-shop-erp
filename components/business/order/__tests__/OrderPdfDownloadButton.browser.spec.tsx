import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

/**
 * 业主 2026-10-22「下载 PDF 不跳页、下载即记已打印」。此前这里是指向下载接口的链接，排队超过
 * 接口等待上限时整页被 HTML 兜底页替换，管理员要再点一次返回才能回到工单。
 *
 * 这里锁住页内交付的三条约定：进度与结果就地播报（ui-规范 §5.4 不用 toast）、记录成功后广播刷新、
 * 记录没成也照样把文件交给管理员并允许只补记录。
 */
const m = vi.hoisted(() => ({ fetchPdf: vi.fn(), deliver: vi.fn(), record: vi.fn(), refresh: vi.fn(), announce: vi.fn() }));
// Browser Mode 下相对路径的 vi.mock 不生效，必须用 `@/` 别名。
vi.mock('@/components/business/order/order-pdf-download', () => ({ fetchOrderPdf: m.fetchPdf }));
vi.mock('@/components/business/order/print-file-navigation', () => ({ deliverPrintFile: m.deliver }));
vi.mock('@/components/business/order/use-refresh-after-print', () => ({
  announcePrintRecorded: m.announce,
  refreshPageAfterPrint: m.refresh,
}));
vi.mock('@/actions/order-print-record', () => ({ recordOrderPdfDownloadAction: m.record }));
import { OrderPdfDownloadButton } from '../OrderPdfDownloadButton';

const pdf = new Blob(['%PDF-test'], { type: 'application/pdf' });
const CONTENT_KEY = 'a'.repeat(64);
let root: Root;
let host: HTMLDivElement;

function mount() {
  flushSync(() => root.render(<OrderPdfDownloadButton orderId="order-1" orderNo="GD-001" />));
}

beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  host.className = 'flex flex-wrap gap-2 p-4';
  host.setAttribute('role', 'main');
  document.body.append(host);
  root = createRoot(host);
  m.fetchPdf.mockResolvedValue({ ok: true, blob: pdf, contentKey: CONTENT_KEY, fileName: '工单-GD-001.pdf' });
  m.record.mockResolvedValue({ status: 'success', outcome: 'MARKED' });
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('downloads and reports the print record in place, without leaving the order page', async () => {
  const here = window.location.href;
  mount();
  await page.getByRole('button', { name: '下载 PDF' }).click();
  await expect.element(page.getByText('已下载 工单-GD-001.pdf。已记为已打印。')).toBeVisible();
  expect(m.record).toHaveBeenCalledWith({ orderId: 'order-1', contentKey: CONTENT_KEY, attemptId: expect.any(String) });
  expect(m.deliver).toHaveBeenCalledWith(pdf, 'download', null, '工单-GD-001.pdf');
  // 记上了才通知其他标签页并刷新本页，待打印提示随之消失。
  expect(m.announce).toHaveBeenCalledWith(['order-1']);
  expect(m.refresh).toHaveBeenCalled();
  expect(window.location.href).toBe(here);
});

it('keeps the order page when the file cannot be produced, and offers a retry', async () => {
  m.fetchPdf.mockResolvedValue({ ok: false, message: '生成时间较长，已停止等待，可重试或改用网页打印' });
  mount();
  await page.getByRole('button', { name: '下载 PDF' }).click();
  await expect.element(page.getByText('生成时间较长，已停止等待，可重试或改用网页打印')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '重试下载' })).toBeVisible();
  expect(m.deliver).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
});

it('hands over the file but offers no dead-end retry when the record is definitively refused', async () => {
  m.record.mockResolvedValue({ status: 'error', message: '工单内容已变化，请重新生成' });
  mount();
  await page.getByRole('button', { name: '下载 PDF' }).click();
  await expect.element(page.getByText('文件已下载，但未记为已打印：工单内容已变化，请重新生成')).toBeVisible();
  expect(m.deliver).toHaveBeenCalledTimes(1);
  // 同一尝试、同一 contentKey 只补记录必然再次被拒，不给这个死循环按钮；给的是重新下载当前版本，
  // 与播报里「请重新下载当前版本」一致。
  await expect.element(page.getByRole('button', { name: '重试记录' })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: '重试下载' })).toBeVisible();
});

it('retries the record alone when the result is unknown, without downloading twice', async () => {
  m.record.mockRejectedValue(new Error('network'));
  mount();
  await page.getByRole('button', { name: '下载 PDF' }).click();
  await expect.element(page.getByText('文件已下载，但未记为已打印：打印记录结果未知（网络异常）')).toBeVisible();
  expect(m.deliver).toHaveBeenCalledTimes(1);

  // 只补记录：不再取一次文件，也不再下第二份。
  m.record.mockResolvedValue({ status: 'success', outcome: 'MARKED' });
  await page.getByRole('button', { name: '重试记录' }).click();
  await expect.element(page.getByText('已下载 工单-GD-001.pdf。已记为已打印。')).toBeVisible();
  expect(m.fetchPdf).toHaveBeenCalledTimes(1);
  expect(m.deliver).toHaveBeenCalledTimes(1);
  // 同一次下载沿用同一尝试，重放不会重复记录。
  const attempts = m.record.mock.calls.map((call) => (call[0] as { attemptId: string }).attemptId);
  expect(new Set(attempts).size).toBe(1);
});

it('reports a stale download without claiming the paper was recorded', async () => {
  m.record.mockResolvedValue({ status: 'success', outcome: 'STALE' });
  mount();
  await page.getByRole('button', { name: '下载 PDF' }).click();
  await expect.element(page.getByText(/这份文件未记为已打印/)).toBeVisible();
  expect(m.deliver).toHaveBeenCalledTimes(1);
  expect(m.announce).not.toHaveBeenCalled();
});
