import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    setting: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    productCategoryNode: { findUnique: vi.fn() },
    material: { findMany: vi.fn(), findUnique: vi.fn() },
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
  dbMock.$transaction.mockReset().mockImplementation((fn) => fn(dbMock));
  dbMock.$executeRaw.mockReset().mockResolvedValue(1);
  dbMock.setting.findUnique.mockReset().mockResolvedValue(null);
  dbMock.material.findUnique.mockReset();
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

    expect(dbMock.billOfMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [
            { productId: { in: ['prod1'] } },
            { categoryNodeId: { in: ['cat1'] } },
          ],
        },
      }),
    );
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

  it('returns NONE and no materials when no active product or category BOM remains', async () => {
    dbMock.billOfMaterial.findMany.mockResolvedValue([]);

    const estimate = await estimateMaterialUsageForOrderItems([
      {
        id: 'item-without-active-bom',
        sequence: 1,
        name: '停用 BOM 后的款式',
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

    expect(dbMock.billOfMaterial.findMany).toHaveBeenCalledOnce();
    expect(dbMock.billOfMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
    expect(estimate).toEqual({
      items: [{
        orderItemId: 'item-without-active-bom',
        sequence: 1,
        itemName: '停用 BOM 后的款式',
        quantity: 2000,
        source: 'NONE',
        bom: null,
        materials: [],
      }],
      totals: [],
    });
  });
});


describe('blank paper/specification BOM targets', () => {
  const paper = { id: 'paper1', name: '红卡', specification: '180g', category: 'PAPER', isActive: true };
  const blankItem = { id: 'blank-item', sequence: 1, name: '中号封', quantity: 2000, productId: null,
    pricingRoute: 'STOCK_BLANK', paperType: '180g红卡', paperWeightGsm: 180, specification: '中号封80×115' };
  const newInput = { targetType: 'BLANK' as const, productId: null, categoryNodeId: null,
    blankPaperMaterialId: 'paper1', blankSpecificationKey: 'mid' as const,
    name: '红卡中号用料', version: 2, baseQuantity: 1000,
    items: [{ materialId: 'mat1', quantity: '500.0000', remark: null }] };
  it('creates a paper/specification BOM without reading Product', async () => {
    dbMock.material.findUnique.mockResolvedValue(paper);
    dbMock.material.findMany.mockResolvedValueOnce([paper]).mockResolvedValueOnce([{ id: 'mat1' }]);
    dbMock.billOfMaterial.create.mockResolvedValue(makeBom());
    await createBom(newInput);
    expect(dbMock.product.findUnique).not.toHaveBeenCalled();
    expect(dbMock.billOfMaterial.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: null, categoryNodeId: null, blankPaperMaterialId: 'paper1', blankSpecificationKey: 'mid' }),
    }));
    expect(dbMock.$executeRaw).toHaveBeenCalled();
  });
  it('rejects duplicate paper identity and invalid standard specification', async () => {
    dbMock.material.findUnique.mockResolvedValue(paper);
    dbMock.material.findMany.mockResolvedValue([paper, { ...paper, id: 'paper2' }]);
    await expect(createBom(newInput)).rejects.toThrow('身份重复');
    await expect(createBom({ ...newInput, blankSpecificationKey: 'invented' } as never)).rejects.toThrow();
    expect(dbMock.billOfMaterial.create).not.toHaveBeenCalled();
  });
  it('rejects creation for historical blank Product target', async () => {
    dbMock.product.findUnique.mockResolvedValue({ id: 'prod1', category: 'BLANK_STOCK', isActive: true, categoryNode: { isActive: true } });
    await expect(createBom({ ...newInput, targetType: 'PRODUCT', productId: 'prod1' })).rejects.toThrow('只读');
    expect(dbMock.billOfMaterial.create).not.toHaveBeenCalled();
  });
  it.each([true, false])('rejects toggling historical blank Product target to %s, including no-op', async (nextActive) => {
    dbMock.billOfMaterial.findUnique.mockResolvedValue(makeBom({ product: { category: 'BLANK_STOCK' } }));
    await expect(setBomActive('bom1', nextActive)).rejects.toThrow('只读');
    expect(dbMock.billOfMaterial.update).not.toHaveBeenCalled();
  });
  it('prefers direct blank target to configured category and preserves Decimal quantities', async () => {
    dbMock.material.findMany.mockResolvedValue([paper]);
    dbMock.setting.findUnique.mockResolvedValue({ value: 'cat1' });
    dbMock.productCategoryNode.findUnique.mockResolvedValue({ id: 'cat1', isActive: true, legacyCategory: 'BLANK_STOCK' });
    dbMock.billOfMaterial.findMany.mockResolvedValue([
      makeBom({ productId: null, categoryNodeId: null, blankPaperMaterialId: 'paper1', blankSpecificationKey: 'mid' }),
      makeBom({ id: 'category-bom', productId: null, categoryNodeId: 'cat1', baseQuantity: 1 }),
    ]);
    const result = await estimateMaterialUsageForOrderItems([blankItem]);
    expect(result.items[0]).toMatchObject({ source: 'BLANK', materials: [{ quantity: '1000.0000' }] });
    expect(dbMock.product.findUnique).not.toHaveBeenCalled();
  });
  it('uses default category for a new identity with no dedicated BOM', async () => {
    dbMock.material.findMany.mockResolvedValue([paper]);
    dbMock.setting.findUnique.mockResolvedValue({ value: 'cat1' });
    dbMock.productCategoryNode.findUnique.mockResolvedValue({ id: 'cat1', isActive: true, legacyCategory: 'BLANK_STOCK' });
    dbMock.billOfMaterial.findMany.mockResolvedValue([makeBom({ productId: null, categoryNodeId: 'cat1' })]);
    expect((await estimateMaterialUsageForOrderItems([blankItem])).items[0]).toMatchObject({ source: 'CATEGORY', materials: [{ quantity: '1000.0000' }] });
  });
  it('reports ambiguous blank paper without guessing a BOM or hiding healthy product estimates', async () => {
    dbMock.material.findMany.mockResolvedValue([paper, { ...paper, id: 'retired', isActive: false }]);
    dbMock.billOfMaterial.findMany.mockResolvedValue([makeBom()]);
    const result = await estimateMaterialUsageForOrderItems([
      blankItem, { ...blankItem, id: 'history', productId: 'prod1' },
    ]);
    expect(result.items[0]).toMatchObject({ source: 'NONE', bom: null, materials: [], issue: expect.stringContaining('身份重复') });
    expect(result.items[1]).toMatchObject({ source: 'PRODUCT', materials: [{ quantity: '1000.0000' }] });
    expect(result.totals).toHaveLength(1);
  });
  it('missing BOM remains a visible NONE row instead of silent success', async () => {
    dbMock.material.findMany.mockResolvedValue([paper]);
    dbMock.billOfMaterial.findMany.mockResolvedValue([]);
    const result = await estimateMaterialUsageForOrderItems([blankItem]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ source: 'NONE', bom: null, materials: [] });
    expect(result.totals).toEqual([]);
  });
  it('does not let incomplete identity inherit default category', async () => {
    dbMock.material.findMany.mockResolvedValue([paper]);
    dbMock.setting.findUnique.mockResolvedValue({ value: 'cat1' });
    dbMock.productCategoryNode.findUnique.mockResolvedValue({ id: 'cat1', isActive: true, legacyCategory: 'BLANK_STOCK' });
    dbMock.billOfMaterial.findMany.mockResolvedValue([makeBom({ productId: null, categoryNodeId: 'cat1' })]);
    expect((await estimateMaterialUsageForOrderItems([{ ...blankItem, specification: '未知' }])).items[0]?.source).toBe('NONE');
  });
  it('fails explicitly if a configured default category is invalid', async () => {
    dbMock.material.findMany.mockResolvedValue([paper]);
    dbMock.setting.findUnique.mockResolvedValue({ value: 'missing' });
    dbMock.productCategoryNode.findUnique.mockResolvedValue(null);
    expect((await estimateMaterialUsageForOrderItems([blankItem])).items[0]).toMatchObject({ source: 'NONE', issue: '空白封默认用料分类不存在或已失效', materials: [] });
  });
  it('does not read the current paper/default for historical Product orders', async () => {
    dbMock.billOfMaterial.findMany.mockResolvedValue([makeBom()]);
    const result = await estimateMaterialUsageForOrderItems([{ ...blankItem, productId: 'prod1' }]);
    expect(result.items[0]?.source).toBe('PRODUCT');
    expect(dbMock.material.findMany).not.toHaveBeenCalled();
    expect(dbMock.setting.findUnique).not.toHaveBeenCalled();
  });
});
