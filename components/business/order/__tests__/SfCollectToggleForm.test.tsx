import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';

vi.mock('@/actions/order', () => ({
  setOrderSfCollectAction: vi.fn(),
}));

import { SfCollectToggleForm } from '../SfCollectToggleForm';

const shipments = [
  {
    id: 'shipment-1',
    sequence: 1,
    destinationProvince: '浙江',
    weightKg: '12.5',
    shippingFee: null,
    customerChargeOverrideReason: null,
  },
  {
    id: 'shipment-2',
    sequence: 2,
    destinationProvince: '广东',
    weightKg: '8',
    shippingFee: '18.50',
    customerChargeOverrideReason: '实际报价',
  },
];

describe('SfCollectToggleForm', () => {
  it('仅在已发货外部销售工单取消到付时展开逐票补录', () => {
    const html = renderToStaticMarkup(
      <SfCollectToggleForm
        orderId="order-1"
        currentValue
        status={OrderStatus.SHIPPED}
        isExternalSales
        shipments={shipments}
      />,
    );

    expect(html).toContain('aria-label="取消顺丰到付并补录每票快递费"');
    expect(html.match(/name="sfShipmentId"/g)).toHaveLength(2);
    expect(html.match(/name="sfShipmentDestinationProvince"/g)).toHaveLength(2);
    expect(html.match(/name="sfShipmentWeightKg"/g)).toHaveLength(2);
    expect(html.match(/name="sfShipmentShippingFee"/g)).toHaveLength(2);
    expect(html.match(/name="sfShipmentChargeOverrideReason"/g)).toHaveLength(2);
    expect(html).toContain('value="浙江" selected=""');

    const province = html.match(
      /<select[^>]*id="sf-shipment-shipment-1-province"[^>]*>/,
    )?.[0];
    const weight = html.match(
      /<input[^>]*id="sf-shipment-shipment-1-weight"[^>]*>/,
    )?.[0];
    const shipping = html.match(
      /<input[^>]*id="sf-shipment-shipment-1-shipping-fee"[^>]*>/,
    )?.[0];
    expect(province).toContain('required=""');
    expect(province).toContain('aria-required="true"');
    expect(weight).toContain('required=""');
    expect(weight).toContain('aria-required="true"');
    expect(shipping).not.toContain('required=""');
    expect(html).toContain('留空则按冻结价目自动核价');
    expect(html).toContain('确认取消并重新核算应收');
  });

  it('其他状态和标记到付仍保持一键切换', () => {
    const markHtml = renderToStaticMarkup(
      <SfCollectToggleForm
        orderId="order-1"
        currentValue={false}
        status={OrderStatus.SHIPPED}
        isExternalSales
        shipments={shipments}
      />,
    );
    const preShippingHtml = renderToStaticMarkup(
      <SfCollectToggleForm
        orderId="order-1"
        currentValue
        status={OrderStatus.COMPLETED}
        isExternalSales
        shipments={shipments}
      />,
    );

    expect(markHtml).toContain('标记顺丰到付');
    expect(preShippingHtml).toContain('取消顺丰到付');
    expect(markHtml).not.toContain('name="sfShipmentId"');
    expect(preShippingHtml).not.toContain('name="sfShipmentId"');
  });
});
