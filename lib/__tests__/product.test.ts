import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductCategory } from '../../generated/prisma/client';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  listProducts,
  getProductSummary,
  createProduct,
  updateProduct,
  setProductActive,
  ProductInvariantError,
} from '../product';

beforeEach(() => {
  for (const fn of Object.values(dbMock.product)) fn.mockReset();
});

const makeProduct = (over = {}) => ({
  id: 'p1',
  category: ProductCategory.CUSTOM_FLAT_FOIL,
  name: '专版红包 100x200',
  specification: '100×200',
  paperType: '铜版纸',
  baseUnitPrice: '0.5000',
  minOrderQty: 1000,
  isActive: true,
  createdAt: new Date('2026-04-23T00:00:00Z'),
  updatedAt: new Date('2026-04-23T00:00:00Z'),
  ...over,
});

describe('listProducts', () => {
  it('orders by isActive desc, category asc, name asc', async () => {
    dbMock.product.findMany.mockResolvedValue([]);
    await listProducts();
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      }),
    );
  });
});

describe('createProduct', () => {
  it('forces isActive=true and passes Decimal-compatible string through', async () => {
    dbMock.product.create.mockResolvedValue(makeProduct());
    await createProduct({
      category: ProductCategory.BLANK_STOCK,
      name: '空白红包',
      specification: '通用',
      paperType: null,
      baseUnitPrice: '0.1200',
      minOrderQty: 500,
    });
    const data = dbMock.product.create.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect(data.baseUnitPrice).toBe('0.1200');
    expect(data.minOrderQty).toBe(500);
  });

  it('normalizes omitted minOrderQty to null', async () => {
    dbMock.product.create.mockResolvedValue(makeProduct());
    await createProduct({
      category: ProductCategory.BLANK_STOCK,
      name: '空白红包',
      specification: null,
      paperType: null,
      baseUnitPrice: null,
    });
    const data = dbMock.product.create.mock.calls[0][0].data;
    expect(data.minOrderQty).toBeNull();
    expect(data.baseUnitPrice).toBeNull();
  });
});

describe('updateProduct', () => {
  it('throws when target missing', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    await expect(
      updateProduct('nope', {
        category: ProductCategory.BLANK_STOCK,
        name: 'X',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ProductInvariantError);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('updates all fields', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: false }));
    await updateProduct('p1', {
      category: ProductCategory.COLOR_PRINT,
      name: '改名',
      specification: '新规格',
      paperType: '新纸',
      baseUnitPrice: '1.5000',
      minOrderQty: 2000,
      isActive: false,
    });
    const data = dbMock.product.update.mock.calls[0][0].data;
    expect(data.name).toBe('改名');
    expect(data.isActive).toBe(false);
    expect(data.baseUnitPrice).toBe('1.5000');
  });
});

describe('setProductActive', () => {
  it('no-ops when already matching', async () => {
    const p = makeProduct({ isActive: true });
    dbMock.product.findUnique.mockResolvedValue(p);
    const r = await setProductActive('p1', true);
    expect(r).toBe(p);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('flips isActive when different', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: true }));
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: false }));
    await setProductActive('p1', false);
    expect(dbMock.product.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('throws when target missing', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    await expect(setProductActive('nope', false)).rejects.toBeInstanceOf(
      ProductInvariantError,
    );
  });
});

describe('getProductSummary', () => {
  it('returns null when absent', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    expect(await getProductSummary('nope')).toBeNull();
  });
});
