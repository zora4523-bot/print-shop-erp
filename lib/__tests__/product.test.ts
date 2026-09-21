import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import {
  ProductCategory,
  Role,
} from '../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    setting: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    businessAuditLog: {
      create: vi.fn(),
    },
    businessCodeSequence: {
      upsert: vi.fn(),
    },
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    material: { findMany: vi.fn() },
    customerPriceRule: {
      count: vi.fn(),
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
  listProductsPage,
  listProductCategoryOptions,
  listProductCategoryNodes,
  getProductCategoryNodeSummary,
  createProductCategoryNode,
  updateProductCategoryNode,
  setProductCategoryNodeActive,
  getProductSummary,
  getProductReferenceImpact,
  createProduct,
  updateProduct,
  setProductActive,
  setProductActiveInTx,
  ProductInvariantError,
  QUOTE_PRODUCT_CATEGORIES,
  orderCategoryNodesAsTree,
  isRetiredProductCategory,
} from '../product';

describe('QUOTE_PRODUCT_CATEGORIES', () => {
  it('独立产品资料仅保留非空白路线，空白封由单价表管理', () => {
    expect(QUOTE_PRODUCT_CATEGORIES).toEqual([
      ProductCategory.GENERIC_STOCK,
      ProductCategory.CUSTOM_FLAT_FOIL,
      ProductCategory.COLOR_PRINT,
    ]);
    expect(QUOTE_PRODUCT_CATEGORIES).not.toContain(
      ProductCategory.STOCK_FOIL_ADD,
    );
    expect(QUOTE_PRODUCT_CATEGORIES).not.toContain(
      ProductCategory.BYO_MATERIAL,
    );
  });
});

beforeEach(() => {
  dbMock.setting.findUnique.mockReset().mockResolvedValue(null);
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$queryRaw.mockReset().mockResolvedValue([]);
  dbMock.businessAuditLog.create.mockReset().mockResolvedValue({ id: 'audit-1' });
  dbMock.$transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: typeof dbMock) => Promise<unknown>) => callback(dbMock),
    );
  dbMock.businessCodeSequence.upsert.mockReset();
  for (const fn of Object.values(dbMock.product)) fn.mockReset();
  dbMock.material.findMany.mockReset().mockResolvedValue([]);
  dbMock.product.findMany.mockResolvedValue([]);
  dbMock.customerPriceRule.count.mockReset().mockResolvedValue(0);
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

const activeChangeContext = {
  actor: {
    id: 'admin-1',
    role: Role.ADMIN,
    username: 'admin',
    displayName: '管理员',
  },
  reason: '旧款停产',
};

