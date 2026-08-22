import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdjustmentType, Prisma } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    product: { findUnique: vi.fn() },
    priceTier: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    priceAdjustment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createPriceAdjustment,
  createPriceTier,
  getPriceAdjustmentSummary,
  getPriceTierSummary,
  listPriceAdjustments,
  listPriceTiers,
  PriceDictionaryInvariantError,
  setPriceAdjustmentActive,
  updatePriceAdjustment,
  updatePriceTier,
} from '../price';

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock),
    );
  for (const fn of Object.values(dbMock.product)) fn.mockReset();
  for (const fn of Object.values(dbMock.priceTier)) fn.mockReset();
  for (const fn of Object.values(dbMock.priceAdjustment)) fn.mockReset();
});

const makeTier = (over = {}) => ({
  id: 'tier1',
  productId: 'prod1',
  minQty: 1000,
  unitPrice: '0.1200',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  product: {
    id: 'prod1',
    code: 'HB001',
    name: '空白现货',
    isActive: true,
    categoryNode: { name: '空白现货' },
  },
  ...over,
});

const makeAdjustment = (over = {}) => ({
  id: 'adj1',
  name: '烫金加价',
  adjustmentType: AdjustmentType.PER_SHEET,
  amount: '0.0300',
  triggerCondition: { craft: 'foil' },
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('listPriceTiers', () => {
  it('searches product code, product name, and category node name', async () => {
    dbMock.priceTier.findMany.mockResolvedValue([]);
    await listPriceTiers({ q: ' 空白 ' });

    expect(dbMock.priceTier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              product: {
                is: { code: { contains: '空白', mode: 'insensitive' } },
              },
            },
            {
              product: {
                is: { name: { contains: '空白', mode: 'insensitive' } },
              },
            },
            {
              product: {
                is: {
                  categoryNode: {
                    is: { name: { contains: '空白', mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it('sorts searched tiers by relevance after database order', async () => {
    dbMock.priceTier.findMany.mockResolvedValue([
      makeTier({
        id: 'contains',
        product: {
          ...makeTier().product,
          name: '进口空白现货',
          categoryNode: { name: '现货分类' },
        },
      }),
      makeTier({ id: 'exact', product: { ...makeTier().product, name: '空白现货' } }),
    ]);

    const rows = await listPriceTiers({ q: '空白现货' });

    expect(rows.map((row) => row.id)).toEqual(['exact', 'contains']);
  });
});

describe('price tier mutations', () => {
  it('takes the exclusive snapshot lock in the same transaction as the mutation', async () => {
    const txMock = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      product: { findUnique: vi.fn().mockResolvedValue({ id: 'prod1' }) },
      priceTier: { create: vi.fn().mockResolvedValue(makeTier()) },
    };
    dbMock.$transaction.mockImplementationOnce(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );

    await createPriceTier({
      productId: 'prod1',
      minQty: 1000,
      unitPrice: '0.1200',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: null,
    });

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.product.findUnique).not.toHaveBeenCalled();
    expect(dbMock.priceTier.create).not.toHaveBeenCalled();
    expect(txMock.product.findUnique).toHaveBeenCalledTimes(1);
    expect(txMock.priceTier.create).toHaveBeenCalledTimes(1);
    const sql = (txMock.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(
      '?',
    );
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).not.toContain('pg_advisory_xact_lock_shared');
    expect(txMock.priceTier.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      txMock.$executeRaw.mock.invocationCallOrder[0]!,
    );
  });

  it('requires an existing product before create', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    await expect(
      createPriceTier({
        productId: 'missing',
        minQty: 1000,
        unitPrice: '0.1200',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        effectiveTo: null,
      }),
    ).rejects.toBeInstanceOf(PriceDictionaryInvariantError);
    expect(dbMock.priceTier.create).not.toHaveBeenCalled();
  });

  it('creates a tier with effective window data', async () => {
    dbMock.product.findUnique.mockResolvedValue({ id: 'prod1' });
    dbMock.priceTier.create.mockResolvedValue(makeTier());
    await createPriceTier({
      productId: 'prod1',
      minQty: 1000,
      unitPrice: '0.1200',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-06-01T00:00:00Z'),
    });

    expect(dbMock.priceTier.create.mock.calls[0][0].data).toEqual({
      productId: 'prod1',
      minQty: 1000,
      unitPrice: '0.1200',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('throws when updating a missing tier', async () => {
    dbMock.priceTier.findUnique.mockResolvedValue(null);
    await expect(
      updatePriceTier('missing', {
        productId: 'prod1',
        minQty: 1000,
        unitPrice: '0.1200',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        effectiveTo: null,
      }),
    ).rejects.toBeInstanceOf(PriceDictionaryInvariantError);
    expect(dbMock.priceTier.update).not.toHaveBeenCalled();
  });

  it('returns null for missing tier summary', async () => {
    dbMock.priceTier.findUnique.mockResolvedValue(null);
    await expect(getPriceTierSummary('missing')).resolves.toBeNull();
  });
});

describe('price adjustments', () => {
  it('lists active adjustments first', async () => {
    dbMock.priceAdjustment.findMany.mockResolvedValue([]);
    await listPriceAdjustments();
    expect(dbMock.priceAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
    );
  });

  it('writes database NULL when triggerCondition is empty', async () => {
    dbMock.priceAdjustment.create.mockResolvedValue(makeAdjustment({ triggerCondition: null }));
    await createPriceAdjustment({
      name: '普通加价',
      adjustmentType: AdjustmentType.PER_ORDER,
      amount: '10.0000',
      triggerCondition: null,
    });
    expect(dbMock.priceAdjustment.create.mock.calls[0][0].data.triggerCondition).toBe(
      Prisma.DbNull,
    );
  });

  it('updates JSON object triggerCondition', async () => {
    dbMock.priceAdjustment.findUnique.mockResolvedValue({ id: 'adj1' });
    dbMock.priceAdjustment.update.mockResolvedValue(makeAdjustment());
    await updatePriceAdjustment('adj1', {
      name: '烫金加价',
      adjustmentType: AdjustmentType.PER_SHEET,
      amount: '0.0300',
      triggerCondition: { craft: 'foil' },
    });
    expect(dbMock.priceAdjustment.update.mock.calls[0][0].data.triggerCondition).toEqual({
      craft: 'foil',
    });
  });

  it('no-ops active toggle when already matching', async () => {
    const adjustment = makeAdjustment({ isActive: true });
    dbMock.priceAdjustment.findUnique.mockResolvedValue(adjustment);
    const result = await setPriceAdjustmentActive('adj1', true);
    expect(result).toBe(adjustment);
    expect(dbMock.priceAdjustment.update).not.toHaveBeenCalled();
  });

  it('returns null for missing adjustment summary', async () => {
    dbMock.priceAdjustment.findUnique.mockResolvedValue(null);
    await expect(getPriceAdjustmentSummary('missing')).resolves.toBeNull();
  });
});
