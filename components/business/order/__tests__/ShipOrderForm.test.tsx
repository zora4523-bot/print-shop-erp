import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as null | {
      status: 'invalid';
      fieldErrors: Record<string, string[]>;
    } | { status: 'error'; message: string },
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn()],
    useTransition: () => [actionState.pending, vi.fn()],
  };
});

vi.mock('@/actions/order', () => ({
  shipOrderAction: vi.fn(),
}));

import { ShipOrderForm, shipOrderImpactItems } from '../ShipOrderForm';

const source = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'ShipOrderForm.tsx',
  ),
  'utf8',
);

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
  actionState.pending = false;
});

describe('ShipOrderForm external-sales charge fields', () => {
  it('states the exact L2 shipping contract without inventing inventory effects or a terminal state', () => {
    const impact = shipOrderImpactItems({
      shipments: [shipment],
      isExternalSales: true,
      isSfCollect: false,
      values: {
        trackingNos: ['ZTO-20260824'],
        shippingFees: ['21.50'],
        packingMaterialFees: ['5.00'],
      },
    }).join('\n');

    expect(impact).toContain(
      '地址 1（张三）：运单号 ZTO-20260824，对客快递费 ¥21.50，打包耗材费 ¥5.00',
    );
    expect(impact).toContain('转为最终收费');
    expect(impact).toContain('重算应收总额');
    expect(impact).toContain('按工单创建时价格核价');
    expect(impact).toContain('发货后仍需“确认完工”');
    expect(impact).toContain('不会扣减库存');
  });

  it('describes SF collect charges without claiming that shipping is billed to the customer', () => {
    const impact = shipOrderImpactItems({
      shipments: [shipment],
      isExternalSales: true,
      isSfCollect: true,
      values: { packingMaterialFees: ['6.00'] },
    }).join('\n');

    expect(impact).toContain('对客快递费 ¥0.00（顺丰到付）');
    expect(impact).toContain('打包耗材费 ¥6.00');
  });

  it('opens the shared L2 confirmation before dispatching the shipping action', () => {
    expect(source).toContain('<ConfirmActionDialog');
    expect(source).toContain('level="L2"');
    expect(source).toContain('onSubmit={handleSubmit}');
    expect(source).toContain('onConfirm={confirmShipment}');
    expect(source).not.toContain(
      'action={(fd) => startTransition(() => action(fd))}',
    );
  });

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

  it('marks the form busy and hides stale failure feedback during resubmission', () => {
    actionState.current = { status: 'error', message: '工单状态已经变化' };
    actionState.pending = true;

    const html = renderToStaticMarkup(
      <ShipOrderForm
        orderId="order-1"
        shipments={[shipment]}
        isExternalSales
        isSfCollect={false}
      />,
    );

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('处理中…');
    expect(html).not.toContain('工单状态已经变化');
  });
});
