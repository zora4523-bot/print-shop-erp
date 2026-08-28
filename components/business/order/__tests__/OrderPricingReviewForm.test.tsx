import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FinalizeOrderPricingMutationResult,
  PreviewOrderPricingReviewResult,
} from '@/actions/order.types';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import type { OrderPricingReviewPreview } from '@/lib/order/pricing-review';

const { harness } = vi.hoisted(() => ({
  harness: {
    hookIndex: 0,
    previewState: null as PreviewOrderPricingReviewResult | null,
    finalizeState: null as FinalizeOrderPricingMutationResult | null,
    previewAction: vi.fn(),
    finalizeAction: vi.fn(),
    onConfirm: null as (() => void) | null,
    refresh: vi.fn(),
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => {
      const previewHook = harness.hookIndex++ % 2 === 0;
      return previewHook
        ? [harness.previewState, harness.previewAction]
        : [harness.finalizeState, harness.finalizeAction];
    },
    useTransition: () => [false, (callback: () => void) => callback()],
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: harness.refresh }),
}));

vi.mock('@/actions/order', () => ({
  previewOrderPricingReviewAction: vi.fn(),
  finalizeOrderPricingAction: vi.fn(),
}));

vi.mock('@/components/ui-business', () => ({
  ConfirmActionDialog: ({ onConfirm }: { onConfirm: () => void }) => {
    harness.onConfirm = onConfirm;
    return null;
  },
}));

import { OrderPricingReviewForm } from '../OrderPricingReviewForm';

function preview(): OrderPricingReviewPreview {
  return {
    orderId: 'order-1',
    orderNo: 'GD-260826-001',
    orderRevision: 8,
    priceRevision: 3,
    currentProcessingAmount: '130.00',
    currentPackagingAmount: '20.00',
    currentTotalAmount: '165.00',
    processingPriceBook: {
      id: 'processing-v3',
      code: 'PROCESSING_EXTERNAL',
      name: '外销加工费',
      version: 3,
      sourceName: '加工费.xlsx',
      sourceSha256: 'a'.repeat(64),
    },
    logisticsPriceBook: {
      id: 'logistics-v2',
      code: 'LOGISTICS_EXTERNAL',
      name: '外销物流费',
      version: 2,
      sourceName: '物流费.xlsx',
      sourceSha256: 'b'.repeat(64),
    },
    items: [
      {
        itemId: 'item-manual',
        sequence: 1,
        name: '配置外纸张',
        quantity: 100,
        complete: false,
        errors: ['配置外纸张需人工核价'],
        manualQuoteReason: '客户自带纸，建单时转人工',
        currentUnitPrice: '0.2000',
        currentFixedFee: '5.00',
        currentSubtotal: '25.00',
        suggestedUnitPrice: null,
        suggestedFixedFee: null,
        suggestedSubtotal: null,
        currentReason: '工厂已核对纸张',
      },
    ],
    packagingGroups: [
      {
        packagingGroupId: 'packaging-auto',
        sequence: 1,
        name: '单款装',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        complete: true,
        errors: [],
        currentUnitPrice: '9.0000',
        currentSubtotal: '900.00',
        suggestedUnitPrice: '0.1000',
        suggestedSubtotal: '10.00',
        currentReason: '旧人工价',
      },
      {
        packagingGroupId: 'packaging-manual',
        sequence: 2,
        name: '混装',
        mode: OrderPackagingMode.MIXED_STYLE,
        actualBagCount: 50,
        complete: false,
        errors: ['当前规则未覆盖混装'],
        currentUnitPrice: '0.2000',
        currentSubtotal: '10.00',
        suggestedUnitPrice: null,
        suggestedSubtotal: null,
        currentReason: '管理员按混装工艺确认',
      },
    ],
    shipments: [],
  };
}

function render() {
  harness.hookIndex = 0;
  return renderToStaticMarkup(<OrderPricingReviewForm orderId="order-1" />);
}

beforeEach(() => {
  harness.hookIndex = 0;
  harness.previewState = { status: 'success', preview: preview() };
  harness.finalizeState = null;
  harness.previewAction.mockReset();
  harness.finalizeAction.mockReset();
  harness.onConfirm = null;
  harness.refresh.mockReset();
});

describe('OrderPricingReviewForm snapshot confirmation contract', () => {
  it('submits immutable packaging facts while keeping the stored automatic amount', () => {
    render();

    expect(harness.onConfirm).not.toBeNull();
    harness.onConfirm?.();

    expect(harness.finalizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        expectedOrderRevision: 8,
        expectedPriceRevision: 3,
        packagingGroups: [
          {
            packagingGroupId: 'packaging-auto',
            expectedMode: OrderPackagingMode.SINGLE_STYLE,
            expectedActualBagCount: 100,
            unitPrice: '9.0000',
            reason: '旧人工价',
          },
          {
            packagingGroupId: 'packaging-manual',
            expectedMode: OrderPackagingMode.MIXED_STYLE,
            expectedActualBagCount: 50,
            unitPrice: '0.2000',
            reason: '管理员按混装工艺确认',
          },
        ],
      }),
    );
  });

  it('describes snapshot confirmation without promising a latest-rule reprice', () => {
    const html = render();

    expect(html).toContain('工厂核价确认');
    expect(html).toContain('仅核对工单已保存的报价快照');
    expect(html).toContain('已锁定快照价');
    expect(html).toContain('建单转人工原因：客户自带纸，建单时转人工');
    expect(html).not.toContain('按最新价格');
    expect(html).not.toContain('最新规则自动价');
  });

  it('shows the finalized packaging total returned by the server action', () => {
    harness.finalizeState = {
      status: 'success',
      orderId: 'order-1',
      priceRevision: 4,
      packagingAmount: '20.00',
      processingAmount: '150.00',
      totalAmount: '185.00',
      confirmedFee: '185.00',
    };

    const html = render();

    expect(html).toContain('终价已确认：入袋费 20.00');
    expect(html).toContain('加工费合计 150.00');
    expect(html).toContain('工单总额 185.00');
  });
});
