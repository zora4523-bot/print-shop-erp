import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OrderStatus } from '@/generated/prisma/enums';
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
// BatchPrintControls 引入的 server action；不 mock 会把 next-auth 拖进浏览器，
// 其预打包 chunk 再去向已被 mock 的 next/navigation 要内部导出而报错。
vi.mock('@/actions/order-batch-print', () => ({ requestBatchPrintAction: vi.fn() }));
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
  useLinkStatus: () => ({ pending: false }),
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
import { AdminOrderWorkspace } from '../AdminOrderWorkspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-4';
  host.dataset.testid = 'order-list-fixture';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
  history.replaceState(null, '', location.pathname);
});
function renderWorkspace(orders: AdminOrderWorkspaceRow[] = [{
  ...row(),
  customName: '春节企业定制红包 · 多款设计',
}]) {
  flushSync(() => root.render(<AdminOrderWorkspace
    query={parseAdminOrderWorkspaceQuery({}).query}
    issues={[]}
    options={{ submitters: [{ id: 'sales-1', label: '业务员甲' }], workers: [], crafts: [{ id: 'craft-1', label: '局部烫金' }] }}
    billingStats={{ receivableAmount: '0', receivableBillCount: 0, unbilledOrderCount: 0, draftBillCount: 0 }}
    exportControls={<Button type="button">导出工单</Button>}
    selectedExportRequestKey="test-export"
    data={{ rows: orders, total: orders.length, page: 1, pageSize: 20, pageCount: 1,
      summary: { orderCount: 1, totalQuantity: 2000, effectiveFee: '1234.50', manualPricingCount: 0, incompleteFeeExcludedCount: 0, legacyFeeExcludedCount: 0 },
      counts: { queues: { todo: 1, print: 0, production: 0, shipped: 0, done: 0, all: 1 }, signals: { 'pending-quantity': 0, 'pending-confirmation': 1, 'pending-pricing': 0, 'pending-change': 0, 'pending-release': 0, 'on-hold': 0, overdue: 0, 'due-today': 0 } },
    }}
  />));
}
describe('admin order list reference layout', () => {
  for (const [width, height] of [[375,667],[393,852],[768,1024],[1024,768],[1280,800],[1920,1080]]) {
    for (const theme of ['light', 'dark']) {
      it(`${width}×${height} ${theme}: overflow, touch targets and accessibility`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        renderWorkspace();
        await expect.element(page.getByRole('link', { name: '查看处理', exact: true }).first()).toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        for (const element of host.querySelectorAll<HTMLElement>('a, button, select, input:not([aria-hidden="true"]):not([type="hidden"]), [role="checkbox"]')) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          expect(rect.height).toBeGreaterThanOrEqual(minimumTargetSize(element));
        }
        if (width <= 768) expectNarrowRowAlignment();
        expect(await commands.checkShellAccessibility('[data-testid="order-list-fixture"]')).toEqual([]);
      });
    }
  }
  for (const theme of ['light', 'dark']) {
    it(`six reference rows ${theme}: desktop density and progress only when relevant`, async () => {
      await page.viewport(1190, 1100);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderWorkspace(referenceRows());

      await expect.element(page.getByRole('link', { name: '查看处理', exact: true }).first()).toBeVisible();
      expect(matchMedia('(min-width: 921px) and (hover: hover) and (pointer: fine)').matches).toBe(true);
      const rows = [...host.querySelectorAll<HTMLElement>('li[data-order-id]')];
      expect(rows).toHaveLength(6);
      for (const [index, orderRow] of rows.entries()) {
        const rect = orderRow.getBoundingClientRect();
        expect(orderRow.dataset.orderDensity).toBe('compact');
        expect(rect.height, `${orderRow.dataset.orderId} height`).toBeGreaterThanOrEqual(84);
        expect(rect.height, `${orderRow.dataset.orderId} height`).toBeLessThanOrEqual(92);
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(1190);
        if (index > 0) {
          expect(rect.top - rows[index - 1].getBoundingClientRect().bottom).toBe(8);
        }
        const progress = orderRow.querySelector('[data-slot="admin-order-row-progress"]');
        if (orderRow.dataset.orderId === 'reference-foiling') {
          expect(progress).not.toBeNull();
          expect(progress?.textContent).toContain('烫 1,000');
          expect(progress?.textContent).toContain('包 0');
          expect(progress?.querySelector('[role="progressbar"]')).not.toBeNull();
        } else {
          expect(progress).toBeNull();
          expect(orderRow.querySelector('[role="progressbar"]')).toBeNull();
        }
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1190);
      expect(await commands.checkShellAccessibility('[data-testid="order-list-fixture"]')).toEqual([]);
    });
  }
  it('shows zero production progress and retains recorded progress when an order is paused', async () => {
    await page.viewport(1190, 900);
    const fixtures = referenceRows();
    const producing = fixtures[4];
    const paused = fixtures[5];
    renderWorkspace([
      { ...producing, progress: { ...producing.progress, foilingProgress: '0', firstClaimedAt: null } },
      { ...paused, progress: { ...paused.progress, foilingProgress: '500', firstClaimedAt: '2026-09-02T01:30:00.000Z' } },
    ]);
    const productionProgress = host.querySelector('[data-order-id="reference-foiling"] [data-slot="admin-order-row-progress"]');
    const pausedProgress = host.querySelector('[data-order-id="reference-hold"] [data-slot="admin-order-row-progress"]');
    expect(productionProgress?.textContent).toContain('烫 0');
    expect(productionProgress?.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(pausedProgress?.textContent).toContain('烫 500');
    expect(pausedProgress?.querySelector('[role="progressbar"]')).not.toBeNull();
  });
  it('920px keeps full touch targets in compact rows', async () => {
    await page.viewport(920, 900);
    renderWorkspace(referenceRows());
    await expect.element(page.getByRole('link', { name: '查看处理', exact: true }).first()).toBeVisible();
    for (const element of host.querySelectorAll<HTMLElement>('li[data-order-id] a, li[data-order-id] button, li[data-order-id] [role="checkbox"]')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      expect(rect.width, element.textContent ?? element.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
      expect(rect.height, element.textContent ?? element.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(44);
    }
    expectNarrowRowAlignment();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(920);
  });
  it('selection stays separate from navigation and row action links to full order details', async () => {
    await page.viewport(1280, 800);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: '暂时无法加载' }) }));
    renderWorkspace();
    await page.getByRole('checkbox', { name: '选择工单 春节企业定制红包 · 多款设计（GD-260902-001）', exact: true }).click();
    expect(location.hash).toBe('');
    await expect.element(page.getByRole('link', { name: '查看处理', exact: true })).toHaveAttribute('href', '/orders/order-1');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
});
function expectNarrowRowAlignment() {
  for (const orderRow of host.querySelectorAll<HTMLElement>('li[data-order-id]')) {
    const cells = [...orderRow.children] as HTMLElement[];
    const titleLeft = cells[2].getBoundingClientRect().left;
    const fieldNames = ['状态', '交期', '数量', '金额', '操作'];
    expect(cells).toHaveLength(8);
    for (const [index, field] of cells.slice(3).entries()) {
      const contentLeft = field.getBoundingClientRect().left + parseFloat(getComputedStyle(field).paddingLeft);
      expect(contentLeft, `${orderRow.dataset.orderId} ${fieldNames[index]}与标题左对齐`).toBeCloseTo(titleLeft, 1);
    }
  }
}

