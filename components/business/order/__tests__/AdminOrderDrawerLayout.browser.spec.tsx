import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import '@/app/globals.css';

const { previewAction } = vi.hoisted(() => ({ previewAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));
vi.mock('@/actions/order', () => ({
  previewOrderChangeRequestPricingAction: previewAction,
  previewOrderCancellationSettlementAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));
vi.mock('@/actions/admin-order-workflow', () => ({
  confirmFactoryOrderAction: vi.fn(),
  holdFactoryOrderAction: vi.fn(),
  rejectFactoryOrderAction: vi.fn(),
  releaseFactoryOrderAction: vi.fn(),
  resumeFactoryOrderAction: vi.fn(),
  runAdminOrderBatchAction: vi.fn(),
  settleFactoryOrderAction: vi.fn(),
}));
vi.mock('@/generated/prisma/client', async () => ({
  ...await import('@/generated/prisma/enums'),
  Prisma: { Decimal: (await import('decimal.js')).default },
}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { AdminOrderDrawer } from '../AdminOrderDrawer';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'admin-viewport p-4';
  document.body.append(host);
  root = createRoot(host);
  previewAction.mockResolvedValue({ status: 'success', preview: pricingPreview() });
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.clearAllMocks();
});

async function openDrawer() {
  flushSync(() => root.render(
    <Sheet>
      <SheetTrigger render={<Button />}>打开工单</SheetTrigger>
      <AdminOrderDrawer order={orderFixture()} />
    </Sheet>,
  ));
  await page.getByRole('button', { name: '打开工单', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.element(page.getByRole('button', { name: '刷新最新计价预览', exact: true })).toBeVisible();
  await expect.poll(() => document.querySelector('[data-order-drawer]')?.hasAttribute('data-starting-style')).toBe(false);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await Promise.all(requiredElement('[data-order-drawer]').getAnimations().map((animation) => animation.finished));
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}

function assertControlsAndOverflow(drawer: HTMLElement, viewportWidth: number) {
  const drawerRect = drawer.getBoundingClientRect();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth);
  expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
  const body = requiredElement('[data-slot="admin-order-drawer-body"]');
  expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  for (const element of drawer.querySelectorAll<HTMLElement>('a[href], button, summary, input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea, [role="checkbox"]')) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !element.checkVisibility()) continue;
    const label = element.getAttribute('aria-label') ?? element.textContent ?? element.tagName;
    expect(rect.left, label).toBeGreaterThanOrEqual(drawerRect.left);
    expect(rect.right, label).toBeLessThanOrEqual(drawerRect.right);
    expect(rect.width, label).toBeGreaterThanOrEqual(44);
    expect(rect.height, label).toBeGreaterThanOrEqual(44);
  }
}

const viewports = [
  [375, 667], [393, 852], [768, 1024],
  [1024, 768], [1280, 800], [1920, 1080],
] as const;

describe('admin order drawer reference layout', () => {
  for (const [width, height] of viewports) {
    for (const theme of ['light', 'dark']) {
      it(`${width}×${height} ${theme}: width, section spacing, controls and accessibility`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        await openDrawer();

        const drawer = requiredElement('[data-order-drawer]');
        expect(drawer.dataset.slot).toBe('sheet-content');
        const header = requiredElement('[data-order-drawer] [data-slot="sheet-header"]');
        const title = requiredElement('[data-order-drawer] [data-slot="sheet-title"]');
        const body = requiredElement('[data-slot="admin-order-drawer-body"]');
        const actions = requiredElement('[data-slot="admin-order-drawer-actions"]');
        const decision = requiredElement('[data-slot="admin-order-decision-panel"]');
        const rect = drawer.getBoundingClientRect();

        expect(rect.width).toBeCloseTo(Math.min(480, width), 1);
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeCloseTo(width, 1);
        expect(rect.height).toBeLessThanOrEqual(height);
        expect(getComputedStyle(title).fontSize).toBe('16px');
        expect(getComputedStyle(title).fontWeight).toBe('800');
        for (const element of [header, body]) {
          expect(getComputedStyle(element).paddingLeft).toBe('20px');
          expect(getComputedStyle(element).paddingRight).toBe('20px');
        }
        expect(body.contains(actions)).toBe(true);
        expect(actions.closest('[data-slot="admin-order-drawer-section"]')).toBe(body.lastElementChild);
        expect(decision.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(['fixed', 'sticky']).not.toContain(getComputedStyle(actions).position);
        expect(drawer.querySelector('[data-slot="sheet-footer"]')).toBeNull();
        expect(body.querySelectorAll('[data-slot="admin-order-drawer-section"], [data-slot="admin-order-decision-panel"]').length).toBeGreaterThanOrEqual(2);
        assertControlsAndOverflow(drawer, width);
        const amount = requiredElement('input[aria-label="第 1 票运费金额"]');
        const basis = requiredElement('textarea[aria-label="第 1 票运费依据"]');
        expect(amount.checkVisibility()).toBe(true);
        expect(basis.checkVisibility()).toBe(true);
        const amountRect = amount.getBoundingClientRect();
        const basisRect = basis.getBoundingClientRect();
        expect(basisRect.top).toBeGreaterThan(amountRect.bottom);
        expect(basisRect.left).toBeCloseTo(amountRect.left, 1);
        expect(basisRect.width).toBeCloseTo(amountRect.width, 1);
        expect(await commands.checkShellAccessibility('[data-order-drawer]')).toEqual([]);
      });
    }
  }

  it('auxiliary actions scroll with the body and stay after the decision content', async () => {
    await page.viewport(1280, 800);
    previewAction.mockResolvedValue({ status: 'success', preview: pricingPreview(12) });
    await openDrawer();
    const body = requiredElement('[data-slot="admin-order-drawer-body"]');
    const actions = requiredElement('[data-slot="admin-order-drawer-actions"]');
    const header = requiredElement('[data-order-drawer] [data-slot="sheet-header"]');
    body.scrollTop = 0;
    const beforeTop = actions.getBoundingClientRect().top;
    const headerTop = header.getBoundingClientRect().top;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    body.scrollTop = body.scrollHeight;
    await expect.poll(() => body.scrollTop).toBeGreaterThan(0);
    expect(actions.getBoundingClientRect().top).toBeLessThan(beforeTop);
    expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(body.getBoundingClientRect().bottom);
    expect(header.getBoundingClientRect().top).toBe(headerTop);
  });

  it('enabled rejection stays red on the left and approval stays dark on the right', async () => {
    await page.viewport(1280, 800);
    previewAction.mockResolvedValue({
      status: 'success',
      preview: { ...pricingPreview(), complete: true, newTotal: '1200.00', delta: '200.00', pendingCharges: [] },
    });
    await openDrawer();
    await page.getByText('填写拒绝原因 / 审核备注', { exact: true }).click();
    await page.getByLabelText('审核备注 / 拒绝原因', { exact: false }).fill('请核对客户确认的规格。');
    const approve = page.getByRole('button', { name: '批准变更', exact: true });
    const reject = page.getByRole('button', { name: '拒绝申请', exact: true });
    await expect.element(approve).toBeEnabled();
    await expect.element(reject).toBeEnabled();
    expect(reject.element().getBoundingClientRect().right).toBeLessThan(approve.element().getBoundingClientRect().left);
    expect(getComputedStyle(reject.element()).backgroundColor).toBe('rgb(168, 18, 26)');
    expect(getComputedStyle(approve.element()).backgroundColor).toBe('rgb(23, 24, 28)');
    expect(await commands.checkShellAccessibility('[data-order-drawer]')).toEqual([]);
  });

  it.each(['close', 'escape', 'backdrop'] as const)('%s closes the drawer and restores trigger focus', async (method) => {
    await page.viewport(1280, 800);
    await openDrawer();
    const drawer = requiredElement('[data-order-drawer]');
    await expect.poll(() => drawer.contains(document.activeElement)).toBe(true);
    await userEvent.tab();
    expect(drawer.contains(document.activeElement)).toBe(true);
    if (method === 'close') {
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    } else if (method === 'escape') {
      await userEvent.keyboard('{Escape}');
    } else {
      await userEvent.click(requiredElement('[data-slot="sheet-overlay"]'), { position: { x: 10, y: 10 } });
    }
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '打开工单', exact: true })).toHaveFocus();
  });
});

