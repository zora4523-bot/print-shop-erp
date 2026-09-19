import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderSettlementType,
  Role,
} from '../../generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  quoteInternalCreateOrder: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/order/create-order-quote-service', () => ({
  CreateOrderQuoteError: class CreateOrderQuoteError extends Error {},
  quoteExternalCreateOrder: vi.fn(),
  quoteInternalCreateOrder: mocks.quoteInternalCreateOrder,
}));

import { quoteInternalCreateOrderAction } from '../create-order-quote';

const raw = {
  factsKey: 'internal-v1',
  settlementType: OrderSettlementType.INTERNAL_SALES,
  items: [
    {
      productId: null,
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      productStructure: OrderProductStructure.UNSPECIFIED,
      artworkVersion: null,
      plateGroupId: null,
      pricingGroup: null,
      manualQuoteReason: '客供纸与特殊工艺',
      specification: null,
      actualWidthMm: null,
      actualHeightMm: null,
      paperType: null,
      paperWeightGsm: null,
      quantity: 500,
      crafts: [],
      frontFoilColors: ['哑金'],
      backFoilColors: [],
      foilColors: ['哑金'],
      foilTechnique: OrderFoilTechnique.FLAT,
      hasLocalFoil: false,
      lamination: OrderLamination.NONE,
      printColors: [],
      isDoubleSided: false,
      isDoubleColor: false,
    },
  ],
  orderItemCount: 1,
  packagingGroups: [
    {
      groupKey: 'bag-1',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 50,
      itemUnitsPerBag: [10],
    },
  ],
  logistics: {
    isSfCollect: false,
    shipments: [{ shipmentKey: '1', province: '上海', billableWeightKg: null, itemQuantity: 500, itemQuantities: [500] }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({
    id: 'cs-1',
    role: Role.CUSTOMER_SERVICE,
  });
  mocks.quoteInternalCreateOrder.mockResolvedValue({
    factsKey: raw.factsKey,
    total: null,
  });
});

describe('quoteInternalCreateOrderAction', () => {
  it('accepts one non-empty configuration-outside note for internal pricing', async () => {
    const result = await quoteInternalCreateOrderAction(raw);

    expect(result).toEqual({
      status: 'success',
      quote: { factsKey: 'internal-v1', total: null },
    });
    expect(mocks.quoteInternalCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementType: OrderSettlementType.INTERNAL_SALES,
        items: [
          expect.objectContaining({
            manualQuoteReason: '客供纸与特殊工艺',
            productId: null,
            crafts: [],
          }),
        ],
        logistics: expect.objectContaining({
          isSfCollect: false,
          shipments: [expect.objectContaining({ shipmentKey: '1', province: '上海', itemQuantities: [500] })],
        }),
      }),
    );
  });

  it('rejects a request without logistics facts: internal delivery is priced like external sales', async () => {
    const { logistics: _logistics, ...withoutLogistics } = raw;
    const result = await quoteInternalCreateOrderAction(withoutLogistics);
    expect(result).toMatchObject({ status: 'invalid' });
    expect(mocks.quoteInternalCreateOrder).not.toHaveBeenCalled();
  });

  it('rejects an empty note when the configuration facts are absent', async () => {
    const result = await quoteInternalCreateOrderAction({
      ...raw,
      items: [{ ...raw.items[0], manualQuoteReason: '   ' }],
    });

    expect(result).toMatchObject({ status: 'invalid' });
    expect(mocks.quoteInternalCreateOrder).not.toHaveBeenCalled();
  });

  it('rejects a settlement direction that does not match the actor', async () => {
    const result = await quoteInternalCreateOrderAction({
      ...raw,
      settlementType: OrderSettlementType.FACTORY_DIRECT,
    });

    expect(result).toMatchObject({ status: 'invalid' });
    expect(mocks.quoteInternalCreateOrder).not.toHaveBeenCalled();
  });
});
