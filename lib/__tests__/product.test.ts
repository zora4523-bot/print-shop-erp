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
    productCategoryNode: {
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
  listProductCategoryOptions,
  listProductCategoryNodes,
  getProductCategoryNodeSummary,
  createProductCategoryNode,
  updateProductCategoryNode,
  setProductCategoryNodeActive,
  getProductSummary,
  createProduct,
  updateProduct,
  setProductActive,
  ProductInvariantError,
} from '../product';

beforeEach(() => {
  for (const fn of Object.values(dbMock.product)) fn.mockReset();
  for (const fn of Object.values(dbMock.productCategoryNode)) fn.mockReset();
});

const makeCategoryNode = (over = {}) => ({
  id: 'cat_custom_flat_foil',
  path: 'product.custom_flat_foil',
  name: '专版烫金',
  legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
  sortOrder: 30,
  isActive: true,
  ...over,
});

const makeProduct = (over = {}) => ({
  id: 'p1',
  code: 'HB001',
  category: ProductCategory.CUSTOM_FLAT_FOIL,
  categoryNodeId: 'cat_custom_flat_foil',
  name: '专版红包 100x200',
  specification: '100×200',
  paperType: '铜版纸',
  baseUnitPrice: '0.5000',
  minOrderQty: 1000,
  isActive: true,
  createdAt: new Date('2026-04-23T00:00:00Z'),
  updatedAt: new Date('2026-04-23T00:00:00Z'),
  categoryNode: {
    id: 'cat_custom_flat_foil',
    path: 'product.custom_flat_foil',
    name: '专版烫金',
    legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
    isActive: true,
  },
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

  it('adds q search across product code, category, name, specification, paper type, and pinyin', async () => {
    dbMock.product.findMany.mockResolvedValue([]);
    await listProducts({ q: '  铜版纸 ' });
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: '铜版纸', mode: 'insensitive' } },
            { code: { contains: '铜版纸', mode: 'insensitive' } },
            { categoryNode: { is: { name: { contains: '铜版纸', mode: 'insensitive' } } } },
            { specification: { contains: '铜版纸', mode: 'insensitive' } },
            { paperType: { contains: '铜版纸', mode: 'insensitive' } },
            { searchPinyin: { contains: '铜版纸', mode: 'insensitive' } },
            { searchPinyinInitials: { contains: '铜版纸', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('keeps no where filter for blank q', async () => {
    dbMock.product.findMany.mockResolvedValue([]);
    await listProducts({ q: '   ' });
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('sorts q results by relevance while keeping database order as tie-break', async () => {
    dbMock.product.findMany.mockResolvedValue([
      makeProduct({ id: 'contains', name: '专版红包', searchPinyin: null, searchPinyinInitials: null }),
      makeProduct({ id: 'exact', name: '红包', searchPinyin: null, searchPinyinInitials: null }),
      makeProduct({ id: 'prefix', name: '红包袋', searchPinyin: null, searchPinyinInitials: null }),
    ]);

    const rows = await listProducts({ q: '红包' });

    expect(rows.map((row) => row.id)).toEqual(['exact', 'prefix', 'contains']);
  });
});

describe('listProductCategoryOptions', () => {
  it('lists active category nodes by sortOrder then path', async () => {
    dbMock.productCategoryNode.findMany.mockResolvedValue([makeCategoryNode()]);
    await listProductCategoryOptions();
    expect(dbMock.productCategoryNode.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: {
        id: true,
        path: true,
        name: true,
        legacyCategory: true,
        sortOrder: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
    });
  });

  it('can include the current inactive category for existing product edits', async () => {
    dbMock.productCategoryNode.findMany.mockResolvedValue([makeCategoryNode()]);
    await listProductCategoryOptions({ includeInactiveIds: ['cat_disabled'] });
    expect(dbMock.productCategoryNode.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { isActive: true },
          { id: { in: ['cat_disabled'] } },
        ],
      },
      select: {
        id: true,
        path: true,
        name: true,
        legacyCategory: true,
        sortOrder: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
    });
  });
});

describe('product category node management', () => {
  it('lists all category nodes with product counts', async () => {
    dbMock.productCategoryNode.findMany.mockResolvedValue([
      { ...makeCategoryNode(), createdAt: new Date(), updatedAt: new Date(), _count: { products: 2 } },
    ]);
    await listProductCategoryNodes();
    expect(dbMock.productCategoryNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
      }),
    );
  });

  it('creates a top-level node with auto-generated ltree segment', async () => {
    dbMock.productCategoryNode.create.mockResolvedValue(makeCategoryNode());
    await createProductCategoryNode({
      parentId: null,
      name: '新分类',
      legacyCategory: ProductCategory.COLOR_PRINT,
      sortOrder: 70,
    });
    const data = dbMock.productCategoryNode.create.mock.calls[0][0].data;
    // 段名自动生成（用户不接触 ltree 路径），顶级挂在 product 下
    expect(data.path).toMatch(/^product\.n[0-9a-f]{10}$/);
    expect(data).toMatchObject({
      name: '新分类',
      legacyCategory: ProductCategory.COLOR_PRINT,
      sortOrder: 70,
      isActive: true,
    });
  });

  it('creates a child node under the parent path; rejects missing/inactive parent', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue({
      path: 'product.custom',
      isActive: true,
    });
    dbMock.productCategoryNode.create.mockResolvedValue(makeCategoryNode());
    await createProductCategoryNode({
      parentId: 'cat_custom',
      name: '子分类',
      legacyCategory: ProductCategory.COLOR_PRINT,
      sortOrder: 10,
    });
    expect(
      dbMock.productCategoryNode.create.mock.calls[0][0].data.path,
    ).toMatch(/^product\.custom\.n[0-9a-f]{10}$/);

    dbMock.productCategoryNode.findUnique.mockResolvedValue(null);
    await expect(
      createProductCategoryNode({
        parentId: 'missing',
        name: 'x',
        legacyCategory: ProductCategory.COLOR_PRINT,
        sortOrder: 10,
      }),
    ).rejects.toThrow(/上级分类不存在/);

    dbMock.productCategoryNode.findUnique.mockResolvedValue({
      path: 'product.custom',
      isActive: false,
    });
    await expect(
      createProductCategoryNode({
        parentId: 'cat_custom',
        name: 'x',
        legacyCategory: ProductCategory.COLOR_PRINT,
        sortOrder: 10,
      }),
    ).rejects.toThrow(/已停用/);
  });

  it('updates category node editable fields', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());
    dbMock.productCategoryNode.update.mockResolvedValue(makeCategoryNode({ name: '改名' }));
    await updateProductCategoryNode('cat_custom_flat_foil', {
      name: '改名',
      legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
      sortOrder: 35,
    });
    // path 不可改（层级移动是独立功能）——update data 不含 path
    expect(dbMock.productCategoryNode.update.mock.calls[0][0].data).toEqual({
      name: '改名',
      legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
      sortOrder: 35,
    });
  });

  it('flips category node active status', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({ isActive: true }),
    );
    dbMock.productCategoryNode.update.mockResolvedValue(
      makeCategoryNode({ isActive: false }),
    );
    await setProductCategoryNodeActive('cat_custom_flat_foil', false);
    expect(dbMock.productCategoryNode.update.mock.calls[0][0].data).toEqual({
      isActive: false,
    });
  });

  it('returns null when category node is absent', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(null);
    await expect(getProductCategoryNodeSummary('missing')).resolves.toBeNull();
  });
});