function pricingPreview(itemCount = 2): OrderChangePricingPreview {
  return {
    requestId: 'drawer-request-1',
    orderId: 'drawer-order-1',
    baseRevision: 2,
    priceRevision: 5,
    quoteToken: `order-change-approval-v1:${'a'.repeat(64)}`,
    quotedAt: '2026-09-07T08:00:00.000Z',
    complete: false,
    requiresReviewRemark: false,
    totalExcludesPendingPlateFee: false,
    oldTotal: '1000.00',
    newTotal: null,
    delta: null,
    items: Array.from({ length: itemCount }, (_, index) => ({
      changeIndex: index,
      operation: 'UPDATE',
      sourceItemId: `drawer-item-${index + 1}`,
      previousName: `新春平安封 款式${index + 1}`,
      name: `新春平安封 款式${index + 1}`,
      previousQuantity: 1000,
      quantity: 1200,
      previousSpecification: '中号封',
      specification: '大号封',
      previousFrontFoilColors: ['哑金'],
      frontFoilColors: ['亮金'],
      previousBackFoilColors: [],
      backFoilColors: [],
      priceImpact: 'QUOTED',
      oldSubtotal: '500.00',
      newSubtotal: '600.00',
      suggestedUnitPrice: '0.5000',
      suggestedFixedFee: '0.00',
      errors: [],
    })),
    pendingCharges: [{
      businessKey: 'shipping:shipment-1',
      categoryCode: 'SHIPPING_FEE',
      shipmentId: 'shipment-1',
      shipmentSequence: 1,
      destinationProvince: '广东省',
      projectedQuantity: 2400,
      description: '配送运费待核对',
      errors: ['未匹配到唯一物流规则'],
      amount: null,
      reason: null,
    }],
  };
}

