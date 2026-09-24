import { describe, expect, it, vi } from 'vitest';
import type { CreateOrderInput } from '@/lib/auth/schemas';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn(),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ deleteOrderItemDesignAction: vi.fn() }));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import {
  quoteFactsKey,
  removeOrderItemRelations,
} from '../OrderForm';

function shipment(
  itemQuantities: number[],
): CreateOrderInput['additionalShipments'][number] {
  return {
    receiverName: null,
    receiverPhone: null,
    receiverAddress: '广东省佛山市测试地址',
    expressCode: null,
    destinationProvince: '广东',
    quotedWeightKg: null,
    shippingFee: null,
    packingMaterialFee: null,
    customerChargeOverrideReason: null,
    itemQuantities,
  };
}

describe('OrderForm item removal invariants', () => {
  it('normalizes each remaining packaging group and removes empty shipments', () => {
    const result = removeOrderItemRelations({
      index: 0,
      remainingItemCount: 2,
      additionalShipments: [
        shipment([5, 0, 0]),
        shipment([0, 4, 3]),
      ],
      packagingGroups: [
        {
          name: '混装 A+B',
          mode: 'MIXED_STYLE',
          actualBagCount: 10,
          itemUnitsPerBag: [5, 5, 0],
        },
        {
          name: '单装 C',
          mode: 'SINGLE_STYLE',
          actualBagCount: 10,
          itemUnitsPerBag: [0, 0, 10],
        },
      ],
      usesExternalSalesPricing: true,
    });

    expect(result.additionalShipments).toEqual([
      expect.objectContaining({ itemQuantities: [4, 3] }),
    ]);
    expect(result.packagingGroups).toEqual([
      expect.objectContaining({
        name: '混装 A+B',
        mode: 'SINGLE_STYLE',
        itemUnitsPerBag: [5, 0],
      }),
      expect.objectContaining({
        name: '单装 C',
        mode: 'SINGLE_STYLE',
        itemUnitsPerBag: [0, 10],
      }),
    ]);
  });

  it('recreates the required external single-style group after deleting the only referenced group', () => {
    const result = removeOrderItemRelations({
      index: 0,
      remainingItemCount: 1,
      additionalShipments: [],
      packagingGroups: [
        {
          name: null,
          mode: 'SINGLE_STYLE',
          actualBagCount: 100,
          itemUnitsPerBag: [10, 0],
        },
      ],
      usesExternalSalesPricing: true,
    });

    expect(result.packagingGroups).toEqual([
      {
        name: null,
        mode: 'SINGLE_STYLE',
        actualBagCount: 100,
        itemUnitsPerBag: [10],
      },
    ]);
  });

  it('treats order item count as an authoritative quote identity fact', () => {
    const item = {
      productId: 'product-1',
      quantity: 1_000,
      crafts: ['craft-1'],
    };

    expect(quoteFactsKey(item, 1)).not.toBe(quoteFactsKey(item, 2));
    expect(JSON.parse(quoteFactsKey(item, 2))).toMatchObject({
      orderItemCount: 2,
      productId: 'product-1',
      quantity: 1_000,
    });
  });
});
