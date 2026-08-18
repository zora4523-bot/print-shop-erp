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
    customerChargeCategory: { findMany: vi.fn() },
    customerPriceRule: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { getActiveCustomerPriceBookCatalog } from '../customer-price-book';

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) =>
        callback(dbMock),
    );
  dbMock.customerPriceBook.findMany.mockReset().mockResolvedValue([
    {
      id: 'book-1',
      code: 'EXTERNAL_SALES_LOGISTICS_202608',
      name: '外部销售快递与打包耗材价目簿',
      version: 4,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      sourceName: '中通 + 纸箱.xlsx',
      sourceSha256: 'combined-hash',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: null,
      notes: {
        sources: [
          {
            fileName: '长昆中通报价表(1).xlsx',
            sha256: 'express-hash',
            sheet: '中通',
            range: 'A1:D29',
          },
          {
            fileName: '纸箱价格表1(1).xlsx',
            sha256: 'carton-hash',
            sheet: 'Sheet1',
            range: 'A1:B6',
          },
          { fileName: '缺少哈希.xlsx' },
        ],
        warnings: ['超过 5000 个需人工报价。'],
      },
    },
  ]);
  dbMock.customerChargeCategory.findMany.mockReset().mockResolvedValue([
    {
      id: 'shipping-category',
      code: 'SHIPPING_FEE',
      name: '快递费',
      description: null,
      sortOrder: 10,
    },
  ]);
  dbMock.customerPriceRule.findMany.mockReset().mockResolvedValue([
    {
      categoryId: 'shipping-category',
      code: 'ZTO_GUANGDONG',
      name: '中通 · 广东',
      kind: 'ADD_ON',
      calculationType: 'FIXED_AMOUNT',
      amount: '2.8000',
      includedUnits: '1.000',
      incrementUnits: '1.000',
      incrementAmount: '1.5000',
      minQty: null,
      maxQty: null,
      blocksAutomaticQuote: false,
      sourceSheet: '中通',
      sourceRange: 'A3:D3',
      sourceName: '长昆中通报价表(1).xlsx',
      sourceSha256: 'express-hash',
      note: null,
      priority: 100,
      product: null,
    },
  ]);
});

describe('getActiveCustomerPriceBookCatalog', () => {
  it('returns version and audited per-workbook and per-rule sources', async () => {
    const catalog = await getActiveCustomerPriceBookCatalog(
      OrderSettlementType.EXTERNAL_SALES,
      CustomerPriceBookPurpose.LOGISTICS,
      new Date('2026-08-08T00:00:00.000Z'),
    );

    expect(catalog).toMatchObject({
      version: 4,
      source: {
        fileName: '中通 + 纸箱.xlsx',
        sha256: 'combined-hash',
      },
      sources: [
        {
          fileName: '长昆中通报价表(1).xlsx',
          sha256: 'express-hash',
          sheet: '中通',
          range: 'A1:D29',
        },
        {
          fileName: '纸箱价格表1(1).xlsx',
          sha256: 'carton-hash',
          sheet: 'Sheet1',
          range: 'A1:B6',
        },
      ],
      categories: [
        {
          items: [
            {
              source: {
                fileName: '长昆中通报价表(1).xlsx',
                sha256: 'express-hash',
                sheet: '中通',
                range: 'A3:D3',
              },
            },
          ],
        },
      ],
    });
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ version: true }),
      }),
    );
    expect(dbMock.customerPriceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          sourceName: true,
          sourceSha256: true,
        }),
      }),
    );
  });
});
