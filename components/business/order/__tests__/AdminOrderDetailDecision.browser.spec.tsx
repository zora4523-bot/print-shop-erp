import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { batchOrder } from './admin-order-batch-fixture';
import '@/app/globals.css';

const { refresh, sharedPanel } = vi.hoisted(() => ({ refresh: vi.fn(), sharedPanel: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
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

const RECALL_REMINDER = '改单后需打印新版 v3，打印后请收回旧版纸单。';

// 业主 2026-10-02：点「打印」即记已打印。详情页不再有「确认已打印」与收回纸单确认层，
// 只把打印入口交给共用的操作面板，改单补打时提醒收回旧纸单。
describe('admin detail print reminder', () => {
  it('hands the pending print to the shared panel and only reminds about recalling old paper', async () => {
    await page.viewport(1280, 900);
    mount();
    expect(sharedPanel.mock.lastCall?.[0].order.capabilities.markPrinted).toBe(true);
    expect(sharedPanel.mock.lastCall?.[0].order.pendingPrintJobId).toBe('current-print-v3');
    await expect.element(page.getByText(RECALL_REMINDER, { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: '确认已打印', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows no recall reminder for a first print or once nothing is waiting to print', async () => {
    await page.viewport(1280, 900);
    mount(printableOrder({ workOrderVersion: 1, pendingPrintJobId: 'first-print-v1' }), false);
    await expect.element(page.getByTestId('shared-decision-panel')).toBeVisible();
    expect(host.textContent).not.toContain('收回旧版纸单');
    const original = printableOrder();
    mount({ ...original, printPending: false, pendingPrintJobId: null, capabilities: { ...original.capabilities, markPrinted: false } });
    await expect.element(page.getByText('生产中 · 暂无待办', { exact: true })).toBeVisible();
    expect(host.textContent).not.toContain('收回旧版纸单');
  });

  it('refreshes when the admin returns from the print tab, and only while a print is pending', async () => {
    await page.viewport(1280, 900);
    mount();
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledOnce();
    const original = printableOrder();
    mount({ ...original, capabilities: { ...original.capabilities, markPrinted: false } });
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledOnce();
  });

  for (const theme of ['light', 'dark']) {
    it(`${theme}: the mobile reminder fits and passes axe`, async () => {
      await page.viewport(375, 667);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      mount();
      await expect.element(page.getByText(RECALL_REMINDER, { exact: true })).toBeVisible();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      expect(await commands.checkShellAccessibility('[data-testid="order-detail-decision-fixture"]')).toEqual([]);
    });
  }
});
