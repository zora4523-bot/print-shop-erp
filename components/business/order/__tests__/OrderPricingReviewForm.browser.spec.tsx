import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';

const { previewActionMock, finalizeActionMock, refreshMock } = vi.hoisted(() => ({
  previewActionMock: vi.fn(),
  finalizeActionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: previewActionMock,
  finalizeOrderPricingAction: finalizeActionMock,
}));


import { OrderPricingReviewForm } from '../OrderPricingReviewForm';

function preview(): OrderPricingReviewPreview {
  return {
    orderId: 'order-1',
    orderNo: 'GD-260902-001',
    orderRevision: 1,
    priceRevision: 1,
    currentProcessingAmount: '170.00',
    currentPackagingAmount: '10.00',
    currentTotalAmount: '180.00',
    processingPriceBook: null,
    logisticsPriceBook: null,
    items: [],
    packagingGroups: [],
    orderCharges: [
      {
        chargeId: 'plate-pending',
        businessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
        categoryCode: 'PLATE_MAKING_FEE',
        description: '制烫金版费',
        complete: false,
        errors: ['制烫金版费始终由管理员按实际成本确认'],
        suggestedAmount: null,
        currentAmount: null,
        currentReason: null,
      },
    ],
    shipments: [],
  };
}

async function settleEffects() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

it('管理员可从空白制烫金版费录入金额和依据后提交', async () => {
  previewActionMock.mockImplementation(async () => ({
    status: 'success',
    preview: preview(),
  }));
  finalizeActionMock.mockImplementation(async () => ({
    status: 'error',
    message: '测试已捕获提交',
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    flushSync(() => root.render(<OrderPricingReviewForm orderId="order-1" />));
    await settleEffects();

    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLInputElement>('input[inputmode="decimal"]'),
      ).not.toBeNull();
    });

    const amount = host.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    const reason = host.querySelector<HTMLTextAreaElement>('textarea');
    const confirm = host.querySelector<HTMLButtonElement>(
      '[data-slot="pricing-submit"]',
    );
    expect(amount?.value).toBe('');
    expect(reason?.value).toBe('');
    expect(confirm?.disabled).toBe(true);

    setValue(amount!, '45.50');
    setValue(reason!, '管理员按实际制版成本确认');
    await vi.waitFor(() => expect(confirm?.disabled).toBe(false));
    confirm?.click();
    await vi.waitFor(() => {
      expect(finalizeActionMock).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          orderCharges: [
            {
              chargeId: 'plate-pending',
              expectedBusinessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
              amount: '45.50',
              reason: '管理员按实际制版成本确认',
            },
          ],
        }),
      );
    });
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
