import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  requirePermissionMock,
  quoteExternalOrderChargesPreviewMock,
  OrderCustomerChargeErrorMock,
} =
  vi.hoisted(() => ({
    requirePermissionMock: vi.fn(),
    quoteExternalOrderChargesPreviewMock: vi.fn(),
    OrderCustomerChargeErrorMock: class OrderCustomerChargeError extends Error {},
  }));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/price/order-charge-service', () => ({
  OrderCustomerChargeError: OrderCustomerChargeErrorMock,
  quoteExternalOrderChargesPreview: quoteExternalOrderChargesPreviewMock,
}));

import { quoteExternalOrderChargesAction } from '../order-logistics-quote';

const validInput = {
  isSfCollect: false,
  shipments: [
    {
      shipmentKey: '1',
      province: '广东',
      billableWeightKg: '2',
      itemQuantity: 1_000,
    },
  ],
};

const sanitizedExternalSalesInput = {
  ...validInput,
  shipments: validInput.shipments.map((shipment) => ({
    ...shipment,
    billableWeightKg: null,
  })),
};

const quote = {
  complete: true,
  suggestedShippingTotal: '4.30',
  suggestedPackagingTotal: '3.00',
  suggestedTotal: '7.30',
  shipments: [],
  components: [],
  errors: [],
  snapshot: {
    version: 1 as const,
    input: validInput,
    suggestedShippingTotal: '4.30',
    suggestedPackagingTotal: '3.00',
    suggestedTotal: '7.30',
    components: [],
    complete: true,
    errors: [],
  },
};

beforeEach(() => {
  requirePermissionMock.mockReset();
  quoteExternalOrderChargesPreviewMock.mockReset();
});

