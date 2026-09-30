import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useLayoutEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderBatchCommand } from '@/lib/order/admin-batch';
import type { BatchOrderSnapshot } from '../admin-order-batch-ui';
import '@/app/globals.css';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a {...props} data-prefetch={String(prefetch)} />
  ),
}));

import { AdminOrderBatchResultProvider, useAdminOrderBatchResult } from '../AdminOrderBatchResultProvider';

let host: HTMLDivElement;
let root: Root;
let receipt: ReturnType<typeof useAdminOrderBatchResult>;

function ReceiptConsumer({ queueKey }: { queueKey: string }) {
  const context = useAdminOrderBatchResult();
  useLayoutEffect(() => { receipt = context; }, [context]);
  return <p>{queueKey}</p>;
}

function mount(queueKey = '待办工单') {
  flushSync(() => root.render(
    <AdminOrderBatchResultProvider>
      <ReceiptConsumer key={queueKey} queueKey={queueKey} />
    </AdminOrderBatchResultProvider>,
  ));
}

function reviewedOrders(): BatchOrderSnapshot[] {
  return Array.from({ length: 7 }, (_, index) => ({
    id: index === 0 ? 'order / first' : `order-${index}`,
    orderNo: `GD-260910-00${index}`,
    customName: null,
    revision: 4,
    workOrderVersion: 2,
    pendingPrintJobId: null,
    confirmedFee: '1234.50',
    productionOwners: [],
    eligible: index !== 6,
    reason: index === 6 ? '存在待审批申请，请先打开工单处理变更' : null,
  }));
}

function mixedResult(command: AdminOrderBatchCommand): AdminOrderBatchActionResult {
  return {
    status: 'partial_failure',
    message: 'PRIVATE_ERROR',
    result: {
      command, successCount: 2, skippedCount: 1, failedCount: 1, notAttemptedCount: 1,
      items: [
        { orderId: 'order / first', status: 'success', code: 'OK' },
        { orderId: 'order-1', status: 'success', code: 'OK' },
        { orderId: 'order-2', status: 'skipped', code: 'INVALID_STATUS', message: 'PRIVATE_STATUS' },
        { orderId: 'order-3', status: 'failed', code: 'UNEXPECTED_ERROR', message: 'PRIVATE_FAILURE' },
        { orderId: 'order-4', status: 'not_attempted', code: 'ABORTED_AFTER_FAILURE', message: 'PRIVATE_ABORT' },
      ],
    },
  };
}

function finish(command: AdminOrderBatchCommand, orders = reviewedOrders()) {
  flushSync(() => receipt.begin(command, orders));
  flushSync(() => receipt.complete(mixedResult(command)));
}

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
});

describe('batch receipt print handoff', () => {
  it.each(['RELEASE_AND_CREATE_PRINT', 'CREATE_PRINT'] as const)('%s offers a separate print link only for confirmed successful rows', async (command) => {
    await page.viewport(1280, 800);
    mount();
    flushSync(() => receipt.begin(command, reviewedOrders()));
    await expect.element(page.getByText('正在逐单处理…', { exact: true })).toBeVisible();
    expect(document.querySelectorAll('a[href$="?autoprint=1"]')).toHaveLength(0);
    flushSync(() => receipt.complete(mixedResult(command)));
    await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();

    expect(document.querySelectorAll('a[href$="?autoprint=1"]')).toHaveLength(2);
    for (const order of reviewedOrders().slice(0, 2)) {
      const link = page.getByRole('link', { name: `去打印工单 ${order.orderNo}`, exact: true });
      await expect.element(link).toBeVisible();
      await expect.element(link).toHaveAttribute('href', `/print/orders/${encodeURIComponent(order.id)}?autoprint=1`);
      await expect.element(link).toHaveAttribute('target', '_blank');
      await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
      // Native PDF anchors never enter Next's prefetch/router pipeline.
      await expect.element(link).not.toHaveAttribute('data-prefetch');
    }
    for (const order of reviewedOrders()) {
      await expect.element(page.getByRole('link', { name: order.orderNo, exact: true })).toHaveAttribute('href', `/orders/${encodeURIComponent(order.id)}`);
    }
    expect(document.querySelectorAll('[data-slot="batch-action-result-items"] > li')).toHaveLength(7);
    expect(document.body.textContent).not.toMatch(/PRIVATE_ERROR|PRIVATE_STATUS|PRIVATE_FAILURE|PRIVATE_ABORT/);

    mount('刷新后的工单列表');
    await expect.element(page.getByRole('link', { name: '去打印工单 GD-260910-000', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭结果', exact: true }).click();
    await expect.poll(() => document.activeElement?.textContent).toBe('查看批量结果');
    await page.getByRole('button', { name: '查看批量结果', exact: true }).click();
    await expect.element(page.getByRole('link', { name: '去打印工单 GD-260910-001', exact: true })).toBeVisible();
  });

  it.each(['MARK_PRINTED', 'SETTLE'] as const)('%s does not offer printing from its successful receipt', async (command) => {
    mount();
    finish(command);
    await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
    expect(document.querySelectorAll('[data-outcome="success"]')).toHaveLength(2);
    expect(document.querySelectorAll('a[href$="?autoprint=1"]')).toHaveLength(0);
  });

  it.each([
    null,
    { status: 'invalid', fieldErrors: { _form: ['INVALID_INPUT'] } },
    { status: 'error', code: 'FORBIDDEN', message: 'PRIVATE_ERROR' },
  ] satisfies (AdminOrderBatchActionResult | null)[])('does not imply printing succeeded for an unavailable or rejected response %#', async (response) => {
    mount();
    flushSync(() => receipt.begin('RELEASE_AND_CREATE_PRINT', reviewedOrders()));
    flushSync(() => receipt.complete(response));
    await expect.element(page.getByRole('dialog', { name: '批量处理结果', exact: true })).toBeVisible();
    expect(document.querySelectorAll('a[href$="?autoprint=1"]')).toHaveLength(0);
  });
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: successful print links fit the receipt and remain accessible`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      mount();
      const orders = reviewedOrders();
      orders[0].orderNo = `GD-${'1234567890'.repeat(6)}`;
      finish('RELEASE_AND_CREATE_PRINT', orders);
      await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
      const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
      await expect.poll(() => dialog.hasAttribute('data-starting-style')).toBe(false);
      await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
      for (const control of dialog.querySelectorAll<HTMLElement>('button, a[href]')) {
        if (!control.checkVisibility()) continue;
        const box = control.getBoundingClientRect();
        expect(box.width, control.textContent ?? '').toBeGreaterThanOrEqual(44);
        expect(box.height, control.textContent ?? '').toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      expect(await commands.checkShellAccessibility('[data-slot="dialog-content"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.activeElement?.textContent).toBe('查看批量结果');
    });
  }
}