describe('listProductsPage', () => {
  it('counts and fetches only the requested product page', async () => {
    dbMock.product.count.mockResolvedValue(45);
    dbMock.product.findMany.mockResolvedValue([
      makeProduct({ id: 'p41', name: '分页产品' }),
    ]);

    const page = await listProductsPage({ page: 3, pageSize: 20 });

    expect(page).toMatchObject({ total: 45, page: 3, pageCount: 3 });
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        orderBy: [
          { isActive: 'desc' },
          { category: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('applies the same search filter to count and rows', async () => {
    dbMock.product.count.mockResolvedValue(1);
    dbMock.product.findMany.mockResolvedValue([makeProduct()]);

    await listProductsPage({ q: '红包', page: 1, pageSize: 20 });

    const expectedWhere = expect.objectContaining({ OR: expect.any(Array) });
    expect(dbMock.product.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
    );
  });

  it('applies the explicit active-state filter and attaches real reference counts', async () => {
    dbMock.product.count.mockResolvedValue(1);
    dbMock.product.findMany.mockResolvedValue([makeProduct()]);
    dbMock.$queryRaw.mockResolvedValue([
      {
        productId: 'p1',
        orderCount: 3,
        bomCount: 2,
        currentExternalPriceRuleCount: 4,
      },
    ]);

    const result = await listProductsPage({
      status: 'inactive',
      page: 1,
      pageSize: 20,
    });

    expect(dbMock.product.count).toHaveBeenCalledWith({
      where: { isActive: false },
    });
    expect(result.rows[0]?.referenceImpact).toEqual({
      orderCount: 3,
      bomCount: 2,
      currentExternalPriceRuleCount: 4,
    });
  });

  it('can scope the rule-center list to stock product categories', async () => {
    dbMock.product.count.mockResolvedValue(0);
    dbMock.product.findMany.mockResolvedValue([]);

    await listProductsPage({
      categories: [
        ProductCategory.BLANK_STOCK,
        ProductCategory.GENERIC_STOCK,
      ],
      page: 1,
      pageSize: 20,
    });

    const where = {
      category: {
        in: [
          ProductCategory.BLANK_STOCK,
          ProductCategory.GENERIC_STOCK,
        ],
      },
    };
    expect(dbMock.product.count).toHaveBeenCalledWith({ where });
    expect(dbMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
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

  it('新业务选项排除退役根节点及其后代', async () => {
    const active = makeCategoryNode();
    const retiredRoot = makeCategoryNode({
      id: 'cat-generic',
      path: 'product.generic_stock',
      legacyCategory: ProductCategory.GENERIC_STOCK,
    });
    const retiredChild = makeCategoryNode({
      id: 'cat-generic-child',
      path: 'product.generic_stock.legacy_child',
      legacyCategory: ProductCategory.BLANK_STOCK,
    });
    dbMock.productCategoryNode.findMany.mockResolvedValue([
      active,
      retiredRoot,
      retiredChild,
    ]);

    await expect(listProductCategoryOptions()).resolves.toEqual([active]);
  });

  it('编辑历史 SKU 时仍可显式保留它当前的退役分类', async () => {
    const retired = makeCategoryNode({
      id: 'cat-generic',
      path: 'product.generic_stock',
      legacyCategory: ProductCategory.GENERIC_STOCK,
      isActive: false,
    });
    dbMock.productCategoryNode.findMany.mockResolvedValue([retired]);

    await expect(
      listProductCategoryOptions({ includeInactiveIds: ['cat-generic'] }),
    ).resolves.toEqual([retired]);
  });
});

describe('orderCategoryNodesAsTree', () => {
  const n = (path: string, sortOrder: number, name: string) => ({
    path,
    sortOrder,
    name,
  });

  it('子节点紧跟父节点，即使子节点 sortOrder 更小（防悬空缩进行）', () => {
    const rows = [
      n('product.b.child', 1, '子'),
      n('product.a', 10, '甲'),
      n('product.b', 20, '乙'),
    ];
    expect(orderCategoryNodesAsTree(rows).map((r) => r.name)).toEqual([
      '甲',
      '乙',
      '子',
    ]);
  });

  it('兄弟按 sortOrder 排，孤儿节点兜底追加不丢行', () => {
    const rows = [
      n('product.a', 20, '后'),
      n('product.b', 10, '先'),
      n('product.gone.orphan', 1, '孤儿'), // 父节点不在结果集
    ];
    const ordered = orderCategoryNodesAsTree(rows).map((r) => r.name);
    expect(ordered.slice(0, 2)).toEqual(['先', '后']);
    expect(ordered).toContain('孤儿');
    expect(ordered).toHaveLength(3);
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

  it.each([
    ProductCategory.GENERIC_STOCK,
    ProductCategory.STOCK_FOIL_ADD,
    ProductCategory.BYO_MATERIAL,
  ])('拒绝通过新建节点重建退役兼容分类 %s', async (legacyCategory) => {
    await expect(
      createProductCategoryNode({
        parentId: null,
        name: '历史分类',
        legacyCategory,
        sortOrder: 900,
      }),
    ).rejects.toThrow(/历史产品分类已退役.*不能新建/u);

    expect(dbMock.productCategoryNode.create).not.toHaveBeenCalled();
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

  it('拒绝在退役分类下新建子分类', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        path: 'product.generic_stock',
        legacyCategory: ProductCategory.BLANK_STOCK,
        isActive: true,
      }),
    );

    await expect(
      createProductCategoryNode({
        parentId: 'cat-generic',
        name: '新子分类',
        legacyCategory: ProductCategory.COLOR_PRINT,
        sortOrder: 10,
      }),
    ).rejects.toThrow(/已退役.*不能在其下新建/u);
    expect(dbMock.productCategoryNode.create).not.toHaveBeenCalled();
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

  it('允许退役分类保持兼容标识时修改历史展示信息', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        path: 'product.generic_stock',
        legacyCategory: ProductCategory.GENERIC_STOCK,
        isActive: false,
      }),
    );
    dbMock.productCategoryNode.update.mockResolvedValue(
      makeCategoryNode({
        path: 'product.generic_stock',
        name: '历史通版现货',
        legacyCategory: ProductCategory.GENERIC_STOCK,
        isActive: false,
      }),
    );

    await updateProductCategoryNode('cat-generic', {
      name: '历史通版现货',
      legacyCategory: ProductCategory.GENERIC_STOCK,
      sortOrder: 900,
    });

    expect(dbMock.productCategoryNode.update).toHaveBeenCalledOnce();
  });

  it('拒绝修改退役节点的兼容分类来绕过激活保护', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        path: 'product.archived_alias',
        legacyCategory: ProductCategory.GENERIC_STOCK,
        isActive: false,
      }),
    );

    await expect(
      updateProductCategoryNode('cat-generic', {
        name: '历史通版现货',
        legacyCategory: ProductCategory.BLANK_STOCK,
        sortOrder: 900,
      }),
    ).rejects.toThrow(/已退役.*不能改变其兼容分类/u);
    expect(dbMock.productCategoryNode.update).not.toHaveBeenCalled();
  });

  it('拒绝将现行节点改入退役兼容分类', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());

    await expect(
      updateProductCategoryNode('cat-custom', {
        name: '不应变为历史分类',
        legacyCategory: ProductCategory.BYO_MATERIAL,
        sortOrder: 30,
      }),
    ).rejects.toThrow(/不能将现行产品分类改为已退役分类/u);
    expect(dbMock.productCategoryNode.update).not.toHaveBeenCalled();
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

  it('允许普通停用分类重新启用', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({ isActive: false }),
    );
    dbMock.productCategoryNode.update.mockResolvedValue(
      makeCategoryNode({ isActive: true }),
    );

    await setProductCategoryNodeActive('cat-custom', true);

    expect(dbMock.productCategoryNode.update.mock.calls[0][0].data).toEqual({
      isActive: true,
    });
  });

  it.each([
    [
      'path',
      {
        path: 'product.generic_stock',
        legacyCategory: ProductCategory.BLANK_STOCK,
      },
    ],
    [
      'legacyCategory',
      {
        path: 'product.archived_alias',
        legacyCategory: ProductCategory.STOCK_FOIL_ADD,
      },
    ],
  ])('拒绝通过 %s 命中的退役分类重新启用', async (_kind, identity) => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({ ...identity, isActive: false }),
    );

    await expect(
      setProductCategoryNodeActive('cat-retired', true),
    ).rejects.toThrow(/历史产品分类已退役.*不能重新启用/u);
    expect(dbMock.productCategoryNode.update).not.toHaveBeenCalled();
  });

  it('已退役分类仍可从异常激活状态停用', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        path: 'product.byo_material',
        legacyCategory: ProductCategory.BYO_MATERIAL,
        isActive: true,
      }),
    );
    dbMock.productCategoryNode.update.mockResolvedValue(
      makeCategoryNode({
        path: 'product.byo_material',
        legacyCategory: ProductCategory.BYO_MATERIAL,
        isActive: false,
      }),
    );

    await setProductCategoryNodeActive('cat-byo', false);

    expect(dbMock.productCategoryNode.update.mock.calls[0][0].data).toEqual({
      isActive: false,
    });
  });

  it('returns null when category node is absent', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(null);
    await expect(getProductCategoryNodeSummary('missing')).resolves.toBeNull();
  });
});

