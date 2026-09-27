import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
import '@/app/globals.css';
import styles from '../AdminOrderDetailView.module.css';

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
  previewOrderPricingReviewAction: vi.fn(), finalizeOrderPricingAction: vi.fn(), shipOrderAction: vi.fn(),
  previewOrderChangeRequestPricingAction: previewAction,
  previewOrderCancellationSettlementAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));
vi.mock('@/actions/order-fulfillment-pricing', () => ({ previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn() }));
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

import { AdminOrderDecisionPanel } from '../AdminOrderDecisionPanel';

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

async function openDecision() {
  flushSync(() => root.render(<section data-order-decision="" data-emphasis="inverse" className={`${styles.decision} mx-auto max-w-lg`}><AdminOrderDecisionPanel order={orderFixture()} compact /></section>));
  await expect.element(page.getByRole('button', { name: '刷新最新计价预览', exact: true })).toBeVisible();
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

describe('admin order detail decision layout', () => {
  for (const [width, height] of viewports) {
    for (const theme of ['light', 'dark']) {
      it(`${width}×${height} ${theme}: width, section spacing, controls and accessibility`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        await openDecision();

        const drawer = requiredElement('[data-order-decision]');
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
        expect(await commands.checkShellAccessibility('[data-order-decision]')).toEqual([]);
      });
    }
  }

  it('enabled rejection stays red on the left and approval stays dark on the right', async () => {
    await page.viewport(1280, 800);
    previewAction.mockResolvedValue({
      status: 'success',
      preview: { ...pricingPreview(), complete: true, newTotal: '1200.00', delta: '200.00', pendingCharges: [] },
    });
    await openDecision();
    await page.getByText('填写拒绝原因 / 审核备注', { exact: true }).click();
    await page.getByLabelText('审核备注 / 拒绝原因', { exact: false }).fill('请核对客户确认的规格。');
    const approve = page.getByRole('button', { name: '批准变更', exact: true });
    const reject = page.getByRole('button', { name: '拒绝申请', exact: true });
    await expect.element(approve).toBeEnabled();
    await expect.element(reject).toBeEnabled();
    expect(reject.element().getBoundingClientRect().right).toBeLessThan(approve.element().getBoundingClientRect().left);
    // 强调层由 Button 的 `in-data-[emphasis=inverse]` 声明，不再反转 `--primary`：
    // 拒绝是真·品牌红，批准是深色，两者必须彼此不同。
    const rejectBackground = getComputedStyle(reject.element()).backgroundColor;
    const approveBackground = getComputedStyle(approve.element()).backgroundColor;
    expect(rejectBackground).toBe(getComputedStyle(reject.element()).getPropertyValue('--primary').trim());
    expect(approveBackground).toBe(getComputedStyle(approve.element()).getPropertyValue('--foreground').trim());
    expect(rejectBackground).not.toBe(approveBackground);
    expect(await commands.checkShellAccessibility('[data-order-decision]')).toEqual([]);
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