describe('quoteExternalOrderChargesAction', () => {
  it('checks order:create before parsing or reading the logistics book', async () => {
    requirePermissionMock.mockRejectedValue(new UnauthorizedError('未登录'));

    await expect(quoteExternalOrderChargesAction({ shipments: [] })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(requirePermissionMock).toHaveBeenCalledWith('order:create');
    expect(quoteExternalOrderChargesPreviewMock).not.toHaveBeenCalled();
  });

  it('rejects non-external settlement roles without reading logistics rules', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });

    const result = await quoteExternalOrderChargesAction(validInput);

    expect(result).toEqual({
      status: 'error',
      message: '当前账号不使用外部销售结算，无需计算对外快递与耗材费',
    });
    expect(quoteExternalOrderChargesPreviewMock).not.toHaveBeenCalled();
  });

  it('rejects invalid shipment facts before reading the logistics book', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

    const result = await quoteExternalOrderChargesAction({
      ...validInput,
      shipments: [{ ...validInput.shipments[0], itemQuantity: 0 }],
    });

    expect(result.status).toBe('invalid');
    expect(quoteExternalOrderChargesPreviewMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: '重复发货标识',
      raw: {
        ...validInput,
        shipments: [validInput.shipments[0], validInput.shipments[0]],
      },
    },
    {
      label: '超过 10 个地址',
      raw: {
        ...validInput,
        shipments: Array.from({ length: 11 }, (_, index) => ({
          ...validInput.shipments[0],
          shipmentKey: String(index + 1),
        })),
      },
    },
    {
      label: '伪造非布尔顺丰标识',
      raw: { ...validInput, isSfCollect: 'false' },
    },
  ])('rejects $label before reading the logistics book', async ({ raw }) => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });

    const result = await quoteExternalOrderChargesAction(raw);

    expect(result.status).toBe('invalid');
    expect(quoteExternalOrderChargesPreviewMock).not.toHaveBeenCalled();
  });

  it('strips forged prices, rules, and price-book ids before the service call', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockResolvedValue(quote);

    await quoteExternalOrderChargesAction({
      ...validInput,
      priceBookId: 'attacker-book',
      rules: [{ amount: '0.01' }],
      suggestedTotal: '0.01',
      shipments: [
        {
          ...validInput.shipments[0],
          shippingFee: '0.01',
          packingMaterialFee: '0.01',
        },
      ],
    });

    expect(quoteExternalOrderChargesPreviewMock).toHaveBeenCalledWith(
      sanitizedExternalSalesInput,
    );
  });

  it('returns only the server-calculated quote for an external salesperson', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockResolvedValue(quote);

    const result = await quoteExternalOrderChargesAction(validInput);

    expect(result).toEqual({ status: 'success', quote });
    expect(quoteExternalOrderChargesPreviewMock).toHaveBeenCalledWith(
      sanitizedExternalSalesInput,
    );
  });

  it('ignores a browser-supplied carrier weight and leaves freight pending', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    const pendingWeightQuote = {
      ...quote,
      complete: false,
      suggestedShippingTotal: null,
      suggestedTotal: null,
      errors: ['发货 1：缺少承运商计费重量，快递费待管理员确认'],
    };
    quoteExternalOrderChargesPreviewMock.mockResolvedValue(pendingWeightQuote);

    const result = await quoteExternalOrderChargesAction({
      isSfCollect: false,
      items: [
        {
          itemKey: '1',
          quantity: 1_000,
          paperWeightGsm: 200,
          paperType: '200g触感纸',
          productStructure: 'STANDARD_ENVELOPE',
        },
      ],
      shipments: [
        {
          shipmentKey: '1',
          province: '广东',
          billableWeightKg: '12.5',
          itemQuantity: 1_000,
          itemQuantities: [1_000],
        },
      ],
    });

    expect(result).toEqual({ status: 'success', quote: pendingWeightQuote });

    expect(quoteExternalOrderChargesPreviewMock).toHaveBeenCalledWith({
      isSfCollect: false,
      shipments: [
        {
          shipmentKey: '1',
          province: '广东',
          billableWeightKg: null,
          itemQuantity: 1_000,
        },
      ],
    });
  });

  it('accepts the legal aggregate quantity of all 50 order lines', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockResolvedValue(quote);
    const largeInput = {
      ...validInput,
      shipments: [
        {
          ...validInput.shipments[0],
          itemQuantity: 50 * 9_999_999,
        },
      ],
    };

    const result = await quoteExternalOrderChargesAction(largeInput);

    expect(result.status).toBe('success');
    expect(quoteExternalOrderChargesPreviewMock).toHaveBeenCalledWith(
      {
        ...largeInput,
        shipments: largeInput.shipments.map((shipment) => ({
          ...shipment,
          billableWeightKg: null,
        })),
      },
    );
  });

  it('fails closed when the current logistics price book cannot be loaded', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockRejectedValue(
      new OrderCustomerChargeErrorMock(
        '当前没有生效的外部销售快递/耗材价目簿，请联系管理员',
      ),
    );

    const result = await quoteExternalOrderChargesAction(validInput);

    expect(result).toEqual({
      status: 'error',
      message:
        '物流报价失败：当前没有生效的外部销售快递/耗材价目簿，请联系管理员',
    });
  });

  it('屏蔽领域错误中的内部规则编号', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockRejectedValue(
      new OrderCustomerChargeErrorMock(
        '收费规则 REF_ZTO_GUANGDONG 缺少 SHIPPING_FEE 类目',
      ),
    );

    const result = await quoteExternalOrderChargesAction(validInput);

    expect(result).toEqual({
      status: 'error',
      message: '物流报价失败：物流价目簿配置异常，请联系管理员',
    });
    expect(JSON.stringify(result)).not.toContain('REF_ZTO_GUANGDONG');
    expect(JSON.stringify(result)).not.toContain('SHIPPING_FEE');
  });

  it('does not disclose unexpected database errors to the browser', async () => {
    requirePermissionMock.mockResolvedValue({ id: 'sales-1', role: Role.SALES });
    quoteExternalOrderChargesPreviewMock.mockRejectedValue(
      new Error('postgres password leaked in transport error'),
    );

    const result = await quoteExternalOrderChargesAction(validInput);

    expect(result).toEqual({
      status: 'error',
      message: '物流报价失败，请稍后重试',
    });
  });
});