describe('isRetiredProductCategory', () => {
  it.each([
    'product.generic_stock',
    'product.stock_foil_add',
    'product.byo_material',
  ])('通过历史 path 判定退役分类: %s', (path) => {
    expect(
      isRetiredProductCategory({
        path,
        legacyCategory: ProductCategory.BLANK_STOCK,
      }),
    ).toBe(true);
  });

  it('将退役节点的既有后代一并判定为退役', () => {
    expect(
      isRetiredProductCategory({
        path: 'product.generic_stock.legacy_child.deep_leaf',
        legacyCategory: ProductCategory.BLANK_STOCK,
      }),
    ).toBe(true);
  });

  it.each([
    ProductCategory.GENERIC_STOCK,
    ProductCategory.STOCK_FOIL_ADD,
    ProductCategory.BYO_MATERIAL,
  ])('通过历史 legacyCategory 判定退役分类: %s', (legacyCategory) => {
    expect(
      isRetiredProductCategory({
        path: 'product.archived_alias',
        legacyCategory,
      }),
    ).toBe(true);
  });

  it('不将普通分类误判为退役', () => {
    expect(isRetiredProductCategory(makeCategoryNode())).toBe(false);
  });
});

describe('createProduct', () => {
  it('takes the exclusive price snapshot lock in the product mutation transaction', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode());
    const txMock = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      productCategoryNode: {
        findUnique: vi.fn().mockResolvedValue(makeCategoryNode()),
      },
      product: { create: vi.fn().mockResolvedValue(makeProduct()) },
    };
    dbMock.$transaction.mockImplementationOnce(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );

    await createProduct({
      code: 'HB001',
      categoryNodeId: 'cat_custom_flat_foil',
      name: '空白红包',
      specification: null,
      paperType: null,
      baseUnitPrice: '0.1200',
    });

    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.productCategoryNode.findUnique).toHaveBeenCalledTimes(1);
    expect(dbMock.product.create).not.toHaveBeenCalled();
    expect(txMock.product.create).toHaveBeenCalledTimes(1);
    const sql = (txMock.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(
      '?',
    );
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).not.toContain('pg_advisory_xact_lock_shared');
    expect(txMock.product.create.mock.invocationCallOrder[0]).toBeGreaterThan(
      txMock.$executeRaw.mock.invocationCallOrder[0]!,
    );
  });

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
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 12 });
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
    expect(data.code).toBe('PRD-000012');
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

  it('拒绝通过伪造的活跃分类 ID 在退役分类下创建 SKU', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        id: 'cat-retired',
        path: 'product.stock_foil_add',
        legacyCategory: ProductCategory.STOCK_FOIL_ADD,
        isActive: true,
      }),
    );

    await expect(
      createProduct({
        code: 'HISTORY-ONLY',
        categoryNodeId: 'cat-retired',
        name: '不应新建的 SKU',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
      }),
    ).rejects.toThrow(/历史产品分类已退役.*不能用于新业务/u);
    expect(dbMock.product.create).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
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

  it('拒绝将现行 SKU 迁入退役分类', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.productCategoryNode.findUnique.mockResolvedValue(
      makeCategoryNode({
        id: 'cat-retired',
        path: 'product.archived_alias',
        legacyCategory: ProductCategory.BYO_MATERIAL,
        isActive: true,
      }),
    );

    await expect(
      updateProduct('p1', {
        code: 'HB001',
        categoryNodeId: 'cat-retired',
        name: '不应迁入的 SKU',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
      }),
    ).rejects.toThrow(/历史产品分类已退役.*不能用于新业务/u);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('protects SKU matching facts referenced by a current or scheduled price book', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    await expect(
      updateProduct('p1', {
        code: 'NEW001',
        categoryNodeId: 'cat_custom_flat_foil',
        name: '只改展示名',
        specification: '100×200',
        paperType: '铜版纸',
        baseUnitPrice: '0.5000',
      }),
    ).rejects.toThrow(/新建产品目录项.*新价格版本/u);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('allows display-name changes without rewriting protected pricing facts', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.customerPriceRule.count.mockResolvedValue(1);
    dbMock.product.update.mockResolvedValue(makeProduct({ name: '新展示名' }));

    await updateProduct('p1', {
      code: 'HB001',
      categoryNodeId: 'cat_custom_flat_foil',
      name: '新展示名',
      specification: '100×200',
      paperType: '铜版纸',
      baseUnitPrice: '0.5000',
      minOrderQty: 1000,
    });

    expect(dbMock.product.update).toHaveBeenCalledOnce();
  });

  it('省略旧计价字段时保留历史存量值', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    dbMock.product.update.mockResolvedValue(makeProduct({ name: '改名' }));

    await updateProduct('p1', {
      code: null,
      categoryNodeId: 'cat_custom_flat_foil',
      name: '改名',
      specification: null,
      paperType: null,
    });

    const data = dbMock.product.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect('baseUnitPrice' in data).toBe(false);
    expect('minOrderQty' in data).toBe(false);
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
      code: 'HB001',
      categoryNodeId: 'cat_disabled',
      name: '改名',
      specification: '100×200',
      paperType: '铜版纸',
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
    const r = await setProductActive('p1', true, activeChangeContext);
    expect(r).toBe(p);
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });

  it('flips isActive when different', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: true }));
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: false }));
    await setProductActive('p1', false, activeChangeContext);
    expect(dbMock.product.update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PRODUCT_DEACTIVATE',
          entityType: 'Product',
          entityId: 'p1',
          actorId: 'admin-1',
          requestMetadata: expect.objectContaining({
            reason: '旧款停产',
          }),
        }),
      }),
    );
  });

  it('允许普通分类下的停用 SKU 重新启用', async () => {
    dbMock.product.findUnique.mockResolvedValue(
      makeProduct({ isActive: false }),
    );
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: true }));

    await setProductActive('p1', true, {
      ...activeChangeContext,
      reason: null,
    });

    expect(dbMock.product.update.mock.calls[0][0].data).toEqual({
      isActive: true,
    });
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_ACTIVATE' }),
      }),
    );
  });

  it.each([
    [
      'path',
      {
        path: 'product.byo_material',
        legacyCategory: ProductCategory.BLANK_STOCK,
      },
    ],
    [
      'legacyCategory',
      {
        path: 'product.archived_alias',
        legacyCategory: ProductCategory.GENERIC_STOCK,
      },
    ],
  ])('拒绝重新启用通过 %s 命中退役分类的 SKU', async (_kind, identity) => {
    dbMock.product.findUnique.mockResolvedValue(
      makeProduct({
        isActive: false,
        category: identity.legacyCategory,
        categoryNode: makeCategoryNode({
          ...identity,
          isActive: false,
        }),
      }),
    );

    await expect(
      setProductActive('p1', true, {
        ...activeChangeContext,
        reason: null,
      }),
    ).rejects.toThrow(identity.legacyCategory === ProductCategory.BLANK_STOCK ? /历史产品资料只读/u : /属于已退役历史分类.*不能重新启用/u);
    expect(dbMock.product.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects deactivation while a current or scheduled price version references the SKU', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: true }));
    dbMock.customerPriceRule.count.mockResolvedValue(1);

    await expect(
      setProductActive('p1', false, activeChangeContext),
    ).rejects.toThrow(/新建产品目录项.*新价格版本/u);
    expect(dbMock.product.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('requires a reason for deactivation inside the domain transaction', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: true }));
    await expect(
      setProductActive('p1', false, {
        ...activeChangeContext,
        reason: '   ',
      }),
    ).rejects.toThrow(/必须填写业务理由/);
    expect(dbMock.product.update).not.toHaveBeenCalled();
    expect(dbMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('throws when target missing', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    await expect(
      setProductActive('nope', false, activeChangeContext),
    ).rejects.toBeInstanceOf(
      ProductInvariantError,
    );
  });
});

