import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as null | {
      status: 'invalid';
      fieldErrors: Record<string, string[]>;
    },
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn()],
    useTransition: () => [false, vi.fn()],
  };
});

vi.mock('@/actions/order', () => ({
  shipOrderAction: vi.fn(),
}));

import { ShipOrderForm } from '../ShipOrderForm';

const shipment = {
  id: 'shipment-1',
  sequence: 1,
  receiverName: '张三',
  receiverAddress: '浙江省杭州市',
  trackingNo: null,
  weightKg: '12.5',
  destinationProvince: '浙江',
  shippingFee: '18.00',
  packingMaterialFee: '4.00',
  customerChargeOverrideReason: null,
};

beforeEach(() => {
  actionState.current = null;
});

describe('ShipOrderForm external-sales charge fields', () => {
  it('locks SF collect shipping inputs to zero while keeping packing material editable and required', () => {
    const html = renderToStaticMarkup(
      <ShipOrderForm
        orderId="order-1"
        shipments={[shipment]}
        isExternalSales
        isSfCollect
      />,
    );

    expect(html).toMatch(
      /type="hidden" name="shipmentShippingFee" value="0\.00"/,
    );
    expect(html).toMatch(/type="hidden" name="shipmentWeightKg" value=""/);
    expect(html).toMatch(
      /type="hidden" name="shipmentDestinationProvince" value=""/,
    );
    expect(html).toMatch(
      /id="shipment-shipment-1-shipping-fee"[^>]*disabled=""/,
    );
    expect(html).toMatch(/id="shipment-shipment-1-weight"[^>]*disabled=""/);
    expect(html).toMatch(/id="shipment-shipment-1-province"[^>]*disabled=""/);
    const packingInput = html.match(
      /<input[^>]*id="shipment-shipment-1-packing-fee"[^>]*>/,
    )?.[0];
    expect(packingInput).toContain('name="shipmentPackingMaterialFee"');
    expect(packingInput).toContain('required=""');
    expect(packingInput).toContain('aria-required="true"');
    expect(html).toContain('顺丰到付也需单独确认纸箱等打包耗材费');
  });

  it('requires editable shipping and packing charges for a regular external-sales shipment', () => {
    const html = renderToStaticMarkup(
      <ShipOrderForm
        orderId="order-1"
        shipments={[shipment]}
        isExternalSales
        isSfCollect={false}
      />,
    );

    const shippingInput = html.match(
      /<input[^>]*id="shipment-shipment-1-shipping-fee"[^>]*>/,
    )?.[0];
    const weightInput = html.match(
      /<input[^>]*id="shipment-shipment-1-weight"[^>]*>/,
    )?.[0];
    const packingInput = html.match(
      /<input[^>]*id="shipment-shipment-1-packing-fee"[^>]*>/,
    )?.[0];
    expect(shippingInput).toContain('name="shipmentShippingFee"');
    expect(shippingInput).toContain('required=""');
    expect(shippingInput).toContain('aria-required="true"');
    expect(weightInput).toContain('name="shipmentWeightKg"');
    expect(weightInput).toContain('required=""');
    expect(weightInput).toContain('aria-required="true"');
    expect(packingInput).toContain('name="shipmentPackingMaterialFee"');
    expect(packingInput).toContain('required=""');
    expect(packingInput).toContain('aria-required="true"');
    expect(html).toContain(
      'aria-describedby="shipment-shipment-1-shipping-hint"',
    );
    expect(html).toContain(
      'aria-describedby="shipment-shipment-1-packing-hint"',
    );
    expect(html).not.toContain(
      'type="hidden" name="shipmentShippingFee"',
    );
  });

  it('associates nested server field errors with their shipment inputs', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        'shipments.0.shippingFee': ['快递费格式不正确'],
        'shipments.0.packingMaterialFee': ['耗材费格式不正确'],
      },
    };

    const html = renderToStaticMarkup(
      <ShipOrderForm
        orderId="order-1"
        shipments={[shipment]}
        isExternalSales
        isSfCollect={false}
      />,
    );

    expect(html).toContain(
      'aria-describedby="shipment-shipment-1-shipping-error"',
    );
    expect(html).toContain(
      'id="shipment-shipment-1-shipping-error" role="alert"',
    );
    expect(html).toContain(
      'aria-describedby="shipment-shipment-1-packing-error"',
    );
    expect(html).toContain(
      'id="shipment-shipment-1-packing-error" role="alert"',
    );
  });
});
