import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { OrderStatus } from '@/generated/prisma/enums';
import { waitForStableLayout } from '@/tests/browser/wait-for-layout';
import '@/app/globals.css';

const { batchAction, refresh, printAction, printFetch } = vi.hoisted(() => ({ batchAction: vi.fn(), refresh: vi.fn(), printAction: vi.fn(), printFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/admin-order-workflow', () => ({ runAdminOrderBatchAction: batchAction }));
vi.mock('@/actions/order-batch-print', () => ({ requestBatchPrintAction: printAction }));
vi.mock('@/actions/order-print-record', () => ({ recordBatchPrintAction: vi.fn(), recordOrderPrintedAction: vi.fn() }));
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
  vi.unstubAllGlobals();
});

function mount(orders = [batchOrder()], selectionKey = 'initial') {
  const selectedItems = batchSelection(orders);
  flushSync(() => root.render(
    <AdminOrderBatchResultProvider>
      <OrderListBatchBar key={selectionKey} selectedItems={selectedItems} onClear={() => {}} layout="inline" showCopyOrderNumbers={false}
        renderBatchActions={(selected) => <AdminOrderBatchActions orders={orders} selectedItems={selected} selectedExportRequestKey="export-test-request" />} />
    </AdminOrderBatchResultProvider>,
  ));
}

function partialResult(): AdminOrderBatchActionResult {
  return {
    status: 'partial_failure', message: 'INTERNAL_MESSAGE',
    result: { command: 'SETTLE', successCount: 1, skippedCount: 1, failedCount: 1, notAttemptedCount: 1,
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
    const order = batchOrder({ id: `order-${index}`, orderNo: `GD-260907-00${index}`, status: OrderStatus.SHIPPED });
    return { ...order, capabilities: { ...order.capabilities, release: false, settle: index !== 4 } };
  });
}

async function review() {
  await page.getByRole('button', { name: '批量结算（4）', exact: true }).click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
  await settleAnimation('[data-slot="alert-dialog-content"]');
}

async function settleAnimation(selector: string) {
  expect(document.querySelector(selector), selector).not.toBeNull();
  await waitForStableLayout();
}

describe('admin order batch review', () => {
  it('shows only applicable actions as the selected orders change', async () => {
    const order = batchOrder({ canAssignProduction: true });
    mount([order]);
    const toolbar = page.getByRole('region', { name: '工单批量操作' });
    await expect.element(toolbar.getByRole('link', { name: '安排生产师傅', exact: true })).toHaveAttribute('href', '/orders/production?ids=order-1');
    await expect.element(toolbar.getByRole('button', { name: /下发生产/ })).not.toBeInTheDocument();
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      '打印所选（1）', '导出所选', '取消选择',
    ]);

    mount([{ ...order, status: OrderStatus.RELEASED, pendingPrintJobId: 'print-1',
      capabilities: { ...order.capabilities, release: false, markPrinted: true } }]);
    // 业主 2026-10-02：打印即记已打印——待打印的工单只剩「打印所选」，没有单独的确认已打印。
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['打印所选（1）', '导出所选', '取消选择']);

    mount([{ ...order, status: OrderStatus.SHIPPED, canAssignProduction: false,
      capabilities: { ...order.capabilities, release: false, settle: true } }]);
    await expect.element(toolbar.getByRole('button', { name: '批量结算（1）', exact: true })).toBeVisible();
    await expect.element(toolbar.getByRole('link', { name: '安排生产师傅' })).not.toBeInTheDocument();
    await expect.element(toolbar.getByRole('button', { name: '安排生产师傅' })).not.toBeInTheDocument();
    await expect.element(toolbar.getByText(/请重新选择/)).not.toBeInTheDocument();
    await expect.element(toolbar.getByRole('button', { name: /下发生产|更多操作/ })).not.toBeInTheDocument();

    // Missing confirmed money cannot create a settlement shortcut.
    mount([{ ...order, capabilities: { ...order.capabilities, release: false, markPrinted: true, settle: true },
      feeStages: { ...order.feeStages, confirmed: null } }]);
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['打印所选（1）', '导出所选', '取消选择']);
    expect(batchAction).not.toHaveBeenCalled();
  });

  it('reviews print requests from More, returns focus on cancel and submits the reviewed selection', async () => {
    const order = printRequestOrder();
    mount([order, batchOrder({ id: 'not-printable' })]);
    await expect.element(page.getByRole('button', { name: /加入待打印/ })).not.toBeInTheDocument();
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '加入待打印（1）', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '确认加入待打印', exact: true });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText('已选 2 张，本次可处理 1 张', { exact: true })).toBeVisible();
    expect(batchAction).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect.poll(() => document.activeElement?.textContent).toBe('更多操作');

    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('menu')).toBeVisible();
    // Base UI moves focus into the menu on a later frame; keys sent before that reach the trigger and close it.
    await waitForStableLayout();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(dialog).toBeVisible();
    // A refreshed row must not silently replace the version already reviewed.
    mount([{ ...order, revision: 99, workOrderVersion: 3 }, batchOrder({ id: 'not-printable' })]);
    batchAction.mockResolvedValue({ status: 'success', result: {
      command: 'CREATE_PRINT', successCount: 1, skippedCount: 0, failedCount: 0, notAttemptedCount: 0,
      items: [{ orderId: order.id, status: 'success', code: 'OK' }],
    } });
    await page.getByRole('button', { name: '确认加入待打印', exact: true }).click();
    await expect.poll(() => batchAction.mock.calls.length).toBe(1);
    expect(batchAction.mock.calls[0][0]).toMatchObject({ command: 'CREATE_PRINT', items: [
      { orderId: order.id, expectedRevision: 4, expectedWorkOrderVersion: 2 },
    ] });
  });

  it('requires review, submits only eligible reviewed rows and preserves complete results after queue refresh', async () => {
    await page.viewport(1280, 800);
    let resolve!: (result: AdminOrderBatchActionResult) => void;
    batchAction.mockImplementation(() => new Promise((done) => { resolve = done; }));
    mount(mixedOrders());
    await review();
    expect(batchAction).not.toHaveBeenCalled();
    await expect.element(page.getByText(/已选 5 张，本次可处理 4 张/)).toBeVisible();
    await expect.element(page.getByText(/GD-260907-004：本次不处理/)).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(batchAction).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement?.textContent).toBe('批量结算（4）');
    await review();
    await page.getByRole('button', { name: '确认批量结算', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: '批量处理结果' }).getByText('正在逐单处理…', { exact: true })).toBeVisible();
    expect(batchAction).toHaveBeenCalledOnce();
    expect(batchAction.mock.calls[0][0]).toMatchObject({ command: 'SETTLE', items: mixedOrders().slice(0, 4).map((order) => ({ orderId: order.id, expectedRevision: 4, expectedWorkOrderVersion: 2 })) });
    expect(batchAction.mock.calls[0][0]).not.toHaveProperty('reason');
    resolve(partialResult());
    await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
    await assertConsistentSummary('成功 1 张，跳过 1 张，结果未知 1 张，未执行 1 张，未纳入处理 1 张');
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
        command: 'SETTLE', successCount: 4, skippedCount: 0, failedCount: 0, notAttemptedCount: 0,
        items: mixedOrders().slice(0, 4).map((order) => ({ orderId: order.id, status: 'success', code: 'OK' })),
      },
    });
    mount(mixedOrders());
    await review();
    await page.getByRole('button', { name: '确认批量结算', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: '请处理未完成的工单', exact: true })).toBeVisible();
    await assertConsistentSummary('成功 4 张，跳过 0 张，结果未知 0 张，未执行 0 张，未纳入处理 1 张');
    expect(document.querySelectorAll('[data-slot="batch-action-result-items"] > li')).toHaveLength(5);
    await page.getByRole('button', { name: '关闭结果', exact: true }).click();
    await expect.element(page.getByRole('region', { name: '工单批量操作' }).getByText(/成功 4 张，跳过 0 张.*未纳入处理 1 张/)).toBeVisible();
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