describe('getProductReferenceImpact', () => {
  it('counts distinct orders and only the published customer-price source', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        productId: 'p1',
        orderCount: 7,
        bomCount: 2,
        currentExternalPriceRuleCount: 3,
      },
    ]);

    await expect(
      getProductReferenceImpact('p1', new Date('2026-08-24T00:00:00Z')),
    ).resolves.toEqual({
      orderCount: 7,
      bomCount: 2,
      currentExternalPriceRuleCount: 3,
    });
    expect(dbMock.$queryRaw).toHaveBeenCalledOnce();
    const query = dbMock.$queryRaw.mock.calls[0]?.[0] as { sql?: string };
    expect(query.sql).toContain('COUNT(DISTINCT item."orderId")');
    expect(query.sql).toContain('book."settlementType" = \'EXTERNAL_SALES\'');
    expect(query.sql).toContain('book."effectiveFrom" <=');
    expect(query.sql).not.toContain('PriceTier');
  });
});

describe('getProductSummary', () => {
  it('returns null when absent', async () => {
    dbMock.product.findUnique.mockResolvedValue(null);
    expect(await getProductSummary('nope')).toBeNull();
  });
});


describe('setProductActiveInTx', () => {
  it('uses the supplied transaction without starting another transaction or taking another lock', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: false }));
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: true }));
    await setProductActiveInTx(dbMock as unknown as Prisma.TransactionClient, 'p1', true, {
      ...activeChangeContext, reason: null,
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    expect(dbMock.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: true } }));
    expect(dbMock.businessAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PRODUCT_ACTIVATE',
        requestMetadata: expect.objectContaining({ referenceImpact: expect.any(Object) }),
      }),
    }));
  });
  it('the public wrapper still takes exactly one write lock before any reads', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: false }));
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: true }));
    await setProductActive('p1', true, { ...activeChangeContext, reason: null });
    expect(dbMock.$transaction).toHaveBeenCalledOnce();
    expect(dbMock.$executeRaw).toHaveBeenCalledOnce();
    expect(dbMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(dbMock.product.findUnique.mock.invocationCallOrder[0]);
  });
  it('propagates audit failures so the caller can roll back the whole transaction', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct({ isActive: false }));
    dbMock.product.update.mockResolvedValue(makeProduct({ isActive: true }));
    dbMock.businessAuditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(setProductActiveInTx(dbMock as unknown as Prisma.TransactionClient, 'p1', true, {
      ...activeChangeContext, reason: null,
    })).rejects.toThrow('audit failed');
  });
});

