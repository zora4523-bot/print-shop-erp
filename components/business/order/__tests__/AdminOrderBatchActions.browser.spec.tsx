import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import '@/app/globals.css';

const { batchAction, refresh } = vi.hoisted(() => ({ batchAction: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/admin-order-workflow', () => ({ runAdminOrderBatchAction: batchAction }));
vi.mock('@/actions/order-export', () => ({ requestOrderExportAction: vi.fn() }));

import { AdminOrderBatchActions } from '../AdminOrderBatchActions';
import { AdminOrderBatchResultProvider } from '../AdminOrderBatchResultProvider';
import { OrderListBatchBar } from '../OrderListBatchSelection';
import { batchOrder, batchSelection } from './admin-order-batch-fixture';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-4';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.clearAllMocks();
});

function mount(orders = [batchOrder()], selectionKey = 'initial') {
  const selectedItems = batchSelection(orders);
  flushSync(() => root.render(
    <AdminOrderBatchResultProvider>
      <OrderListBatchBar key={selectionKey} selectedItems={selectedItems} onClear={() => {}}
        renderBatchActions={(selected) => <AdminOrderBatchActions orders={orders} selectedItems={selected} selectedExportRequestKey="export-test-request" />} />
    </AdminOrderBatchResultProvider>,
  ));
}

function partialResult(): AdminOrderBatchActionResult {
  return {
    status: 'partial_failure', message: 'INTERNAL_MESSAGE',
    result: { command: 'RELEASE_AND_CREATE_PRINT', successCount: 1, skippedCount: 1, failedCount: 1, notAttemptedCount: 1,
      items: [
        { orderId: 'order-0', status: 'success', code: 'OK' },
        { orderId: 'order-1', status: 'skipped', code: 'INVALID_STATUS', message: 'PENDING_FACTORY' },
        { orderId: 'order-2', status: 'failed', code: 'UNEXPECTED_ERROR', message: 'DB_DETAIL' },
        { orderId: 'order-3', status: 'not_attempted', code: 'ABORTED_AFTER_FAILURE', message: 'ABORTED' },
      ] },
  };
}

function mixedOrders(): AdminOrderWorkspaceRow[] {
  return Array.from({ length: 5 }, (_, index) => {
    const order = batchOrder({ id: `order-${index}`, orderNo: `GD-260907-00${index}` });
    return index === 4 ? { ...order, capabilities: { ...order.capabilities, release: false } } : order;
  });
}

async function review() {
  await page.getByRole('button', { name: '下发+打印（4）', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
  await settleAnimation('[data-slot="alert-dialog-content"]');
}

async function settleAnimation(selector: string) {
  await expect.poll(() => document.querySelector(selector)?.hasAttribute('data-starting-style')).toBe(false);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await Promise.all(document.querySelector(selector)!.getAnimations().map((animation) => animation.finished));
}

describe('admin order batch review', () => {
  it('requires review, submits only eligible reviewed rows and preserves complete results after queue refresh', async () => {
    await page.viewport(1280, 800);
    let resolve!: (result: AdminOrderBatchActionResult) => void;
    batchAction.mockImplementation(() => new Promise((done) => { resolve = done; }));
    mount(mixedOrders());
    await expect.element(page.getByRole('button', { name: '批量结算（0）', exact: true })).toBeDisabled();
    await review();
    expect(batchAction).not.toHaveBeenCalled();
    await expect.element(page.getByText(/已选 5 张，本次可处理 4 张/)).toBeVisible();
    await expect.element(page.getByText(/GD-260907-004：本次不处理/)).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(batchAction).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement?.textContent).toBe('下发+打印（4）');
    await review();
    await page.getByRole('button', { name: '确认下发+打印', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: '批量处理结果' }).getByText('正在逐单处理…', { exact: true })).toBeVisible();
    expect(batchAction).toHaveBeenCalledOnce();
    expect(batchAction.mock.calls[0][0]).toMatchObject({ command: 'RELEASE_AND_CREATE_PRINT', items: mixedOrders().slice(0, 4).map((order) => ({ orderId: order.id, expectedRevision: 4, expectedWorkOrderVersion: 2 })) });
    expect(batchAction.mock.calls[0][0]).not.toHaveProperty('reason');
    resolve(partialResult());
    await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
    assertConsistentSummary('成功 1 张，业务跳过 1 张，结果未知 1 张，未执行 1 张，未纳入处理 1 张');
    expect(document.querySelectorAll('[data-slot="batch-action-result-items"] > li')).toHaveLength(5);
    expect(document.querySelector('[data-slot="batch-action-result"]')?.textContent).not.toMatch(/INTERNAL_MESSAGE|INVALID_STATUS|PENDING_FACTORY|DB_DETAIL|ABORTED/);
    expect(refresh).toHaveBeenCalledOnce();
    mount([], 'refreshed-queue');
    await expect.element(page.getByRole('link', { name: 'GD-260907-003', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭结果', exact: true }).click();
    await expect.poll(() => document.activeElement?.textContent).toBe('查看批量结果');
    await page.getByRole('button', { name: '查看批量结果', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: '批量处理结果' })).toBeVisible();
  });

  it('keeps excluded rows separate from business skips in the toolbar and receipt after successful processing', async () => {
    await page.viewport(393, 852);
    batchAction.mockResolvedValue({
      status: 'success',
      result: {
        command: 'RELEASE_AND_CREATE_PRINT', successCount: 4, skippedCount: 0, failedCount: 0, notAttemptedCount: 0,
        items: mixedOrders().slice(0, 4).map((order) => ({ orderId: order.id, status: 'success', code: 'OK' })),
      },
    });
    mount(mixedOrders());
    await review();
    await page.getByRole('button', { name: '确认下发+打印', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: '请处理未完成的工单', exact: true })).toBeVisible();
    assertConsistentSummary('成功 4 张，业务跳过 0 张，结果未知 0 张，未执行 0 张，未纳入处理 1 张');
    expect(document.querySelectorAll('[data-slot="batch-action-result-items"] > li')).toHaveLength(5);
    await page.getByRole('button', { name: '关闭结果', exact: true }).click();
    await expect.element(page.getByRole('region', { name: '工单批量操作' }).getByText(/成功 4 张，业务跳过 0 张.*未纳入处理 1 张/)).toBeVisible();
  });

  it('shows settlement amounts before confirmation and preserves unknown outcomes on transport failure', async () => {
    await page.viewport(393, 852);
    const order = batchOrder();
    mount([{ ...order, capabilities: { ...order.capabilities, settle: true } }]);
    batchAction.mockRejectedValue(new Error('PRIVATE_STACK'));
    await page.getByRole('button', { name: '批量结算（1）', exact: true }).click();
    await expect.element(page.getByText('本次结算合计 ¥ 1,234.50', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认批量结算', exact: true }).click();
    await expect.element(page.getByText('结果未知', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/不要直接重复提交/)).toBeVisible();
    expect(document.body.textContent).not.toContain('PRIVATE_STACK');
  });
});

function assertConsistentSummary(expected: string) {
  const toolbar = document.querySelector('[aria-label="工单批量操作"] p[role="status"]');
  const receipt = document.querySelector('[data-slot="batch-action-result-summary"]');
  const persistent = document.querySelector('[data-slot="admin-order-batch-receipt-link"] p');
  expect(toolbar?.textContent).toBe(expected);
  expect(receipt?.textContent).toBe(expected);
  expect(persistent?.textContent).toBe(expected);
}

function assertGeometry(selector: string, width: number) {
  const panel = document.querySelector<HTMLElement>(selector)!;
  expect(panel).not.toBeNull();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  for (const control of panel.querySelectorAll<HTMLElement>('button, a[href]')) {
    if (!control.checkVisibility()) continue;
    const box = control.getBoundingClientRect();
    expect(box.width, control.textContent ?? '').toBeGreaterThanOrEqual(44);
    expect(box.height, control.textContent ?? '').toBeGreaterThanOrEqual(44);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
  }
}

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: batch confirmation and results remain accessible without overflow`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      batchAction.mockResolvedValue(partialResult());
      mount(mixedOrders());
      assertGeometry('[aria-label="工单批量操作"]', width);
      await review();
      assertGeometry('[data-slot="alert-dialog-content"]', width);
      expect(await commands.checkShellAccessibility('[data-slot="alert-dialog-content"]')).toEqual([]);
      await page.getByRole('button', { name: '确认下发+打印', exact: true }).click();
      await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
      await settleAnimation('[data-slot="dialog-content"]');
      assertGeometry('[data-slot="dialog-content"]', width);
      expect(await commands.checkShellAccessibility('[data-slot="dialog-content"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.activeElement?.textContent).toBe('查看批量结果');
    });
  }
}
