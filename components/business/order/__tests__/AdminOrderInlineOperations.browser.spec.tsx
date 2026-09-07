import '@/app/globals.css';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import drawerStyles from '../AdminOrderDrawer.module.css';

const { previewAction, finalizeAction, shipAction, refresh, completed } = vi.hoisted(() => ({
  previewAction: vi.fn(), finalizeAction: vi.fn(), shipAction: vi.fn(), refresh: vi.fn(), completed: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({ default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
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
  vi.clearAllMocks();
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
  flushSync(() => root.render(<Sheet><SheetTrigger render={<Button />}>打开工单</SheetTrigger><SheetContent className={drawerStyles.drawer} data-order-drawer="">
    <SheetHeader className={drawerStyles.header}><SheetTitle>工单处理</SheetTitle><SheetDescription>GD-INLINE-001</SheetDescription></SheetHeader>
    <div className={drawerStyles.body} data-slot="admin-order-drawer-body"><AdminOrderInlineOperations order={order(kind)} onCompleted={onCompleted} /></div>
  </SheetContent></Sheet>));
  await page.getByRole('button', { name: '打开工单', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-order-drawer]')?.hasAttribute('data-starting-style')).toBe(false);
  await Promise.all(document.querySelector('[data-order-drawer]')!.getAnimations().map((animation) => animation.finished));
  const trigger = page.getByRole('button', { name: kind === 'pricing' ? '录入人工核价' : '录运单发货', exact: true });
  await trigger.click();
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByLabelText(kind === 'pricing' ? '确认金额（元）' : '运单号（选填）')).toBeVisible();
}

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    for (const kind of ['pricing', 'shipping'] as const) {
      it(`${kind} ${width}×${height} ${theme}: inline form is accessible and fits drawer`, async () => {
        await page.viewport(width, height); document.documentElement.classList.toggle('dark', theme === 'dark');
        await open(kind);
        const drawer = document.querySelector<HTMLElement>('[data-order-drawer]')!;
        const body = document.querySelector<HTMLElement>('[data-slot="admin-order-drawer-body"]')!;
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
        expect(await commands.checkShellAccessibility('[data-order-drawer]')).toEqual([]);
      });
    }
  }
}

it('pricing links preserve the drawer hash; confirmation retains errors and draft values', async () => {
  await page.viewport(1280, 800); history.replaceState(null, '', `${location.pathname}#wo=GD-INLINE-001`);
  await open('pricing');
  await page.getByRole('link', { name: '制版费', exact: true }).click();
  expect(location.hash).toBe('#wo=GD-INLINE-001');
  await page.getByLabelText('确认金额（元）').fill('45.50');
  await page.getByLabelText('定价依据', { exact: true }).fill('工厂报价已核对');
  await page.getByRole('button', { name: '确认工厂核价', exact: true }).click();
  expect(finalizeAction).not.toHaveBeenCalled();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认工厂核价', exact: true }).click();
  await expect.element(page.getByText('工单已更新，请重新预览', { exact: true })).toBeVisible();
  expect(finalizeAction).toHaveBeenCalledWith(null, expect.objectContaining({ expectedOrderRevision: 4, expectedPriceRevision: 7, orderCharges: [expect.objectContaining({ amount: '45.50', reason: '工厂报价已核对' })] }));
  await expect.element(page.getByLabelText('确认金额（元）')).toHaveValue('45.50');
});

it('shipping waits for confirmation and refreshes the list without leaving the drawer', async () => {
  await page.viewport(393, 852); await open('shipping');
  await page.getByLabelText('运单号（选填）').fill('ZTO-123456');
  await page.getByRole('button', { name: '确认 1 个地址已发货', exact: true }).click();
  expect(shipAction).not.toHaveBeenCalled();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(shipAction).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '确认 1 个地址已发货', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认发货并重算应收', exact: true }).click();
  await expect.element(page.getByText('工单已发货', { exact: true })).toBeVisible();
  await expect.poll(() => refresh.mock.calls.length).toBeGreaterThan(0);
  const formData = shipAction.mock.calls[0][2] as FormData;
  expect(formData.get('expectedRevision')).toBe('4'); expect(formData.get('expectedPriceRevision')).toBe('7');
  expect(formData.get('shipmentTrackingNo')).toBe('ZTO-123456');
});

it.each(['pricing', 'shipping'] as const)('%s completes and reports once after its pending form is collapsed', async (kind) => {
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
  await page.getByRole('alertdialog').getByRole('button', { name: kind === 'pricing' ? '确认工厂核价' : '确认发货并重算应收', exact: true }).click();
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
