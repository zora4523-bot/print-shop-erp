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
import { UnauthorizedError } from '../../lib/auth/errors';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  quoteExternalCreateOrder: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/order/create-order-quote-service', () => ({
  CreateOrderQuoteError: class CreateOrderQuoteError extends Error {},
  quoteExternalCreateOrder: mocks.quoteExternalCreateOrder,
}));

import { quoteExternalCreateOrderAction } from '../create-order-quote';

const validRaw = {
  factsKey: 'facts-v1',
  settlementType: OrderSettlementType.EXTERNAL_SALES,
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
      paperType: '160g触感纸',
      paperWeightGsm: 160,
      quantity: 2_000,
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
  orderItemCount: 1,
  packagingGroups: [
    {
      groupKey: 'bag-1',
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 20,
    },
  ],
  logistics: {
    isSfCollect: false,
    shipments: [
      {
        shipmentKey: 'shipment-1',
        province: '上海',
        billableWeightKg: '1',
        itemQuantity: 2_000,
        itemQuantities: [2_000],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
  mocks.quoteExternalCreateOrder.mockResolvedValue({
    factsKey: validRaw.factsKey,
    quoteToken: 'create-order-quote-v1:test',
  });
});

describe('quoteExternalCreateOrderAction', () => {
  it('在解析与读价目前检查 order:create 权限', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new UnauthorizedError('未登录'));

    await expect(quoteExternalCreateOrderAction({})).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith('order:create');
    expect(mocks.quoteExternalCreateOrder).not.toHaveBeenCalled();
  });

  it('仅允许外部销售账号调用', async () => {
    mocks.requirePermission.mockResolvedValueOnce({
      id: 'admin-1',
      role: Role.ADMIN,
    });

    const result = await quoteExternalCreateOrderAction(validRaw);

    expect(result).toEqual({
      status: 'error',
      message: '当前账号不使用外部销售结算',
    });
    expect(mocks.quoteExternalCreateOrder).not.toHaveBeenCalled();
  });

  it('分别校验款式、包装与物流，无效请求不进入报价服务', async () => {
    const result = await quoteExternalCreateOrderAction({
      ...validRaw,
      factsKey: '',
      orderItemCount: undefined,
      items: [{ ...validRaw.items[0], quantity: 0 }],
      packagingGroups: [],
      logistics: { isSfCollect: false, shipments: [] },
    });

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(Object.keys(result.fieldErrors)).toEqual(
        expect.arrayContaining([
          'factsKey',
          'orderItemCount',
          'items.0.quantity',
          'packagingGroups',
        ]),
      );
    }
    expect(mocks.quoteExternalCreateOrder).not.toHaveBeenCalled();
  });

  it('忽略物流里伪造的 items，用同一款式事实验证分配并调用统一服务', async () => {
    const result = await quoteExternalCreateOrderAction({
      ...validRaw,
      logistics: {
        ...validRaw.logistics,
        items: [
          {
            quantity: 1,
            paperWeightGsm: 1,
            productStructure: OrderProductStructure.UNSPECIFIED,
          },
        ],
      },
    });

    expect(result).toEqual({
      status: 'success',
      quote: {
        factsKey: validRaw.factsKey,
        quoteToken: 'create-order-quote-v1:test',
      },
    });
    expect(mocks.quoteExternalCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        factsKey: validRaw.factsKey,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        orderItemCount: 1,
        logistics: expect.objectContaining({
          items: [
            expect.objectContaining({
              quantity: 2_000,
              paperWeightGsm: 160,
            }),
          ],
        }),
      }),
    );
  });

  it('不向浏览器泄露非业务异常文案', async () => {
    mocks.quoteExternalCreateOrder.mockRejectedValueOnce(
      new Error('P2025 SQL connection failed'),
    );

    const result = await quoteExternalCreateOrderAction(validRaw);

    expect(result).toEqual({
      status: 'error',
      message: '报价失败，请检查价目配置后重试',
    });
  });
});