function orderFixture(): AdminOrderWorkspaceRow {
  return {
    id: 'drawer-order-1',
    orderNo: 'GD-260907-001',
    revision: 2,
    workOrderVersion: 1,
    customName: '新春平安封 两款',
    customer: { id: 'customer-1', name: '福明盛业', filterValue: '福明盛业' },
    submitter: { id: 'sales-1', name: '业务员甲' },
    status: OrderStatus.CONFIRMED,
    statusSummary: '申请修改数量和规格',
    isUrgent: false,
    isStarred: false,
    createdAt: '2026-09-07T01:00:00.000Z',
    submittedAt: '2026-09-07T01:00:00.000Z',
    promisedDate: '2026-09-10',
    dueAlert: { kind: 'due-soon', days: 3 },
    itemCount: 2,
    totalQuantity: 2000,
    craftSummary: '局部烫金',
    thumbnail: null,
    items: [1, 2].map((sequence) => ({
      id: `drawer-item-${sequence}`,
      sequence,
      fig: sequence,
      name: `新春平安封 款式${sequence}`,
      quantity: 1000,
      specification: '中号封',
      paper: '珠光纸 160g',
      crafts: ['局部烫金'],
      thumbnail: null,
    })),
    fee: { amount: '1000.00', source: 'CONFIRMED', estimated: false },
    feeStages: { quoted: '1000.00', confirmed: '1000.00', settled: null, active: 'CONFIRMED' },
    priceComparison: null,
    priceComparisonError: null,
    confirmationPreflight: { ok: false, issues: ['当前有待处理修改申请'] },
    capabilities: {
      confirm: false, reject: false, hold: false, resume: false, release: false,
      ship: false, settle: false, createPrint: false, markPrinted: false, reviewChange: true,
    },
    billing: null,
    pendingChangeRequest: { id: 'drawer-request-1', type: 'MODIFY', reason: '客户增加数量并调整规格', createdAt: '2026-09-07T02:00:00.000Z' },
    printPending: false,
    pendingPrintJobId: null,
    trackingNo: null,
    progress: {
      orderTotal: '2000', foilingProgress: '0', packingProgress: '0',
      foilingOverLimit: false, packingOverLimit: false, packingAhead: false,
      stagnant: false, stagnationDays: 0, firstClaimedAt: null,
    },
    logs: [],
  };
}
