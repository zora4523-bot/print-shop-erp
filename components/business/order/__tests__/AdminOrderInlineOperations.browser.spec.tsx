import '@/app/globals.css';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';

const { previewAction, finalizeAction, shipAction, refresh, completed } = vi.hoisted(() => ({
  previewAction: vi.fn(), finalizeAction: vi.fn(), shipAction: vi.fn(), refresh: vi.fn(), completed: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
vi.mock('@/actions/order', () => ({ previewOrderPricingReviewAction: previewAction, finalizeOrderPricingAction: finalizeAction, shipOrderAction: shipAction }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({ previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn() }));
import { AdminOrderInlineOperations } from '../AdminOrderInlineOperations';

type InlineOrder = ComponentProps<typeof AdminOrderInlineOperations>['order'];
let root: Root;
let host: HTMLDivElement;
function pricingPreview(): OrderPricingReviewPreview {
  return {
    orderId: 'inline-order', orderNo: 'GD-INLINE-001', orderRevision: 4, priceRevision: 7,
    currentProcessingAmount: '170.00', currentPackagingAmount: '10.00', currentTotalAmount: '180.00',
    processingPriceBook: null, logisticsPriceBook: null, items: [], packagingGroups: [], shipments: [],
    orderCharges: [{ chargeId: 'plate', businessKey: 'ORDER:PLATE_MAKING_FEE:PENDING', categoryCode: 'PLATE_MAKING_FEE', description: '制版费', complete: false, errors: [], suggestedAmount: null, currentAmount: null, currentReason: null }],
  };
}
function order(kind: 'pricing' | 'shipping'): InlineOrder {
  return {
    id: 'inline-order', fee: { amount: '180.00', source: 'CONFIRMED', estimated: false }, pendingChangeRequest: null, priceComparisonError: null,
    inlineOperations: kind === 'pricing' ? { pricing: 'factory', shipping: null, fulfillment: null } : {
      pricing: null, fulfillment: null, shipping: {
        expectedRevision: 4, expectedEditVersion: 3, expectedWorkOrderVersion: 2, expectedPriceRevision: 7,
        isExternalSales: true, isSfCollect: false,
        shipments: [{ id: 'shipment', sequence: 1, receiverName: '张先生', receiverAddress: '浙江省杭州市滨江区印刷园区一号仓库', trackingNo: null, weightKg: '12.5', destinationProvince: '浙江', shippingFee: '18.20', packingMaterialFee: '3.50', customerChargeOverrideReason: null }],
      },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  previewAction.mockResolvedValue({ status: 'success', preview: pricingPreview() });
  finalizeAction.mockResolvedValue({ status: 'error', message: '工单已更新，请重新预览' });
  shipAction.mockResolvedValue({ status: 'success' });
});
afterEach(() => {
  flushSync(() => root.unmount()); host.remove();
  document.documentElement.classList.remove('dark'); history.replaceState(null, '', location.pathname);
});
async function open(kind: 'pricing' | 'shipping', onCompleted?: (message: string) => void) {
  flushSync(() => root.render(<section data-order-operations="" className="admin-viewport m-4 min-w-0 rounded-lg border p-4">
    <h2>工单处理</h2>
    <div data-slot="order-operations-body"><AdminOrderInlineOperations order={order(kind)} onCompleted={onCompleted} /></div>
  </section>));
  const trigger = page.getByRole('button', { name: kind === 'pricing' ? '录入人工核价' : '录运单发货', exact: true });
  await trigger.click();
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
  if (kind === 'pricing') await expect.element(page.getByLabelText('确认金额（元）')).toBeVisible();
  else await expect.element(page.getByRole('link', { name: '前往登记物流' })).toBeVisible();
}

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    for (const kind of ['pricing', 'shipping'] as const) {
      it(`${kind} ${width}×${height} ${theme}: inline form is accessible and fits detail page`, async () => {
        await page.viewport(width, height); document.documentElement.classList.toggle('dark', theme === 'dark');
        await open(kind);
        const drawer = document.querySelector<HTMLElement>('[data-order-operations]')!;
        const body = document.querySelector<HTMLElement>('[data-slot="order-operations-body"]')!;
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        for (const control of drawer.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea')) {
          if (!control.checkVisibility()) continue;
          const rect = control.getBoundingClientRect();
          expect(rect.width, control.outerHTML).toBeGreaterThanOrEqual(44);
          expect(rect.height, control.outerHTML).toBeGreaterThanOrEqual(44);
          expect(rect.right).toBeLessThanOrEqual(width + 1);
          expect(rect.left).toBeGreaterThanOrEqual(drawer.getBoundingClientRect().left - 1);
        }
        expect(await commands.checkShellAccessibility('[data-order-operations]')).toEqual([]);
      });
    }
  }
}

it('pricing links preserve the current detail anchor; confirmation retains errors and draft values', async () => {
  await page.viewport(1280, 800); history.replaceState(null, '', `${location.pathname}#order-detail-actions`);
  await open('pricing');
  await page.getByRole('link', { name: '制版费', exact: true }).click();
  expect(location.hash).toBe('#order-detail-actions');
  await page.getByLabelText('确认金额（元）').fill('45.50');
  await page.getByLabelText('定价依据', { exact: true }).fill('工厂报价已核对');
  await page.getByRole('button', { name: '确认工厂核价', exact: true }).click();
  await expect.poll(() => finalizeAction.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  await expect.element(page.getByText('工单已更新，请重新预览', { exact: true })).toBeVisible();
  expect(finalizeAction).toHaveBeenCalledWith(null, expect.objectContaining({ expectedOrderRevision: 4, expectedPriceRevision: 7, orderCharges: [expect.objectContaining({ amount: '45.50', reason: '工厂报价已核对' })] }));
  await expect.element(page.getByLabelText('确认金额（元）')).toHaveValue('45.50');
});

it('shipping directs users to the per-address registration without calling the old writer', async () => {
  await open('shipping');
  await expect.element(page.getByRole('link', { name: '前往登记物流' })).toHaveAttribute('href', '/orders/inline-order#shipment-registration');
  expect(shipAction).not.toHaveBeenCalled();
});

it.each(['pricing'] as const)('%s completes and reports once after its pending form is collapsed', async (kind) => {
  let finish!: (result: { status: 'success' }) => void;
  const action = kind === 'pricing' ? finalizeAction : shipAction;
  action.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await page.viewport(393, 852);
  await open(kind, completed);
  if (kind === 'pricing') {
    await page.getByLabelText('确认金额（元）').fill('45.50');
    await page.getByLabelText('定价依据', { exact: true }).fill('工厂报价已核对');
  } else {
    await page.getByLabelText('运单号（选填）').fill('ZTO-987654');
  }
  await page.getByRole('button', { name: kind === 'pricing' ? '确认工厂核价' : '确认 1 个地址已发货', exact: true }).click();
  await expect.poll(() => action.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  const trigger = page.getByRole('button', { name: kind === 'pricing' ? '录入人工核价' : '录运单发货', exact: true });
  await trigger.click();
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
  const container = document.getElementById(trigger.element().getAttribute('aria-controls')!)!;
  expect(container.hidden).toBe(true);
  expect(container.querySelector('input')).not.toBeNull();
  finish({ status: 'success' });
  await expect.poll(() => completed.mock.calls.length).toBe(1);
  expect(completed).toHaveBeenCalledWith(kind === 'pricing' ? '核价已确认' : '工单已发货');
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(action).toHaveBeenCalledTimes(1);
});
