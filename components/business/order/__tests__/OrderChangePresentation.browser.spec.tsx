import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page, commands, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
vi.mock('next/link', () => ({default: ({children, ...props}: React.ComponentProps<'a'>) => <a {...props}>{children}</a>}));
vi.mock('next/navigation', () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock('@/actions/order', () => ({ previewOrderChangeRequestPricingAction: vi.fn(), reviewOrderChangeRequestAction: vi.fn() }));
import { OrderChangePricingPreviewPanel, orderChangeApprovalConfirmation, type OrderChangePendingCharge } from '../OrderChangeReviewForm';
function preview(
  overrides: Partial<
    OrderChangePricingPreview & {
      priceRevision: number;
      pendingCharges: OrderChangePendingCharge[];
      totalExcludesPendingPlateFee: boolean;
    }
  > = {},
): OrderChangePricingPreview & {
  priceRevision: number;
  pendingCharges: OrderChangePendingCharge[];
  totalExcludesPendingPlateFee: boolean;
} {
  return {
    requestId: 'request-1',
    orderId: 'order-1',
    baseRevision: 2,
    quotedAt: '2026-08-07T08:00:00.000Z',
    priceRevision: 4,
    quoteToken: `order-change-approval-v1:${'a'.repeat(64)}`,
    complete: true,
    requiresReviewRemark: false,
    oldTotal: '1000.00',
    newTotal: '960.00',
    delta: '-40.00',
    items: [
      {
        changeIndex: 0,
        operation: 'UPDATE',
        sourceItemId: 'item-1',
        previousName: '红包 A',
        name: '红包 A',
        previousQuantity: 1000,
        quantity: 1200,
        previousSpecification: '90×165',
        specification: '90×165',
        previousFrontFoilColors: ['金色'],
        frontFoilColors: ['金色'],
        previousBackFoilColors: [],
        backFoilColors: [],
        priceImpact: 'QUOTED',
        oldSubtotal: '1000.00',
        newSubtotal: '960.00',
        suggestedUnitPrice: '0.8000',
        suggestedFixedFee: '0.00',
        errors: [],
      },
    ],
    pendingCharges: [],
    totalExcludesPendingPlateFee: false,
    ...overrides,
  };
}


for (const [width, height] of [[360,800],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080]]) {
  it(`order change review at ${width}x${height} keeps amounts and keyboard confirmation`, async () => {
    await page.viewport(width, height);
    document.documentElement.lang = 'zh-CN';
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const approval = orderChangeApprovalConfirmation(preview());
    const confirm = vi.fn();
    try {
      flushSync(() => root.render(<main className="p-4">
        <h1>变更申请</h1>
        <OrderChangePricingPreviewPanel preview={preview()} />
        <ConfirmActionController level="L2" trigger={<Button>批准变更</Button>} onConfirm={confirm}>
          <ConfirmActionDialog action="批准变更" changes={approval.changes} consequences={approval.consequences} confirmText="批准" />
        </ConfirmActionController>
      </main>));
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      expect(host.textContent).toContain('¥ 960.00');
      expect(host.textContent).toContain('-¥ 40.00');
      expect(host.textContent).not.toContain(approval.consequences[0]);
      await page.getByRole('button',{name:'批准变更',exact:true}).click();
      await expect.element(page.getByRole('alertdialog')).toBeVisible();
      expect(document.body.textContent?.split(approval.consequences[0])).toHaveLength(2);
      await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>undefined)));
      expect(await commands.checkShellAccessibility('[role="alertdialog"]')).toEqual([]);
      const dialog=document.querySelector('[role="alertdialog"]')!;
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
      await userEvent.keyboard('{Escape}');
      await expect.poll(()=>document.activeElement?.textContent).toBe('批准变更');
      expect(confirm).not.toHaveBeenCalled();
    } finally { flushSync(()=>root.unmount()); host.remove(); }
  });
}
