import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSettlementType } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    product: { findMany: vi.fn() },
    craft: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    priceTier: { findMany: vi.fn() },
    priceAdjustment: { findMany: vi.fn() },
    customerPriceBook: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { quoteOrderItems, quoteOrderItemsPreview } from '../quote-service';

const item = {
  productId: 'product-1',
  pricingRoute: 'STOCK_BLANK' as const,
  productStructure: 'STANDARD_ENVELOPE' as const,
  artworkVersion: null,
  plateGroupId: null,
  pricingGroup: null,
  manualQuoteReason: null,
  specification: '大号',
  actualWidthMm: null,
  actualHeightMm: null,
  paperType: '艳红珠光纸',
  paperWeightGsm: null,
  quantity: 100,
  crafts: ['craft-foil'],
  foilColors: ['哑金'],
  foilTechnique: 'FLAT' as const,
  hasLocalFoil: true,
  lamination: 'NONE' as const,
  printColors: [],
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
      category: 'BLANK_STOCK',
      baseUnitPrice: '0.2000',
      minOrderQty: null,
    },
  ]);
  dbMock.craft.findMany.mockReset().mockResolvedValue([
    { id: 'craft-foil', code: 'FLAT_FOIL_PARTIAL' },
  ]);
  dbMock.material.findMany.mockReset().mockResolvedValue([
    { name: '艳红珠光纸' },
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
      currency: 'CNY',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
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
        pricingRoutes: ['STOCK_BLANK'],
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
        select: {
          id: true,
          code: true,
          category: true,
          specification: true,
          paperType: true,
        },
      }),
    );
    expect(dbMock.material.findMany).toHaveBeenCalledWith({
      where: {
        category: 'PAPER',
        name: { in: ['艳红珠光纸'] },
        isActive: true,
      },
      select: { name: true },
    });
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
          NOT: {
            triggerCondition: {
              path: ['target'],
              equals: 'PACKAGING_GROUP',
            },
          },
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
      snapshot: {
        quotedAt: now.toISOString(),
        input: { lamination: 'NONE' },
        priceBook: {
          currency: 'CNY',
          effectiveFrom: '2026-08-01T00:00:00.000Z',
          version: 1,
        },
      },
    });
  });

  it('loads stable product and craft codes for explicitly authorized historical repricing', async () => {
    dbMock.product.findMany.mockResolvedValueOnce([
      {
        id: 'product-1',
        code: 'EXT-STOCK-LARGE',
        category: 'STOCK_FOIL_ADD',
        isActive: false,
      },
    ]);
    dbMock.craft.findMany.mockResolvedValueOnce([
      {
        id: 'craft-foil',
        code: 'FLAT_FOIL_PARTIAL',
        isActive: false,
      },
    ]);

    const [quote] = await quoteOrderItems(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
      { allowInactiveCatalogFacts: true },
    );

    expect(dbMock.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['product-1'] } },
      select: {
        id: true,
        code: true,
        category: true,
        specification: true,
        paperType: true,
      },
    });
    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['craft-foil'] } },
      select: { id: true, code: true },
    });
    expect(dbMock.material.findMany).toHaveBeenCalledWith({
      where: {
        category: 'PAPER',
        name: { in: ['艳红珠光纸'] },
      },
      select: { name: true },
    });
    expect(quote?.snapshot.input).toMatchObject({
      productCode: 'EXT-STOCK-LARGE',
      craftCodes: ['FLAT_FOIL_PARTIAL'],
    });
    expect(quote?.complete).toBe(true);
  });

  it('keeps new-order quoting closed to a deactivated product', async () => {
    dbMock.product.findMany.mockResolvedValueOnce([]);

    await expect(
      quoteOrderItems(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        new Date('2026-08-07T08:00:00.000Z'),
        dbMock as never,
      ),
    ).rejects.toThrow('报价产品字典已变化');

    expect(dbMock.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['product-1'] }, isActive: true },
      select: {
        id: true,
        code: true,
        category: true,
        specification: true,
        paperType: true,
      },
    });
  });

  it('rejects a product whose category does not belong to the selected route', async () => {
    dbMock.product.findMany.mockResolvedValueOnce([
      {
        id: 'product-1',
        code: 'EXT-CUSTOM-FOIL-LARGE',
        category: 'CUSTOM_FLAT_FOIL',
      },
    ]);

    await expect(
      quoteOrderItemsPreview(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('分类与计价路线“局部烫金（通版现货）”不一致');
  });

  it('does not accept the retired stock-foil product category in a new preview', async () => {
    dbMock.product.findMany.mockResolvedValueOnce([
      {
        id: 'product-1',
        code: 'EXT-LEGACY-STOCK-FOIL',
        category: 'STOCK_FOIL_ADD',
      },
    ]);

    await expect(
      quoteOrderItemsPreview(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('分类与计价路线');
  });

  it('rejects a stock preview that omits the canonical local-foil craft', async () => {
    dbMock.craft.findMany.mockResolvedValueOnce([
      { id: 'craft-foil', code: 'PACKING' },
    ]);

    await expect(
      quoteOrderItemsPreview(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('必须包含“局部烫金”生产工艺');
  });

  it('rejects custom and color routes that omit their production operation', async () => {
    dbMock.product.findMany
      .mockResolvedValueOnce([
        {
          id: 'product-1',
          code: 'EXT-CUSTOM-LARGE',
          category: 'CUSTOM_FLAT_FOIL',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'product-1',
          code: 'EXT-COLOR-LARGE',
          category: 'COLOR_PRINT',
        },
      ]);
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-foil', code: 'PACKING' },
    ]);

    await expect(
      quoteOrderItemsPreview(
        [
          {
            ...item,
            pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
            foilColors: ['哑金'],
          },
        ],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('必须包含“专版单色平烫”生产工艺');

    await expect(
      quoteOrderItemsPreview(
        [
          {
            ...item,
            pricingRoute: 'COLOR_PRINT',
            foilColors: [],
            foilTechnique: 'NONE',
            hasLocalFoil: false,
            printColors: ['C', 'M', 'Y', 'K'],
          },
        ],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('必须包含“彩印”生产工艺');
  });

  it('keeps ordinary previews closed to a deactivated craft', async () => {
    dbMock.craft.findMany.mockResolvedValueOnce([]);

    await expect(
      quoteOrderItemsPreview(
        [item],
        OrderSettlementType.EXTERNAL_SALES,
        1,
        new Date('2026-08-07T08:00:00.000Z'),
      ),
    ).rejects.toThrow('工艺字典已变化');

    expect(dbMock.craft.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['craft-foil'] }, isActive: true },
      select: { id: true, code: true },
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
        expect.stringContaining('当前没有生效的客户价目簿'),
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
          NOT: {
            triggerCondition: {
              path: ['target'],
              equals: 'PACKAGING_GROUP',
            },
          },
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

  it('marks a custom paper as pending administrator final pricing', async () => {
    dbMock.material.findMany.mockResolvedValueOnce([]);

    const [quote] = await quoteOrderItems(
      [{ ...item, paperType: '客户自带特种纸' }],
      OrderSettlementType.EXTERNAL_SALES,
      new Date('2026-08-07T08:00:00.000Z'),
      dbMock as never,
    );

    expect(quote?.complete).toBe(false);
    expect(quote?.suggestedSubtotal).toBeNull();
    expect(quote?.errors).toContain(
      '自定义纸张或纸张已不在有效字典，需管理员填写终价',
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
