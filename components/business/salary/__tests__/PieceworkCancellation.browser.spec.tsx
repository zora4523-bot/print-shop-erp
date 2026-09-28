import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({ review: vi.fn(), cancel: vi.fn(), mutate: vi.fn() }));
vi.mock('@/actions/owner-piecework-cancellation', () => ({ reviewPieceworkCancellationAction: mocks.review, cancelPieceworkPlanAction: mocks.cancel }));
vi.mock('@/actions/owner-piecework-rules', () => ({ mutatePieceworkRulesAction: mocks.mutate }));
vi.mock('@/actions/owner-personal-piecework', () => ({ mutatePersonalPieceworkAction: mocks.mutate }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
import { CancelPieceworkPlan } from '../CancelPieceworkPlan';
import { PieceworkPriceBookForm } from '../PieceworkPriceBookForm';
import type { PieceworkAdminBook } from '@/lib/salary/piecework-admin';
const revision = { id: 'future', version: 2, effectiveFrom: '2035-01-01T00:00:00.000Z', effectiveTo: null, updatedAt: '2026-09-28T00:00:00.000Z' };
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.resetAllMocks(); mocks.review.mockResolvedValue({ status: 'success', review: { workerId: null, target: revision, predecessor: null, successor: null } });
  mocks.cancel.mockResolvedValue({ status: 'error', message: '相邻调价计划已变化，请重新核对后取消' });
  host = document.createElement('div'); host.className = 'p-4'; document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
it('failed cancellation preserves reason and request key; a fresh review clears the old error and refreshes the key', async () => {
  flushSync(() => root.render(<CancelPieceworkPlan workerId={null} targetId="future" />));
  await page.getByRole('button', { name: '取消调价计划', exact: true }).click();
  const reason = page.getByLabelText('取消原因（2 至 500 字）');
  await expect.element(page.getByRole('button', { name: '取消调价计划', exact: true })).toBeDisabled();
  expect(host.textContent).toContain('取消后该时段无法报工');
  expect(host.textContent).not.toContain('现有调价草稿继续保留');
  await reason.fill('误填的未来价格');
  const key = host.querySelector<HTMLInputElement>('[name="clientRequestId"]')!.value;
  await page.getByRole('button', { name: '取消调价计划', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('相邻调价计划已变化');
  await expect.element(reason).toHaveValue('误填的未来价格');
  expect(host.querySelector<HTMLInputElement>('[name="clientRequestId"]')!.value).toBe(key);
  expect((mocks.cancel.mock.calls[0][1] as FormData).get('reason')).toBe('误填的未来价格');
  await page.getByRole('button', { name: '重新核对计划', exact: true }).click();
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('[name="clientRequestId"]')!.value).not.toBe(key));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await expect.element(reason).toHaveValue('误填的未来价格');
});
it('flag off hides mutation but continues to label cancelled history correctly', async () => {
  const book: PieceworkAdminBook = { ...revision, effectiveTo: '', status: 'CANCELLED', workerId: null, useUnifiedRates: false, sourceName: '依据', publishNote: '调价说明', cancelledAt: '2026-09-28T01:00:00.000Z', cancelReason: '时间误填', rules: [] };
  flushSync(() => root.render(<PieceworkPriceBookForm books={[book]} now="2026-09-28T00:00:00.000Z" cancellationEnabled={false} />));
  expect(host.textContent).toContain('已取消'); expect(host.textContent).not.toContain('待生效'); expect(host.textContent).not.toContain('取消调价计划');
  await page.getByText('第 2 版', { exact: false }).click();
  expect(host.textContent).toContain('取消原因：时间误填');
  expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
});
it('future cancellation remains visible for an inactive worker and explains fallback without unified rates', async () => {
  mocks.review.mockResolvedValue({ status: 'success', review: { workerId: 'worker', target: revision, predecessor: null, successor: null } });
  const book: PieceworkAdminBook = { ...revision, effectiveTo: '', status: 'PUBLISHED', workerId: 'worker', useUnifiedRates: true, sourceName: '', publishNote: '恢复统一', cancelledAt: null, cancelReason: null, rules: [] };
  const cancelled: PieceworkAdminBook = { ...book, id: 'cancelled', version: 1, status: 'CANCELLED', cancelReason: '时间误填' };
  const draft: PieceworkAdminBook = { ...book, id: 'draft', version: 3, status: 'DRAFT' };
  flushSync(() => root.render(<PieceworkPriceBookForm books={[draft, book, cancelled]} now="2026-09-28T00:00:00.000Z" cancellationEnabled personal={{ workerId: 'worker', lane: null, canEdit: false, unifiedBooks: [] }} />));
  expect(host.querySelector('details')!.open).toBe(true);
  expect(host.textContent).toContain('取消调价计划'); expect(host.textContent).not.toContain('新建调价草稿');
  expect(host.textContent).not.toContain('继续编辑调价草稿');
  await page.getByRole('button', { name: '取消调价计划', exact: true }).click();
  await expect.element(page.getByText('该时段恢复使用统一工价；如当时尚未配置统一工价，将无法报工')).toBeVisible();
  await expect.element(page.getByText('已有工资保持不变。现有调价草稿继续保留。')).toBeVisible();
});

it('keeps cancellation feedback, history and draft continuation visible and returns focus after refreshed books arrive', async () => {
  mocks.cancel.mockResolvedValue({ status: 'success', message: '调价计划已取消' });
  const future: PieceworkAdminBook = { ...revision, effectiveTo: '', status: 'PUBLISHED', workerId: null, useUnifiedRates: false, sourceName: '依据', publishNote: '调整说明', cancelledAt: null, cancelReason: null, rules: [] };
  const draft: PieceworkAdminBook = { ...future, id: 'draft', version: 3, status: 'DRAFT' };
  const render = (book: PieceworkAdminBook) => flushSync(() => root.render(<PieceworkPriceBookForm books={[draft, book]} now="2026-09-28T00:00:00.000Z" cancellationEnabled />));
  render(future);
  await page.getByRole('button', { name: '取消调价计划', exact: true }).click();
  await page.getByLabelText('取消原因（2 至 500 字）').fill('计划时间误填');
  await page.getByRole('button', { name: '取消调价计划', exact: true }).click();
  await expect.element(page.getByRole('status')).toHaveTextContent('调价计划已取消');
  render({ ...future, status: 'CANCELLED', cancelReason: '计划时间误填' });
  await expect.element(page.getByRole('link', { name: '继续编辑调价草稿' })).toBeVisible();
  expect(host.querySelector('details')!.open).toBe(true);
  await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('summary')));
  // A later action replaces the old cancellation message instead of leaving
  // two conflicting live statuses in the same region.
  mocks.mutate.mockResolvedValue({ status: 'success', message: '草稿已保存' });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.element(page.getByRole('status')).toHaveTextContent('草稿已保存');
  expect(host.textContent).not.toContain('调价计划已取消');
});