describe('createProduct', () => {
  it('forces isActive=true and passes Decimal-compatible string through', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());
    dbMock.product.create.mockResolvedValue(makeProduct());
    await createProduct({
      code: 'HB001',
      categoryNodeId: 'cat_custom_flat_foil',
      name: '空白红包',
      specification: '通用',
      paperType: null,
      baseUnitPrice: '0.1200',
      minOrderQty: 500,
    });
    const data = dbMock.product.create.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect(data.code).toBe('HB001');
    expect(data.category).toBe(ProductCategory.CUSTOM_FLAT_FOIL);
    expect(data.categoryNodeId).toBe('cat_custom_flat_foil');
    expect(data.baseUnitPrice).toBe('0.1200');
    expect(data.minOrderQty).toBe(500);
  });

  it('normalizes omitted minOrderQty to null', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());
    dbMock.product.create.mockResolvedValue(makeProduct());
    await createProduct({
      code: null,
      categoryNodeId: 'cat_custom_flat_foil',
      name: '空白红包',
      specification: null,
      paperType: null,
      baseUnitPrice: null,
    });
    const data = dbMock.product.create.mock.calls[0][0].data;
    expect(data.minOrderQty).toBeNull();
    expect(data.baseUnitPrice).toBeNull();
  });

  it('rejects missing or inactive category node', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(null);
    await expect(
      createProduct({
        code: null,
        categoryNodeId: 'missing',
        name: '空白红包',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
      }),
    ).rejects.toBeInstanceOf(ProductInvariantError);
    expect(dbMock.product.create).not.toHaveBeenCalled();
  });
});

