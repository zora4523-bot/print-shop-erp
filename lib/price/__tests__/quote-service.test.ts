import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSettlementType } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    product: { findMany: vi.fn() },
    craft: { findMany: vi.fn() },
    priceTier: { findMany: vi.fn() },
    priceAdjustment: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { quoteOrderItems } from '../quote-service';

const item = {
  productId: 'product-1',
  specification: '大号',
  paperType: '艳红珠光纸',
  quantity: 100,
  crafts: ['craft-foil'],
  foilColors: ['哑金'],
  isDoubleSided: false,
  isDoubleColor: false,
};

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock),
    );
  dbMock.product.findMany.mockReset().mockResolvedValue([
    {
      id: 'product-1',
      code: 'EXT-STOCK-LARGE',
      baseUnitPrice: '0.2000',
      minOrderQty: null,
    },
  ]);
  dbMock.craft.findMany.mockReset().mockResolvedValue([
    { id: 'craft-foil', code: 'FLAT_FOIL_SINGLE' },
  ]);
  dbMock.priceTier.findMany.mockReset().mockResolvedValue([
    {
      id: 'tier-1',
      productId: 'product-1',
      minQty: 50,
      unitPrice: '0.1000',
    },
  ]);
  dbMock.priceAdjustment.findMany.mockReset().mockResolvedValue([
    {
      id: 'external-order-fee',
      name: '外部销售每款费',
      adjustmentType: 'PER_ORDER',
      amount: '5.0000',
      triggerCondition: {
        settlementTypes: [OrderSettlementType.EXTERNAL_SALES],
      },
      isActive: true,
    },
  ]);
  dbMock.customerPriceBook.findMany.mockReset().mockResolvedValue([
    {
      id: 'external-book',
      code: 'EXTERNAL_SALES_PROCESSING_202608',
      name: '外部销售加工费（2026-08）',
      version: 1,
      sourceName: '长昆-线下报价表(3)(1).xlsx',
      sourceSha256: 'hash',
    },
  ]);
  dbMock.customerPriceRule.findMany.mockReset().mockResolvedValue([
    {
      id: 'external-base',
      code: 'EXT_STOCK_LARGE_100',
      name: '外部销售基础加工费',
      kind: 'BASE',
      calculationType: 'PER_PIECE',
      amount: '0.1000',
      minQty: 100,
      maxQty: 100,
      triggerCondition: {
        specifications: ['大号'],
        paperTypes: ['艳红珠光纸'],
      },
      exclusiveGroup: null,
      priority: 0,
      blocksAutomaticQuote: false,
      sourceSheet: '烫金',
      sourceRange: 'A3:C16',
      note: null,
      productId: 'product-1',
      category: { code: 'BASE_PRODUCT', name: '基础加工费' },
    },
    {
      id: 'external-order-fee',
      code: 'EXTERNAL_ORDER_FEE',
      name: '外部销售每款费',
      kind: 'ADD_ON',
      calculationType: 'PER_ITEM',
      amount: '5.0000',
      minQty: null,
      maxQty: null,
      triggerCondition: null,
      exclusiveGroup: null,
      priority: 0,
      blocksAutomaticQuote: false,
      sourceSheet: '烫金',
      sourceRange: 'A18:B25',
      note: null,
      productId: null,
      category: { code: 'OTHER', name: '其他' },
    },
  ]);
});

describe('quoteOrderItems', () => {
  it('loads only the active external-sales book and never reads legacy global rules', async () => {
    const now = new Date('2026-08-07T08:00:00.000Z');
    const [quote] = await quoteOrderItems(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      now,
      dbMock as never,
    );

    expect(dbMock.product.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, code: true },
      }),
    );
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementType: OrderSettlementType.EXTERNAL_SALES,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        }),
      }),
    );
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          priceBookId: 'external-book',
          isActive: true,
          category: { isActive: true },
        },
      }),
    );
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    const [lockCall] = dbMock.$executeRaw.mock.calls;
    expect((lockCall?.[0] as TemplateStringsArray).join('?')).toContain(
      'pg_advisory_xact_lock_shared',
    );
    const lockOrder = dbMock.$executeRaw.mock.invocationCallOrder[0]!;
    expect(dbMock.product.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      lockOrder,
    );
    expect(
      dbMock.customerPriceBook.findMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(lockOrder);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(quote).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.1000',
      suggestedFixedFee: '5.00',
      suggestedSubtotal: '15.00',
    });
  });

  it('fails closed without an active external price book and never falls back to legacy rules', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([]);

    const [quote] = await quoteOrderItems(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
    );

    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
    expect(quote).toMatchObject({
      complete: false,
      suggestedUnitPrice: null,
      suggestedFixedFee: null,
      suggestedSubtotal: null,
      snapshot: {
        priceBook: expect.objectContaining({
          code: 'MISSING',
          version: 0,
        }),
      },
    });
    expect(quote?.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('当前没有生效的外部销售价目簿'),
        '报价单未覆盖当前产品、规格、纸张或数量，请联系管理员人工报价',
      ]),
    );
  });

  it('rejects multiple simultaneously active external price books before reading any rules', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      {
        id: 'external-book-v1',
        code: 'EXTERNAL_SALES_PROCESSING_202608',
        name: '外部销售加工费（2026-08）',
        version: 1,
        sourceName: '长昆-线下报价表-v1.xlsx',
        sourceSha256: 'hash-v1',
      },
      {
        id: 'external-book-v2',
        code: 'EXTERNAL_SALES_PROCESSING_202609',
        name: '外部销售加工费（2026-09）',
        version: 2,
        sourceName: '长昆-线下报价表-v2.xlsx',
        sourceSha256: 'hash-v2',
      },
    ]);

    await expect(
      quoteOrderItems(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        new Date('2026-08-07T08:00:00.000Z'),
        dbMock as never,
      ),
    ).rejects.toThrow(
      '同一结算方向同时存在多个生效加工费价目簿，请管理员修正有效期',
    );

    expect(dbMock.product.findMany).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(dbMock.customerPriceRule.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
  });

  it('queries only rules in active charge categories so hidden categories cannot keep charging', async () => {
    await quoteOrderItems(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
    );

    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          priceBookId: 'external-book',
          isActive: true,
          category: { isActive: true },
        },
      }),
    );
  });

  it('does not apply an external-sales adjustment to an internal order', async () => {
    const [quote] = await quoteOrderItems(
      [item],
      OrderSettlementType.INTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
    );

    expect(quote?.suggestedSubtotal).toBe('10.00');
    expect(quote?.components.map((component) => component.sourceId)).toEqual([
      'tier-1',
    ]);
  });

  it('fails closed when a quantity is outside the explicit workbook anchors', async () => {
    const [quote] = await quoteOrderItems(
      [{ ...item, quantity: 101 }],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
    );

    expect(quote?.complete).toBe(false);
    expect(quote?.suggestedSubtotal).toBeNull();
    expect(quote?.errors).toContain(
      '报价单未覆盖当前产品、规格、纸张或数量，请联系管理员人工报价',
    );
  });

  it('opens exactly one short transaction when the preview has no caller transaction', async () => {
    await quoteOrderItems(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
    );

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.product.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.priceTier.findMany).not.toHaveBeenCalled();
    expect(dbMock.priceAdjustment.findMany).not.toHaveBeenCalled();
  });
});
