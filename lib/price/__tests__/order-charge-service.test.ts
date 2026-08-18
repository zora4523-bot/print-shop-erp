import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    customerPriceBook: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  quoteExternalOrderChargesPreview,
  resolveExternalOrderChargesForFinalization,
} from '../order-charge-service';

const now = new Date('2026-08-08T00:00:00.000Z');
const input = {
  isSfCollect: false,
  shipments: [
    {
      shipmentKey: '1',
      province: '广东',
      billableWeightKg: '1',
      itemQuantity: 1_000,
    },
  ],
};

function activeBook({
  version,
  shippingFee,
  packingFee,
}: {
  version: number;
  shippingFee: string;
  packingFee: string;
}) {
  return {
    id: `logistics-book-${version}`,
    code: `EXTERNAL_LOGISTICS_V${version}`,
    name: `外部销售物流价目簿 v${version}`,
    version,
    sourceName: '物流价目簿.xlsx',
    sourceSha256: `hash-${version}`,
    rules: [
      {
        id: `shipping-rule-${version}`,
        code: 'ZTO_GUANGDONG',
        amount: shippingFee,
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: '1.50',
        minQty: null,
        maxQty: null,
        triggerCondition: { carrierCode: 'ZTO', provinces: ['广东'] },
        sourceSheet: '中通',
        sourceRange: 'A3:D3',
        sourceName: '物流价目簿.xlsx',
        sourceSha256: `hash-${version}`,
        blocksAutomaticQuote: false,
        category: { id: 'shipping-category', code: 'SHIPPING_FEE' },
      },
      {
        id: `packing-rule-${version}`,
        code: 'CARTON_Q501_1000',
        amount: packingFee,
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        minQty: 501,
        maxQty: 1_000,
        triggerCondition: null,
        sourceSheet: 'Sheet1',
        sourceRange: 'A3:B3',
        sourceName: '纸箱价格表.xlsx',
        sourceSha256: `hash-${version}`,
        blocksAutomaticQuote: true,
        category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
      },
    ],
  };
}

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) =>
        callback(dbMock),
    );
  dbMock.customerPriceBook.findMany
    .mockReset()
    .mockResolvedValue([
      activeBook({ version: 1, shippingFee: '2.80', packingFee: '3.00' }),
    ]);
});

describe('quoteExternalOrderChargesPreview', () => {
  it('reads the current active LOGISTICS book under one snapshot transaction', async () => {
    const quote = await quoteExternalOrderChargesPreview(input, now);

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith({
      where: {
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: expect.any(Object),
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 2,
    });
    expect(
      dbMock.customerPriceBook.findMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(dbMock.$executeRaw.mock.invocationCallOrder[0]!);
    expect(quote).toMatchObject({
      complete: true,
      suggestedShippingTotal: '2.80',
      suggestedPackagingTotal: '3.00',
      suggestedTotal: '5.80',
    });
  });

  it('uses an updated active price book on the next request, not bundled defaults', async () => {
    const beforeUpdate = await quoteExternalOrderChargesPreview(input, now);
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({ version: 2, shippingFee: '6.60', packingFee: '4.50' }),
    ]);

    const afterUpdate = await quoteExternalOrderChargesPreview(
      input,
      new Date('2026-08-09T00:00:00.000Z'),
    );

    expect(beforeUpdate.suggestedTotal).toBe('5.80');
    expect(afterUpdate).toMatchObject({
      complete: true,
      suggestedShippingTotal: '6.60',
      suggestedPackagingTotal: '4.50',
      suggestedTotal: '11.10',
    });
    expect(afterUpdate.shipments[0]?.shipping.source?.sha256).toBe('hash-2');
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
  });

  it('filters disabled rules and categories when reloading a frozen book', async () => {
    await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: '1',
            province: '广东',
            billableWeightKg: '1',
            itemQuantity: 1_000,
            shippingFee: null,
            packingMaterialFee: '3.00',
            overrideReason: null,
          },
        ],
      },
      'logistics-book-1',
      now,
    );

    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          settlementType: OrderSettlementType.EXTERNAL_SALES,
          purpose: CustomerPriceBookPurpose.LOGISTICS,
          id: 'logistics-book-1',
        },
        select: expect.objectContaining({
          rules: expect.objectContaining({
            where: {
              isActive: true,
              category: {
                isActive: true,
                code: { in: ['SHIPPING_FEE', 'PACKING_MATERIAL'] },
              },
            },
          }),
        }),
      }),
    );
  });

  it('fails closed when no active LOGISTICS book exists', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([]);

    await expect(
      quoteExternalOrderChargesPreview(input, now),
    ).rejects.toThrow(
      '当前没有生效的外部销售快递/耗材价目簿，请联系管理员',
    );
  });

  it('fails closed when multiple LOGISTICS books overlap', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({ version: 1, shippingFee: '2.80', packingFee: '3.00' }),
      activeBook({ version: 2, shippingFee: '6.60', packingFee: '4.50' }),
    ]);

    await expect(
      quoteExternalOrderChargesPreview(input, now),
    ).rejects.toThrow(
      '同时存在多个生效的外部销售快递/耗材价目簿，请管理员修正有效期',
    );
  });

  it('fails closed on a zero weight increment instead of undercharging', async () => {
    const malformed = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    malformed.rules[0]!.incrementUnits = '0';
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([malformed]);

    await expect(
      quoteExternalOrderChargesPreview(input, now),
    ).rejects.toThrow('物流价目簿规则续重单位必须大于 0');
  });

  it('fails closed when a packaging suggestion exceeds the money column', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({
        version: 1,
        shippingFee: '2.80',
        packingFee: '10000000000.00',
      }),
    ]);

    const quote = await quoteExternalOrderChargesPreview(input, now);

    expect(quote.complete).toBe(false);
    expect(quote.shipments[0]?.packaging.amount).toBeNull();
    expect(quote.errors).toContain(
      '发货记录 1·打包耗材费：纸箱费建议超过系统可保存上限，请管理员修正价目簿',
    );
  });
});
