import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/actions/order-fulfillment-pricing', () => ({
  previewFulfillmentPricingAction: vi.fn(), finalizeFulfillmentPricingAction: vi.fn(),
}));
import { FulfillmentPricingReviewForm } from '../FulfillmentPricingReviewForm';

describe('fulfillment pricing review surface', () => {
  it('offers a dedicated recoverable logistics review without whole-order repricing fields', () => {
    const html = renderToStaticMarkup(<FulfillmentPricingReviewForm
      orderId="order-1" currentValue={false} isPricingPending
      shipments={[{ id: 'shipment-1', sequence: 1, destinationProvince: '浙江', weightKg: '2' }]}
    />);
    expect(html).toContain('物流费用确认');
    expect(html).toContain('预览费用差额');
    expect(html).not.toContain('系统会拒绝此入口');
    expect(html).toContain('sfShipmentId');
    expect(html).not.toContain('name="unitPrice"');
    expect(html).not.toContain('name="processingAmount"');
    expect(html).not.toContain('确认物流费用</button>');
    expect(html).not.toContain('<table');
  });
});
