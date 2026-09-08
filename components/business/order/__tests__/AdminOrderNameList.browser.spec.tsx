import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import '@/app/globals.css';
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
import { AdminOrderWorkspaceList } from '../AdminOrderWorkspaceList';
import { setOrderStarredAction } from '@/actions/order-workspace';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-4';
  host.dataset.testid = 'order-name-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  history.replaceState(null, '', location.pathname);
  vi.unstubAllGlobals();
});
function renderList(orders = [row()]) {
  flushSync(() => root.render(<AdminOrderWorkspaceList orders={orders} customerFilterHrefs={{ 'order-1': '/orders?customerRef=customer-a' }} selectedExportRequestKey="name-list-export" />));
}
describe('admin name-first order list', () => {
  for (const [width, height] of [[375,667],[393,852],[768,1024],[1024,768],[1280,800],[1920,1080]]) {
    for (const theme of ['light', 'dark']) {
      it(`${width}x${height} ${theme}: title, selection, overflow, targets and axe`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        renderList([row(), { ...row(), id: 'order-2', orderNo: 'INTERNAL-SECOND', customName: '春节客户定制礼品红包'.repeat(8) }]);
        await expect.element(page.getByRole('link', { name: '端午定制', exact: true })).toBeVisible();
        expect(host.querySelector('h3 a')?.getAttribute('href')).toBe('/orders/order-1');
        expect(host.textContent).not.toContain('GD-260902-001');
        expect(host.textContent).not.toContain('INTERNAL-SECOND');
        expect(host.textContent).not.toContain('业务员甲');
        await page.getByRole('checkbox', { name: '选择本页 2 项工单', exact: true }).click();
        await expect.element(page.getByRole('region', { name: '工单批量操作' })).toBeVisible();
        expect(host.textContent).not.toContain('复制工单号');
        expect(host.querySelector('[data-slot="order-list-batch-feedback"]')).toBeNull();
        expect(host.textContent).toContain('导出所选');
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const element of host.querySelectorAll<HTMLElement>('a,button,[role="checkbox"]')) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          const minimum = element.closest('[data-order-density="compact"]') && matchMedia('(min-width: 921px) and (hover: hover) and (pointer: fine)').matches ? 24 : 44;
          expect(rect.width, element.textContent ?? '').toBeGreaterThanOrEqual(minimum);
          expect(rect.height, element.textContent ?? '').toBeGreaterThanOrEqual(minimum);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
        }
        expect(await commands.checkShellAccessibility('[data-testid="order-name-fixture"]')).toEqual([]);
        await page.getByRole('button', { name: '取消选择', exact: true }).click();
        await expect.element(page.getByRole('region', { name: '工单批量操作' })).not.toBeInTheDocument();
      });
    }
  }
  it('retains stable record ids for duplicate names, stars, selection and processing drawer', async () => {
    await page.viewport(1280, 800);
    vi.mocked(setOrderStarredAction).mockResolvedValue({ status: 'success', orderId: 'order-2', starred: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: '暂时无法加载' }) }));
    renderList([row(), { ...row(), id: 'order-2', orderNo: 'OTHER-ID' }]);
    expect([...host.querySelectorAll('h3 a')].map(link => link.getAttribute('href'))).toEqual(['/orders/order-1', '/orders/order-2']);
    const second = host.querySelector<HTMLElement>('[data-order-id="order-2"]')!;
    second.querySelector<HTMLElement>('[role="checkbox"]')!.click();
    expect(location.hash).toBe('');
    await expect.element(page.getByRole('region', { name: '工单批量操作' })).toBeVisible();
    second.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click();
    await expect.poll(() => vi.mocked(setOrderStarredAction).mock.calls).toEqual([[{ orderId: 'order-2', starred: false }]]);
    expect(host.textContent).not.toContain('OTHER-ID');
    await page.getByRole('button', { name: '查看处理', exact: true }).nth(1).click();
    await expect.poll(() => location.hash).toContain('wo=OTHER-ID');
    await expect.element(page.getByRole('dialog')).toBeVisible();
  });
});
function row(): AdminOrderWorkspaceRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260902-001',
    revision: 4,
    workOrderVersion: 2,
    customName: '端午定制',
    customer: { id: 'party-1', name: '客户甲', filterValue: '客户甲' },
    submitter: { id: 'sales-1', name: '业务员甲' },
    status: OrderStatus.CONFIRMED,
    statusSummary: null,
    isUrgent: false,
    isStarred: true,
    createdAt: '2026-09-02T01:00:00.000Z',
    submittedAt: '2026-09-02T01:00:00.000Z',
    promisedDate: '2026-09-05',
    dueAlert: { kind: 'due-soon', days: 3 },
    itemCount: 2,
    totalQuantity: 2000,
    craftSummary: '局部烫金',
    thumbnail: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        fig: 1,
        name: '图一',
        quantity: 2000,
        specification: '中号封',
        paper: '珠光纸 160g',
        crafts: ['局部烫金'],
        thumbnail: null,
      },
    ],
    fee: { amount: '1234.50', source: 'CONFIRMED', estimated: false },
    feeStages: {
      quoted: '1200.00',
      confirmed: '1234.50',
      settled: null,
      active: 'CONFIRMED',
    },
    priceComparison: null,
    priceComparisonError: null,
    confirmationPreflight: { ok: false, issues: ['当前不是待工厂确认状态'] },
    capabilities: {
      confirm: false,
      reject: false,
      hold: true,
      resume: false,
      release: true,
      ship: false,
      settle: false,
      createPrint: false,
      markPrinted: false,
      reviewChange: false,
    },
    billing: null,
    pendingChangeRequest: null,
    printPending: false,
    pendingPrintJobId: null,
    trackingNo: null,
    progress: {
      orderTotal: '2000',
      foilingProgress: '1200',
      packingProgress: '800',
      foilingOverLimit: false,
      packingOverLimit: false,
      packingAhead: false,
      stagnant: false,
      stagnationDays: 2,
      firstClaimedAt: '2026-09-02T01:30:00.000Z',
    },
    logs: [],
  };
}