function printRequestOrder() {
  const order = batchOrder();
  return { ...order, status: OrderStatus.RELEASED,
    capabilities: { ...order.capabilities, release: false, createPrint: true } };
}

async function assertConsistentSummary(expected: string) {
  // The receipt can render before the action transition releases the toolbar's pending state.
  await expect.poll(() => ({
    toolbar: document.querySelector('[aria-label="工单批量操作"] p[role="status"]')?.textContent,
    receipt: document.querySelector('[data-slot="batch-action-result-summary"]')?.textContent,
    persistent: document.querySelector('[data-slot="admin-order-batch-receipt-link"] p')?.textContent,
  })).toEqual({ toolbar: expected, receipt: expected, persistent: expected });
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

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
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
      await page.getByRole('button', { name: '确认批量结算', exact: true }).click();
      await expect.element(page.getByRole('heading', { name: '部分结果需要核对', exact: true })).toBeVisible();
      await settleAnimation('[data-slot="dialog-content"]');
      assertGeometry('[data-slot="dialog-content"]', width);
      expect(await commands.checkShellAccessibility('[data-slot="dialog-content"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.activeElement?.textContent).toBe('查看批量结果');

      mount([printRequestOrder()]);
      await page.getByRole('button', { name: '更多操作', exact: true }).click();
      await expect.element(page.getByRole('menu')).toBeVisible();
      await settleAnimation('[data-slot="dropdown-menu-content"]');
      assertGeometry('[data-slot="dropdown-menu-content"]', width);
      expect(await commands.checkShellAccessibility('[data-slot="dropdown-menu-content"]')).toEqual([]);
      await page.getByRole('menuitem', { name: '加入待打印（1）', exact: true }).click();
      await expect.element(page.getByRole('alertdialog', { name: '确认加入待打印', exact: true })).toBeVisible();
      await settleAnimation('[data-slot="alert-dialog-content"]');
      assertGeometry('[data-slot="alert-dialog-content"]', width);
      expect(await commands.checkShellAccessibility('[data-slot="alert-dialog-content"]')).toEqual([]);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect.poll(() => document.activeElement?.textContent).toBe('更多操作');
    });
  }
}