describe('updateProduct', () => {
  it('throws when target missing', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    await expect(
      updateProduct('nope', {
        code: null,
        categoryNodeId: 'cat_custom_flat_foil',
        name: 'X',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
      }),
    ).rejects.toBeInstanceOf(ProductInvariantError);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('updates the editable fields', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        id: 'cat_color_print',
        legacyCategory: ProductCategory.COLOR_PRINT,
      }),
    );
    dbMock.product.update.mockResolvedValue(makeProduct({ name: '改名' }));
    await updateProduct('p1', {
      code: 'NEW001',
      categoryNodeId: 'cat_color_print',
      name: '改名',
      specification: '新规格',
      paperType: '新纸',
      baseUnitPrice: '1.5000',
      minOrderQty: 2000,
    });
    const data = dbMock.product.update.mock.calls[0][0].data;
    expect(data.code).toBe('NEW001');
    expect(data.category).toBe(ProductCategory.COLOR_PRINT);
    expect(data.categoryNodeId).toBe('cat_color_print');
    expect(data.name).toBe('改名');
    expect(data.baseUnitPrice).toBe('1.5000');
  });

  it('allows saving a product that already uses a disabled category node', async () => {
    dbMock.product.findUnique.mockResolvedValue(
      makeProduct({
        categoryNodeId: 'cat_disabled',
        category: ProductCategory.COLOR_PRINT,
        categoryNode: {
          id: 'cat_disabled',
          path: 'product.disabled',
          name: '已停用分类',
          legacyCategory: ProductCategory.COLOR_PRINT,
          isActive: false,
        },
      }),
    );
    dbMock.product.update.mockResolvedValue(makeProduct({ name: '改名' }));
    await updateProduct('p1', {
      code: null,
      categoryNodeId: 'cat_disabled',
      name: '改名',
      specification: null,
      paperType: null,
      baseUnitPrice: null,
    });
    expect(dbMock.productCategoryNode.findUnique).not.toHaveBeenCalled();
    expect(dbMock.product.update.mock.calls[0][0].data.category).toBe(
      ProductCategory.COLOR_PRINT,
    );
  });

  it('never writes isActive through the update path', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());
    dbMock.product.update.mockResolvedValue(makeProduct());
    await updateProduct('p1', {
      code: null,
      categoryNodeId: 'cat_custom_flat_foil',
      name: 'x',
      specification: null,
      paperType: null,
      baseUnitPrice: null,
    });
    const data = dbMock.product.update.mock.calls[0][0].data as Record<string, unknown>;
    expect('isActive' in data).toBe(false);
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
