import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/order-workspace', () => ({
  setOrderStarredAction: vi.fn(),
}));
vi.mock('@/actions/order-export', () => ({
  requestOrderExportAction: vi.fn(),
}));
vi.mock('@/actions/order-fulfillment-pricing', () => ({ previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn() }));
vi.mock('@/actions/admin-order-workflow', () => ({
  runAdminOrderBatchAction: vi.fn(),
  confirmFactoryOrderAction: vi.fn(),
  holdFactoryOrderAction: vi.fn(),
  rejectFactoryOrderAction: vi.fn(),
  releaseFactoryOrderAction: vi.fn(),
  resumeFactoryOrderAction: vi.fn(),
  settleFactoryOrderAction: vi.fn(),
}));
vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: vi.fn(), finalizeOrderPricingAction: vi.fn(), shipOrderAction: vi.fn(),
  previewOrderChangeRequestPricingAction: vi.fn(),
  previewOrderCancellationSettlementAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));


vi.mock('@/generated/prisma/client', async () => ({
  ...await import('@/generated/prisma/enums'),
  Prisma: { Decimal: (await import('decimal.js')).default },
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
import { AdminOrderWorkspace } from '../AdminOrderWorkspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';
import { batchOrder } from './admin-order-batch-fixture';
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport flex min-w-0 bg-background text-foreground';
  host.dataset.testid = 'order-sizing-fixture';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.clearAllMocks();
});

function mount() {
  const orders: AdminOrderWorkspaceRow[] = Array.from({ length: 20 }, (_, index) => batchOrder({
    remark: index === 0 ? '先核对样稿\n再安排生产。'.repeat(40) : null,
    id: `order-${index}`, orderNo: `GD-260907-${String(index).padStart(3, '0')}`,
  }));
  flushSync(() => root.render(
    <>
      <aside aria-label="侧栏" className="hidden w-64 shrink-0 md:block">工作台</aside>
      <main className="min-w-0 flex-1">
        <div className="admin-safe-inline admin-safe-bottom py-4 sm:py-6">
          <AdminOrderWorkspace
            query={parseAdminOrderWorkspaceQuery({}).query}
            issues={[]}
            options={{ submitters: [], workers: [], crafts: [] }}
            billingStats={{ receivableAmount: '0', receivableBillCount: 0, unbilledOrderCount: 0, draftBillCount: 0 }}
            exportControls={<Button type="button">导出工单</Button>}
            selectedExportRequestKey="sizing-test-export"
            data={{ rows: orders, total: 20, page: 1, pageSize: 20, pageCount: 1,
              summary: { orderCount: 20, totalQuantity: 20000, effectiveFee: '24690.00', manualPricingCount: 0, incompleteFeeExcludedCount: 0, legacyFeeExcludedCount: 0 },
              counts: { queues: { todo: 20, print: 0, production: 0, shipped: 0, done: 0, all: 20 }, signals: { 'pending-confirmation': 0, 'pending-pricing': 0, 'pending-change': 0, 'pending-release': 20, 'on-hold': 0, overdue: 0, 'due-today': 0 } },
            }}
          />
        </div>
      </main>
    </>,
  ));
}

function element(selector: string): HTMLElement {
  const result = host.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing layout element: ${selector}`);
  return result;
}

function assertAligned(width: number) {
  const content = element('[data-slot="admin-order-workspace"]').getBoundingClientRect();
  const main = element('main').getBoundingClientRect();
  const inset = width >= 640 ? 24 : 12;
  expect(content.left).toBeCloseTo(main.left + inset, 1);
  expect(content.right).toBeCloseTo(main.right - inset, 1);
  const toolbar = element('[aria-label="工单批量操作"]');
  const bar = toolbar.getBoundingClientRect();
  const list = element('[data-slot="admin-order-workspace-list"]').getBoundingClientRect();
  expect(bar.left).toBeCloseTo(list.left, 1);
  expect(bar.right).toBeCloseTo(list.right, 1);
  expect(bar.bottom).toBeLessThanOrEqual(list.top);
  expect(getComputedStyle(toolbar).position).toBe('static');
  expect(host.querySelector('[data-slot="order-list-batch-placeholder"]')).toBeNull();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  for (const control of toolbar.querySelectorAll<HTMLElement>('button, a')) {
    const box = control.getBoundingClientRect();
    expect(box.width, control.textContent ?? '').toBeGreaterThanOrEqual(44);
    expect(box.height, control.textContent ?? '').toBeGreaterThanOrEqual(44);
    expect(box.left).toBeGreaterThanOrEqual(bar.left);
    expect(box.right).toBeLessThanOrEqual(bar.right);
  }
}

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: fills the main area and keeps selection actions above the list`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      mount();
      expect(host.querySelector('[aria-label="工单批量操作"]')).toBeNull();
      await page.getByRole('checkbox', { name: '选择本页 20 项工单', exact: true }).click();
      await expect.element(page.getByRole('region', { name: '工单批量操作' })).toBeVisible();
      assertAligned(width);
      await page.getByText('工单备注 · 展开/收起', { exact: true }).click();
      expect(element('li[data-order-id="order-0"] details').hasAttribute('open')).toBe(true);
      expect(element('li[data-order-id="order-0"] details p').textContent).toContain('先核对样稿\n再安排生产。');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(element('[aria-label="工单批量操作"]').querySelectorAll('[data-slot="disabled-reason-copy"]')).toHaveLength(1);
      expect(await commands.checkShellAccessibility('[data-testid="order-sizing-fixture"]')).toEqual([]);
      element('li[data-order-id="order-19"]').scrollIntoView();
      const lastRow = element('li[data-order-id="order-19"]').getBoundingClientRect();
      expect(element('[aria-label="工单批量操作"]').getBoundingClientRect().bottom).toBeLessThan(lastRow.top);
      await page.getByRole('button', { name: '取消选择', exact: true }).click();
      await expect.element(page.getByRole('region', { name: '工单批量操作' })).not.toBeInTheDocument();
      await expect.element(page.getByRole('checkbox', { name: '选择本页 20 项工单', exact: true })).not.toBeChecked();
    });
  }
}

it('keeps the toolbar aligned when the desktop sidebar collapses', async () => {
  await page.viewport(1896, 1277);
  mount();
  await page.getByRole('checkbox', { name: '选择本页 20 项工单', exact: true }).click();
  assertAligned(1896);
  element('aside').style.width = '48px';
  assertAligned(1896);
  element('aside').style.width = '256px';
  assertAligned(1896);
});
