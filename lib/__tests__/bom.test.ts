import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    product: { findUnique: vi.fn() },
    productCategoryNode: { findUnique: vi.fn() },
    material: { findMany: vi.fn() },
    billOfMaterial: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  BomInvariantError,
  createBom,
  estimateMaterialUsageForOrderItems,
  listBomsPage,
  setBomActive,
} from '../bom';

const now = new Date('2026-06-29T00:00:00Z');

const makeBom = (over = {}) => ({
  id: 'bom1',
  productId: 'prod1',
  categoryNodeId: null,
  name: '红包标准 BOM',
  version: 1,
  baseQuantity: 1000,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  product: {
    id: 'prod1',
    code: 'P001',
    name: '标准红包',
    isActive: true,
    categoryNode: { id: 'cat1', name: '红包', isActive: true },
  },
  categoryNode: null,
  items: [
    {
      id: 'bomi1',
      bomId: 'bom1',
      materialId: 'mat1',
      quantity: '500.0000',
      sortOrder: 10,
      remark: null,
      createdAt: now,
      updatedAt: now,
      material: {
        id: 'mat1',
        code: 'PAPER',
        name: '纸张',
        unit: '张',
        isActive: true,
      },
    },
  ],
  ...over,
});

beforeEach(() => {
  dbMock.product.findUnique.mockReset();
  dbMock.productCategoryNode.findUnique.mockReset();
  dbMock.material.findMany.mockReset();
  for (const fn of Object.values(dbMock.billOfMaterial)) fn.mockReset();
});

describe('listBomsPage', () => {
  it('uses a summary count instead of loading every BOM item', async () => {
    dbMock.billOfMaterial.count.mockResolvedValue(21);
    dbMock.billOfMaterial.findMany.mockResolvedValue([
      {
        ...makeBom({ id: 'bom-21' }),
        items: undefined,
        _count: { items: 7 },
      },
    ]);

    const page = await listBomsPage({ page: 2, pageSize: 20 });

    expect(page).toMatchObject({ total: 21, page: 2, pageCount: 2 });
    expect(page.rows[0]?._count.items).toBe(7);
    const query = dbMock.billOfMaterial.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ skip: 20, take: 20 });
    expect(query.select).toMatchObject({
      _count: { select: { items: true } },
    });
    expect(query.select).not.toHaveProperty('items');
  });
});

describe('createBom', () => {
  it('creates a product BOM with active materials', async () => {
    dbMock.product.findUnique.mockResolvedValue({
      id: 'prod1',
      isActive: true,
      categoryNode: { isActive: true },
    });
    dbMock.material.findMany.mockResolvedValue([{ id: 'mat1' }]);
    dbMock.billOfMaterial.create.mockResolvedValue(makeBom());

    await createBom({
      targetType: 'PRODUCT',
      productId: 'prod1',
      categoryNodeId: null,
      name: '红包标准 BOM',
      version: 1,
      baseQuantity: 1000,
      items: [{ materialId: 'mat1', quantity: '500.0000', remark: null }],
    });

    expect(dbMock.billOfMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'prod1',
          categoryNodeId: null,
          version: 1,
          baseQuantity: 1000,
          items: {
            create: [
              {
                materialId: 'mat1',
                quantity: '500.0000',
                sortOrder: 10,
                remark: null,
              },
            ],
          },
        }),
      }),
    );
  });

  it('rejects inactive product targets', async () => {
    dbMock.product.findUnique.mockResolvedValue({
      id: 'prod1',
      isActive: false,
      categoryNode: { isActive: true },
    });

    await expect(
      createBom({
        targetType: 'PRODUCT',
        productId: 'prod1',
        categoryNodeId: null,
        name: '红包标准 BOM',
        version: 1,
        baseQuantity: 1000,
        items: [{ materialId: 'mat1', quantity: '500.0000', remark: null }],
      }),
    ).rejects.toBeInstanceOf(BomInvariantError);
    expect(dbMock.billOfMaterial.create).not.toHaveBeenCalled();
  });
});

describe('setBomActive', () => {
  it('rejects activating when the same product already has an active BOM', async () => {
    dbMock.billOfMaterial.findUnique.mockResolvedValue(
      makeBom({ id: 'bom2', isActive: false }),
    );
    dbMock.billOfMaterial.findFirst.mockResolvedValue({ id: 'bom1' });

    await expect(setBomActive('bom2', true)).rejects.toBeInstanceOf(
      BomInvariantError,
    );
    expect(dbMock.billOfMaterial.update).not.toHaveBeenCalled();
  });
});

describe('estimateMaterialUsageForOrderItems', () => {
  it('prefers product BOM over category BOM and totals material quantities', async () => {
    dbMock.billOfMaterial.findMany.mockResolvedValue([
      makeBom(),
      makeBom({
        id: 'cat-bom',
        productId: null,
        categoryNodeId: 'cat1',
        name: '分类 BOM',
        items: [
          {
            id: 'bomi2',
            bomId: 'cat-bom',
            materialId: 'mat1',
            quantity: '999.0000',
            sortOrder: 10,
            remark: null,
            createdAt: now,
            updatedAt: now,
            material: {
              id: 'mat1',
              code: 'PAPER',
              name: '纸张',
              unit: '张',
              isActive: true,
            },
          },
        ],
      }),
    ]);

    const estimate = await estimateMaterialUsageForOrderItems([
      {
        id: 'item1',
        sequence: 1,
        name: '款式 A',
        quantity: 2000,
        productId: 'prod1',
        product: {
          id: 'prod1',
          name: '标准红包',
          categoryNodeId: 'cat1',
          categoryNode: { id: 'cat1', name: '红包' },
        },
      },
    ]);

    expect(estimate.items[0]).toMatchObject({
      source: 'PRODUCT',
      materials: [{ materialId: 'mat1', quantity: '1000.0000' }],
    });
    expect(estimate.totals).toEqual([
      {
        materialId: 'mat1',
        code: 'PAPER',
        name: '纸张',
        unit: '张',
        quantity: '1000.0000',
      },
    ]);
  });
});
