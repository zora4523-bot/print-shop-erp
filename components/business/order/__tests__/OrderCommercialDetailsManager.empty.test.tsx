import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { OrderCommercialDetailsManager } from '../OrderCommercialDetailsManager';

vi.mock('@/actions/order', () => ({
  deleteOrderManualChargeAction: vi.fn(), deleteOrderPlateDetailAction: vi.fn(),
  saveOrderManualChargeAction: vi.fn(), saveOrderPlateDetailAction: vi.fn(),
}));

const item = { id: 'item-1', sequence: 1, name: '礼盒', independentPlateEligible: false, plateDetails: [] };
it('omits an optional empty plate section and keeps order charge controls', () => {
  const html = renderToStaticMarkup(<OrderCommercialDetailsManager orderId="order-1" priceRevision={1} manualCharges={[]} items={[item]} allowPlateDetailMaintenance />);
  expect(html).not.toContain('按款式制版明细');
  expect(html).not.toContain('无需独立制版');
  expect(html).toContain('添加整单费用');
});
it('retains plate editing for eligible styles and the real pricing blocker', () => {
  const render = (allowed: boolean) => renderToStaticMarkup(<OrderCommercialDetailsManager orderId="order-1" priceRevision={1} manualCharges={[]} items={[{ ...item, independentPlateEligible: true }]} allowPlateDetailMaintenance={allowed} />);
  expect(render(true)).toContain('添加制版明细');
  expect(render(false)).toContain('工单价格确认后才能维护逐款制版明细');
  expect(render(false)).not.toContain('添加制版明细');
});
it('retains saved plate records even when the current style is ineligible', () => {
  const html = renderToStaticMarkup(<OrderCommercialDetailsManager orderId="order-1" priceRevision={1} manualCharges={[]} items={[{ ...item, plateDetails: [{
    id: 'plate-1', sequence: 1, name: '历史版', plateGroupId: null, specification: null, quantity: 1, unitPrice: '20.00', amount: '20.00', remark: null, isActive: false,
  }] }]} allowPlateDetailMaintenance />);
  expect(html).toContain('历史版');
  expect(html).toContain('已移除');
  expect(html).not.toContain('添加制版明细');
});
