import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
  OrderSettlementType,
  Role,
} from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const { requirePermissionMock, quoteOrderItemsPreviewMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  quoteOrderItemsPreviewMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/price/quote-service', () => ({
  quoteOrderItemsPreview: quoteOrderItemsPreviewMock,
}));

import { quoteOrderItemsAction } from '../order-quote';

const validInput = {
  items: [
    {
      productId: 'product-1',
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      artworkVersion: null,
      plateGroupId: null,
      pricingGroup: null,
      manualQuoteReason: null,
      specification: '大号',
      actualWidthMm: 210,
      actualHeightMm: 105,
      paperType: '艳红珠光纸',
      paperWeightGsm: 160,
      quantity: 1_000,
      crafts: ['craft-foil'],
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
};

beforeEach(() => {
  requirePermissionMock.mockReset();
  quoteOrderItemsPreviewMock.mockReset();
});

describe('quoteOrderItemsAction', () => {
  it('checks order:create before parsing or reading price rules', async () => {
    requirePermissionMock.mockRejectedValue(new UnauthorizedError('未登录'));

    await expect(quoteOrderItemsAction({ items: [] })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(requirePermissionMock).toHaveBeenCalledWith('order:create');
    expect(quoteOrderItemsPreviewMock).not.toHaveBeenCalled();
  });

  it('maps external sales to its receivable settlement rule scope', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderItemsPreviewMock.mockResolvedValue([]);

    const result = await quoteOrderItemsAction(validInput);

    expect(result).toEqual({ status: 'success', items: [] });
    expect(quoteOrderItemsPreviewMock).toHaveBeenCalledWith(
      validInput.items,
      OrderSettlementType.EXTERNAL_SALES,
      1,
    );
  });

  it('preserves the full form item count when previewing one completed line', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteOrderItemsPreviewMock.mockResolvedValue([]);

    const result = await quoteOrderItemsAction({
      ...validInput,
      orderItemCount: 3,
    });

    expect(result).toEqual({ status: 'success', items: [] });
    expect(quoteOrderItemsPreviewMock).toHaveBeenCalledWith(
      validInput.items,
      OrderSettlementType.EXTERNAL_SALES,
      3,
    );
  });

  it('rejects invalid quantities before reading the dictionary', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'owner-1', role: Role.ADMIN });

    const result = await quoteOrderItemsAction({
      items: [{ ...validInput.items[0], quantity: 0 }],
    });

    expect(result.status).toBe('invalid');
    expect(quoteOrderItemsPreviewMock).not.toHaveBeenCalled();
  });
});
