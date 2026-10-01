import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { batchOrder } from './admin-order-batch-fixture';
import { waitForStableLayout } from '@/tests/browser/wait-for-layout';
import '@/app/globals.css';

const { batchAction, refresh, sharedPanel } = vi.hoisted(() => ({
  batchAction: vi.fn(), refresh: vi.fn(), sharedPanel: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/admin-order-workflow', () => ({ runAdminOrderBatchAction: batchAction }));
vi.mock('@/components/business/order/AdminOrderDecisionPanel', () => ({
  AdminOrderDecisionPanel: (props: { order: AdminOrderWorkspaceRow; compact: boolean }) => {
    sharedPanel(props);
    return <div data-testid="shared-decision-panel">现有工单操作面板</div>;
  },
}));

import { AdminOrderDetailDecision } from '../AdminOrderDetailDecision';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-4';
  host.dataset.testid = 'order-detail-decision-fixture';
  document.body.append(host);
  root = createRoot(host);
  batchAction.mockReset();
  refresh.mockReset();
  sharedPanel.mockReset();
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

function printableOrder(overrides: Partial<AdminOrderWorkspaceRow> = {}): AdminOrderWorkspaceRow {
  const original = batchOrder();
  return {
    ...original, id: 'detail-print-order', orderNo: 'GD-260908-PRINT-001',
    revision: 7, workOrderVersion: 3, status: OrderStatus.FOILING,
    pendingPrintJobId: 'current-print-v3', printPending: true,
    capabilities: { ...original.capabilities, hold: false, release: false, markPrinted: true },
    ...overrides,
  };
}

function mount(order = printableOrder(), requiresPaperRecall = true) {
  flushSync(() => root.render(<AdminOrderDetailDecision order={order} requiresPaperRecall={requiresPaperRecall} />));
}

function completeResult(): AdminOrderBatchActionResult {
  return {
    status: 'success',
    result: {
      command: 'MARK_PRINTED', successCount: 1, skippedCount: 0, failedCount: 0, notAttemptedCount: 0,
      items: [{ orderId: 'detail-print-order', status: 'success', code: 'OK' }],
    },
  };
}

function skippedResult(): AdminOrderBatchActionResult {
  return {
    status: 'success',
    result: {
      command: 'MARK_PRINTED', successCount: 0, skippedCount: 1, failedCount: 0, notAttemptedCount: 0,
      items: [{ orderId: 'detail-print-order', status: 'skipped', code: 'STALE_VERSION', message: '工单版本已变化，请刷新核对。' }],
    },
  };
}

function partialResult(): AdminOrderBatchActionResult {
  return {
    status: 'partial_failure', message: 'PRIVATE_INTERNAL_ERROR',
    result: {
      command: 'MARK_PRINTED', successCount: 0, skippedCount: 0, failedCount: 1, notAttemptedCount: 0,
      items: [{ orderId: 'detail-print-order', status: 'failed', code: 'UNEXPECTED_ERROR', message: 'PRIVATE_DATABASE_DETAIL' }],
    },
  };
}

async function openRecall() {
  await page.getByRole('button', { name: '确认已打印', exact: true }).click();
  await expect.element(page.getByRole('alertdialog', { name: '确认 v3 已打印', exact: true })).toBeVisible();
}

async function acknowledgeRecall() {
  await page.getByRole('checkbox', { name: '我已收回并作废此前纸质工单', exact: true }).click();
}

async function submitRecall() {
  await acknowledgeRecall();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认已打印', exact: true }).click();
}

async function settleDialog() {
  await waitForStableLayout();
}

// 确认层统一走 ConfirmActionController（ui 审查 #10）：勾选「已收回」后才能确认，
// 确认即关闭确认层，结果回到详情页的 ActionNotice。
describe('admin detail print recall workflow', () => {
  it('requires actual recall acknowledgement and sends the current revision, work-order version and print job once', async () => {
    await page.viewport(1280, 900);
    let resolve!: (value: AdminOrderBatchActionResult) => void;
    batchAction.mockImplementation(() => new Promise<AdminOrderBatchActionResult>((done) => { resolve = done; }));
    mount();
    expect(sharedPanel.mock.lastCall?.[0].order.capabilities.markPrinted).toBe(false);
    await openRecall();
    await expect.element(page.getByRole('alertdialog').getByRole('button', { name: '确认已打印', exact: true })).toBeDisabled();
    expect(batchAction).not.toHaveBeenCalled();
    await acknowledgeRecall();
    const submit = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent === '确认已打印')!;
    submit.click();
    submit.click();
    await expect.element(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    expect(batchAction).toHaveBeenCalledOnce();
    expect(batchAction.mock.calls[0][0]).toEqual({
      requestId: expect.stringMatching(/^detail-print-[\da-f-]+$/), command: 'MARK_PRINTED',
      items: [{ orderId: 'detail-print-order', expectedRevision: 7, expectedWorkOrderVersion: 3, requestJobId: 'current-print-v3' }],
    });
    resolve(completeResult());
    await expect.element(page.getByText('已确认 v3 打印完成', { exact: true })).toBeVisible();
    // The action revalidated; its response already carries the fresh page (DECISIONS 2026-08-27).
    expect(refresh).not.toHaveBeenCalled();
    expect(batchAction).toHaveBeenCalledOnce();
  });

  it('a business skip stays visible and is not presented as a completed print', async () => {
    await page.viewport(393, 852);
    batchAction.mockResolvedValue(skippedResult());
    mount();
    await openRecall();
    await submitRecall();
    await expect.element(page.getByText('工单版本已变化，请刷新核对。', { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain('已确认 v3 打印完成');
    expect(refresh).not.toHaveBeenCalled();
    expect(batchAction).toHaveBeenCalledOnce();
  });

  for (const response of [
    { result: { status: 'invalid', fieldErrors: { items: ['INVALID_REVISION'] } } as AdminOrderBatchActionResult, message: '打印信息已变化，请刷新后重试。' },
    { result: { status: 'error', code: 'ORDER_PRINT_NOT_READY', message: '当前没有可标记的打印任务。' } as AdminOrderBatchActionResult, message: '当前没有可标记的打印任务。' },
  ]) {
    it(`${response.result.status}: reports a known rejection without inventing success`, async () => {
      await page.viewport(1280, 900);
      batchAction.mockResolvedValue(response.result);
      mount();
      await openRecall();
      await submitRecall();
      await expect.element(page.getByText(response.message, { exact: true })).toBeVisible();
      await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).toBeEnabled();
      expect(document.body.textContent).not.toMatch(/已确认 v3 打印完成|INVALID_REVISION/);
      expect(batchAction).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
    });
  }

  for (const mode of ['partial failure', 'transport failure'] as const) {
    it(`${mode}: prevents resubmission until the actual print result is checked`, async () => {
      await page.viewport(393, 852);
      if (mode === 'partial failure') batchAction.mockResolvedValue(partialResult());
      else batchAction.mockRejectedValue(new Error('PRIVATE_TRANSPORT_DETAIL'));
      mount();
      await openRecall();
      await submitRecall();
      await expect.element(page.getByText('打印结果尚未确认，请刷新工单核对后再处理。', { exact: true })).toBeVisible();
      expect(document.body.textContent).not.toMatch(/PRIVATE_|已确认 v3 打印完成/);
      await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).toBeDisabled();
      await expect.element(page.getByRole('button', { name: '刷新核对打印结果', exact: true })).toBeVisible();
      const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '确认已打印')!;
      trigger.click();
      expect(batchAction).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledTimes(mode === 'partial failure' ? 1 : 0);
    });
  }

  it('leaves first printing with the existing guarded panel without a paper-recall dialog', async () => {
    await page.viewport(1280, 900);
    mount(printableOrder({ workOrderVersion: 1, pendingPrintJobId: 'first-print-v1' }), false);
    expect(sharedPanel.mock.lastCall?.[0].order.capabilities.markPrinted).toBe(true);
    expect(sharedPanel.mock.lastCall?.[0].order.pendingPrintJobId).toBe('first-print-v1');
    await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    expect(batchAction).not.toHaveBeenCalled();
  });

  it('does not bypass capability or missing-print-job guards', async () => {
    await page.viewport(1280, 900);
    const original = printableOrder();
    mount({ ...original, capabilities: { ...original.capabilities, markPrinted: false } });
    await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).not.toBeInTheDocument();
    mount(printableOrder({ pendingPrintJobId: null }));
    await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).toBeDisabled();
    expect(batchAction).not.toHaveBeenCalled();
  });

  for (const theme of ['light', 'dark']) {
    it(`${theme}: mobile recall dialog has accessible controls and usable touch targets`, async () => {
      await page.viewport(375, 667);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      mount();
      await openRecall();
      await settleDialog();
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      const rect = dialog.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(668);
      for (const control of dialog.querySelectorAll<HTMLElement>('button, [role="checkbox"]')) {
        if (!control.checkVisibility()) continue;
        const box = control.getBoundingClientRect();
        expect(box.width, control.textContent ?? '').toBeGreaterThanOrEqual(44);
        expect(box.height, control.textContent ?? '').toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(375);
      }
      expect(await commands.checkShellAccessibility('[role="alertdialog"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).toHaveFocus();
    });
  }
});