function minimumTargetSize(element: HTMLElement): number {
  return element.closest('[data-order-density="compact"]') &&
    matchMedia('(min-width: 921px) and (hover: hover) and (pointer: fine)').matches
    ? 24
    : 44;
}

function referenceRows(): AdminOrderWorkspaceRow[] {
  const base = row();
  const pending: AdminOrderWorkspaceRow = {
    ...base,
    id: 'reference-ready',
    orderNo: 'GD-20260828-3121',
    customName: '新春平安封 四款',
    submitter: { id: 'sales-1', name: '代理·邱南京' },
    status: OrderStatus.PENDING_FACTORY,
    statusSummary: '预检通过，可确认',
    itemCount: 4,
    totalQuantity: 4000,
    fee: { amount: '1104.30', source: 'QUOTED', estimated: false },
    feeStages: { quoted: '1104.30', confirmed: null, settled: null, active: 'QUOTED' },
    confirmationPreflight: { ok: true, issues: [] },
    capabilities: { ...base.capabilities, confirm: true, reject: true, release: false },
    progress: { ...base.progress, orderTotal: '4000', foilingProgress: '0', packingProgress: '0', firstClaimedAt: null },
  };
  const change = {
    id: 'request-1', type: 'MODIFY' as const, reason: '客户改单', createdAt: '2026-09-02T01:00:00.000Z',
  };
  return [
    pending,
    {
      ...pending,
      id: 'reference-pricing', orderNo: 'GD-20260828-3117', customName: '龙年大吉 专版',
      statusSummary: '待核价 · 专版三色',
      fee: { amount: null, source: 'PENDING', estimated: false },
      feeStages: { quoted: null, confirmed: null, settled: null, active: 'PENDING' },
      confirmationPreflight: { ok: false, issues: ['系统无法定价'] },
      capabilities: { ...pending.capabilities, confirm: false },
    },
    {
      ...pending,
      id: 'reference-review', orderNo: 'GD-20260827-3102', customName: '囍字婚庆 两款',
      statusSummary: '第 2 款缺 CDR；第 1 款需复核',
      confirmationPreflight: { ok: false, issues: ['第 2 款缺 CDR'] },
      capabilities: { ...pending.capabilities, confirm: false },
    },
    {
      ...pending,
      id: 'reference-change', orderNo: 'GD-20260826-3080', customName: '乔迁之喜 两款',
      status: OrderStatus.CONFIRMED,
      statusSummary: '修改数量：3,000 → 2,000',
      pendingChangeRequest: change,
      capabilities: { ...pending.capabilities, confirm: false, reviewChange: true },
    },
    {
      ...pending,
      id: 'reference-foiling', orderNo: 'GD-20260825-3061', customName: '公司年会封',
      status: OrderStatus.FOILING,
      statusSummary: '取消申请 · 客户临时取消',
      itemCount: 1, totalQuantity: 1000,
      dueAlert: { kind: 'overdue', days: 3 },
      pendingChangeRequest: { ...change, id: 'request-2', type: 'CANCEL', reason: '客户临时取消' },
      capabilities: { ...pending.capabilities, confirm: false, reviewChange: true },
      progress: { ...pending.progress, orderTotal: '1000', foilingProgress: '1000', firstClaimedAt: '2026-09-02T01:30:00.000Z' },
    },
    {
      ...pending,
      id: 'reference-hold', orderNo: 'GD-20260823-3022', customName: '囍上眉梢',
      status: OrderStatus.ON_HOLD,
      statusSummary: '设计图有误 · 第 1 款重传后待复核',
      capabilities: { ...pending.capabilities, confirm: false, hold: false, resume: true },
    },
  ];
}

function row(): AdminOrderWorkspaceRow {
  return {
    id: 'order-1',
    orderNo: 'GD-260902-001',
    revision: 4,
    workOrderVersion: 2,
    customName: '端午定制',
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