it.each([[320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]])(
  'keeps the complete batch toolbar aligned at %i × %i through print states', async (width, height) => {
    await page.viewport(width, height);
    const originalFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/orders/batch-print/') ? printFetch(input, init) : originalFetch(input, init));
    printAction.mockResolvedValue({ status: 'queued', jobId: 'layout-job' });
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark);
      for (const state of ['idle', 'pending', 'ready', 'failed', 'unavailable'] as const) {
        printFetch.mockResolvedValue({ ok: true, json: async () => ({
          status: state, completed: state === 'ready' ? 1 : 0, total: 1,
          issues: state === 'failed' ? [{ position: 1, message: '工单内容已变化' }] : [],
        }) });
        mount([batchOrder()], `${dark}-${state}`);
        if (state !== 'idle') {
          await page.getByRole('button', { name: '打印所选（1）' }).click();
          if (state === 'ready') await expect.element(page.getByRole('button', { name: '打开 PDF' })).toBeVisible();
          else await expect.element(page.getByText(state === 'failed'
            ? '未生成打印文件，请检查以下工单或减少所选数量后重试。'
            : state === 'unavailable' ? '等待打印服务恢复，将自动更新进度；如长时间未恢复，请联系管理员。'
            : '正在准备打印文件，完成后可打开打印或下载。')).toBeVisible();
        }
        const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
        const primary = buttons.filter((button) => /安排生产师傅|打印所选|正在准备打印|等待打印服务恢复|导出所选/.test(button.textContent ?? ''));
        const boxes = primary.map((button) => button.getBoundingClientRect());
        if (width >= 768) {
          expect(Math.max(...boxes.map((box) => box.top)) - Math.min(...boxes.map((box) => box.top))).toBeLessThanOrEqual(1);
          const clear = buttons.find((button) => button.textContent?.includes('取消选择'))!.getBoundingClientRect();
          expect(Math.abs(clear.top - boxes[0].top)).toBeLessThanOrEqual(1);
        }
        for (const element of host.querySelectorAll('button, a')) {
          const box = element.getBoundingClientRect();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        if (state === 'ready') {
          // 打开 / 下载 PDF 是按钮（不用可被中键另开、绕过记录的链接），排在主操作行下方。
          const open = buttons.find((button) => button.textContent === '打开 PDF')!.getBoundingClientRect();
          expect(open.top).toBeGreaterThanOrEqual(Math.max(...boxes.map((box) => box.bottom)));
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(await commands.checkShellAccessibility('[aria-label="工单批量操作"]')).toEqual([]);
      }
    }
  }, 30000,
);