describe('blank products are historical read-only after price-only cutover', () => {
  const data = { code: 'BLANK-TEST', name: '历史空白封', categoryNodeId: 'stock', paperType: '160g红卡',
    specification: '中号封80×115', baseUnitPrice: null };
  const row = (changes = {}) => ({ ...makeProduct(), id: 'existing', category: ProductCategory.BLANK_STOCK,
    categoryNodeId: 'stock', paperType: '160g红卡', weight: 160, specification: '中号封80×115', paperMaterialId: null, ...changes });
  beforeEach(() => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode({ id: 'stock', legacyCategory: ProductCategory.BLANK_STOCK }));
  });
  it.each([{ products: [] }, { products: [row()] }, { products: [row({ isActive: false })] }])('rejects blank creation independently of existing Product rows', async ({ products }) => {
    dbMock.product.findMany.mockResolvedValue(products);
    await expect(createProduct(data)).rejects.toThrow('空白封单价表管理');
    expect(dbMock.product.create).not.toHaveBeenCalled();
  });
  it('rejects moving a different product into the blank category', async () => {
    dbMock.product.findUnique.mockResolvedValue(makeProduct());
    await expect(updateProduct('p1', data)).rejects.toThrow('空白封单价表管理');
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });
  it('rejects every historical blank edit, including display-only and unchanged long code', async () => {
    const code = `BLANK-${'a'.repeat(20)}-west-large`;
    dbMock.product.findUnique.mockResolvedValue(row({ code }));
    for (const changes of [{}, { name: '展示名' }, { code: 'NEW' }, { paperType: '180g红卡' }, { specification: '大号封90×165' }, { categoryNodeId: 'other' }]) {
      await expect(updateProduct('existing', { ...data, code, ...changes })).rejects.toThrow('只读');
    }
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });
  it.each([true, false])('rejects historical blank activation %s', async (isActive) => {
    dbMock.product.findUnique.mockResolvedValue(row());
    await expect(setProductActiveInTx(dbMock as unknown as Prisma.TransactionClient, 'existing', isActive, {
      actor: { id: 'admin', username: 'admin', displayName: '管理员', role: Role.ADMIN }, reason: null,
    })).rejects.toThrow('只读');
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });
  it('keeps color-print identity protection', async () => {
    dbMock.product.findUnique.mockResolvedValue(row({ category: ProductCategory.COLOR_PRINT, code: data.code }));
    for (const changes of [{ code: 'NEW' }, { paperType: '180g红卡' }, { specification: '大号封90×165' }]) {
      await expect(updateProduct('existing', { ...data, ...changes })).rejects.toThrow('不可修改');
    }
    expect(dbMock.product.update).not.toHaveBeenCalled();
  });
  it('protects configured default BOM category against deactivation or reassignment, while display edit remains allowed', async () => {
    dbMock.productCategoryNode.findUnique.mockResolvedValue(makeCategoryNode({ id: 'stock', legacyCategory: ProductCategory.BLANK_STOCK }));
    dbMock.setting.findUnique.mockResolvedValue({ value: 'stock' });
    await expect(setProductCategoryNodeActive('stock', false)).rejects.toThrow('默认用料');
    await expect(updateProductCategoryNode('stock', { name: '分类', legacyCategory: ProductCategory.COLOR_PRINT, sortOrder: 1 })).rejects.toThrow('默认用料');
    expect(dbMock.productCategoryNode.update).not.toHaveBeenCalled();
    await updateProductCategoryNode('stock', { name: '空白封用料', legacyCategory: ProductCategory.BLANK_STOCK, sortOrder: 1 });
    expect(dbMock.productCategoryNode.update).toHaveBeenCalledOnce();
  });
});
