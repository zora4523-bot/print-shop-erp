import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn() }));
vi.mock('@/actions/order-quote', () => ({ quoteOrderItemsAction: vi.fn() }));
vi.mock('@/actions/order-logistics-quote', () => ({
  quoteExternalOrderChargesAction: vi.fn(),
}));
vi.mock('../PendingDesignImages', () => ({
  PendingDesignImages: () => null,
}));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import { ShipmentCustomerChargeFields } from '../OrderForm';

function registration(name: string) {
  return {
    name,
    onChange: async () => undefined,
    onBlur: async () => undefined,
    ref: () => undefined,
  } as never;
}

function renderFields({
  isSfCollect,
  shippingError,
  packingError,
}: {
  isSfCollect: boolean;
  shippingError?: string;
  packingError?: string;
}) {
  return renderToStaticMarkup(
    <ShipmentCustomerChargeFields
      idPrefix="primary"
      provinceRegistration={registration('destinationProvince')}
      weightRegistration={registration('quotedWeightKg')}
      shippingRegistration={registration('shippingFee')}
      packingRegistration={registration('packingMaterialFee')}
      reasonRegistration={registration('customerChargeOverrideReason')}
      shippingError={shippingError}
      packingError={packingError}
      isSfCollect={isSfCollect}
    />,
  );
}

describe('ShipmentCustomerChargeFields', () => {
  it('disables SF collect province, weight and shipping but leaves packing editable and required', () => {
    const html = renderFields({ isSfCollect: true });

    expect(html).toMatch(/id="primary-province"[^>]*disabled=""/);
    expect(html).toMatch(/id="primary-weight"[^>]*disabled=""/);
    expect(html).toMatch(/id="primary-shipping-fee"[^>]*disabled=""/);
    expect(html).toMatch(
      /id="primary-packing-fee"[^>]*required=""[^>]*aria-required="true"/,
    );
    expect(html).toContain('顺丰到付固定提交 0 元');
    expect(html).toContain('打包耗材仍需单独确认');
  });

  it('marks normal shipping and packing charges required and links field errors', () => {
    const html = renderFields({
      isSfCollect: false,
      shippingError: '请填写对客快递费',
      packingError: '请填写打包耗材费',
    });

    expect(html).toMatch(
      /id="primary-shipping-fee"[^>]*required=""[^>]*aria-required="true"/,
    );
    expect(html).toContain('aria-describedby="primary-shipping-fee-error"');
    expect(html).toContain('id="primary-shipping-fee-error" role="alert"');
    expect(html).toContain('aria-describedby="primary-packing-fee-error"');
    expect(html).toContain('id="primary-packing-fee-error" role="alert"');
  });
});
