import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { ProductCategory } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  productMock,
  revalidatePathMock,
  redirectMock,
  MockProductInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  productMock: {
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    setProductActive: vi.fn(),
    getProductCategoryNodeSummary: vi.fn(),
    getProductSummary: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockProductInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ProductInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/product', () => ({
  createProduct: productMock.createProduct,
  updateProduct: productMock.updateProduct,
  setProductActive: productMock.setProductActive,
  getProductCategoryNodeSummary: productMock.getProductCategoryNodeSummary,
  getProductSummary: productMock.getProductSummary,
  QUOTE_PRODUCT_CATEGORIES: [
    'BLANK_STOCK',
    'GENERIC_STOCK',
    'CUSTOM_FLAT_FOIL',
    'COLOR_PRINT',
  ],
  ProductInvariantError: MockProductInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createQuoteProductAction,
  setQuoteProductActiveAction,
  updateQuoteProductAction,
} from '../owner-products';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validCreate = {
  code: '',
  categoryNodeId: 'cat_blank_stock',
  name: '空白红包',
  specification: '',
  paperType: '',
};

const fd = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  productMock.createProduct.mockReset();
  productMock.updateProduct.mockReset();
  productMock.setProductActive.mockReset();
  productMock.getProductCategoryNodeSummary.mockReset();
  productMock.getProductSummary.mockReset();
  productMock.getProductCategoryNodeSummary.mockResolvedValue({
    id: 'cat_blank_stock',
    legacyCategory: ProductCategory.BLANK_STOCK,
  });
  productMock.getProductSummary.mockResolvedValue({
    id: 'p1',
    category: ProductCategory.BLANK_STOCK,
  });
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createQuoteProductAction', () => {
  it("first-line requirePermission('dict:product:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createQuoteProductAction(null, fd(validCreate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('dict:product:manage');
    expect(productMock.createProduct).not.toHaveBeenCalled();
  });

  it('returns invalid on schema failure (empty name)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createQuoteProductAction(
      null,
      fd({ ...validCreate, name: '' }),
    );
    expect(result.status).toBe('invalid');
    expect(productMock.createProduct).not.toHaveBeenCalled();
  });

  it('创建组合时将历史产品单价固定为空', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(createQuoteProductAction(null, fd(validCreate))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(productMock.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryNodeId: 'cat_blank_stock',
        code: null,
        name: '空白红包',
        specification: null,
        paperType: null,
        baseUnitPrice: null,
      }),
    );
    expect(productMock.createProduct.mock.calls[0][0]).not.toHaveProperty(
      'minOrderQty',
    );
  });

  it('passes optional product code through', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(
      createQuoteProductAction(null, fd({ ...validCreate, code: 'HB001' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(productMock.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HB001' }),
    );
  });

  it('maps P2002 on product code to invalid.code field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );
    const result = await createQuoteProductAction(
      null,
      fd({ ...validCreate, code: 'HB001' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该产品编码已被占用');
    }
  });

  it('忽略伪造的旧单价与起订量字段', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(
      createQuoteProductAction(
        null,
        fd({
          ...validCreate,
          baseUnitPrice: '9999999.99999',
          minOrderQty: 'not-a-number',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const arg = productMock.createProduct.mock.calls[0][0];
    expect(arg.baseUnitPrice).toBeNull();
    expect(arg).not.toHaveProperty('minOrderQty');
  });

  it('revalidates + redirects to new product edit page on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(createQuoteProductAction(null, fd(validCreate))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/stock-skus');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/stock-skus/p1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/new');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/boms/new');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/customer-pricing',
    );
    expect(revalidatePathMock).not.toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/tiers/new',
    );
    expect(redirectMock).toHaveBeenCalledWith('/owner/rules/stock-skus/p1');
  });

  it('keeps rule-center stock SKU creation inside the rule center', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });

    await expect(
      createQuoteProductAction(
        null,
        fd({
          ...validCreate,
          routeBase: '/owner/rules/stock-skus',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith('/owner/rules/stock-skus/p1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/stock-skus');
  });

  it('建单产品专用 action 只接受三条路线分类且固定 canonical 路径', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductCategoryNodeSummary.mockResolvedValue({
      id: 'cat_blank_stock',
      legacyCategory: ProductCategory.BLANK_STOCK,
    });
    productMock.createProduct.mockResolvedValue({ id: 'p1' });

    await expect(
      createQuoteProductAction(
        null,
        fd({ ...validCreate, routeBase: '/owner/products' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith('/owner/rules/stock-skus/p1');
  });

  it('可建单组合创建不接受客户计价字段', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductCategoryNodeSummary.mockResolvedValue({
      id: 'cat_blank_stock',
      legacyCategory: ProductCategory.BLANK_STOCK,
    });
    productMock.createProduct.mockResolvedValue({ id: 'p1' });

    await expect(
      createQuoteProductAction(
        null,
        fd({
          ...validCreate,
          baseUnitPrice: '9999999.99999',
          minOrderQty: '1000',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(productMock.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ baseUnitPrice: null }),
    );
    expect(productMock.createProduct.mock.calls[0][0]).not.toHaveProperty(
      'minOrderQty',
    );
  });

  it('建单产品专用 action 拒绝已归并的现货加烫旧分类', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductCategoryNodeSummary.mockResolvedValue({
      id: 'cat_legacy',
      legacyCategory: ProductCategory.STOCK_FOIL_ADD,
    });

    const result = await createQuoteProductAction(null, fd(validCreate));

    expect(result.status).toBe('invalid');
    expect(productMock.createProduct).not.toHaveBeenCalled();
  });
});

describe('updateQuoteProductAction', () => {
  const baseUpdate = { ...validCreate };

  it('requires dict:product:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updateQuoteProductAction('p1', null, fd(baseUpdate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps ProductInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockRejectedValueOnce(
      new MockProductInvariantError('目标产品不存在'),
    );
    const result = await updateQuoteProductAction('p1', null, fd(baseUpdate));
    expect(result.status).toBe('error');
  });

  it('does not forward isActive to lib.updateProduct (activation is owned by setProductActive)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockResolvedValue({ id: 'p1' });
    // Even if an isActive=on field sneaks through FormData, the schema strips it.
    await updateQuoteProductAction('p1', null, fd({ ...baseUpdate, isActive: 'on' }));
    const passed = productMock.updateProduct.mock.calls[0][1] as Record<string, unknown>;
    expect('isActive' in passed).toBe(false);
  });

  it('可建单组合更新忽略伪造的旧单价与起订量', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductCategoryNodeSummary.mockResolvedValue({
      id: 'cat_blank_stock',
      legacyCategory: ProductCategory.BLANK_STOCK,
    });
    productMock.updateProduct.mockResolvedValue({ id: 'p1' });

    const result = await updateQuoteProductAction(
      'p1',
      null,
      fd({
        ...baseUpdate,
        baseUnitPrice: '9999999.99999',
        minOrderQty: '1000',
      }),
    );

    expect(result.status).toBe('success');
    const passed = productMock.updateProduct.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect('baseUnitPrice' in passed).toBe(false);
    expect('minOrderQty' in passed).toBe(false);
  });

  it('revalidates list, item, and all product pickers on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockResolvedValue({ id: 'p1' });
    const result = await updateQuoteProductAction('p1', null, fd(baseUpdate));
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/stock-skus');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/stock-skus/p1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/new');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/boms/new');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/customer-pricing',
    );
    expect(revalidatePathMock).not.toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/tiers/new',
    );
  });

  it('建单产品更新不接受自带纸料分类', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductCategoryNodeSummary.mockResolvedValue({
      id: 'cat_byo',
      legacyCategory: ProductCategory.BYO_MATERIAL,
    });

    const result = await updateQuoteProductAction(
      'p1',
      null,
      fd(baseUpdate),
    );

    expect(result.status).toBe('invalid');
    expect(productMock.updateProduct).not.toHaveBeenCalled();
  });
});

describe('setQuoteProductActiveAction', () => {
  it('requires dict:product:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setQuoteProductActiveAction('p1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps a retired-category activation invariant without revalidating', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductActive.mockRejectedValueOnce(
      new MockProductInvariantError(
        '该建单产品属于已退役历史分类，不能重新启用',
      ),
    );
    const r = await setQuoteProductActiveAction(
      'p1',
      true,
    );
    expect(r).toEqual({
      status: 'error',
      message: '该建单产品属于已退役历史分类，不能重新启用',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('rejects a forged deactivation without a reason before the mutation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await setQuoteProductActiveAction('p1', false, fd({ reason: '   ' }));
    expect(r).toEqual({
      status: 'invalid',
      fieldErrors: { reason: ['停用产品必须填写业务理由'] },
    });
    expect(productMock.setProductActive).not.toHaveBeenCalled();
  });

  it('forwards the authorized actor and trimmed audit reason', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductActive.mockResolvedValue({ id: 'p1' });
    await setQuoteProductActiveAction(
      'p1',
      false,
      fd({ reason: '  旧款停产  ' }),
    );
    expect(productMock.setProductActive).toHaveBeenCalledWith('p1', false, {
      actor: ownerActor,
      reason: '旧款停产',
    });
  });

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductActive.mockResolvedValue({ id: 'p1' });
    const r = await setQuoteProductActiveAction(
      'p1',
      false,
      fd({ reason: '旧款停产' }),
    );
    expect(r.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/stock-skus');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/stock-skus/p1',
    );
  });

  it('建单产品启停不可操作已排除的历史分类', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.getProductSummary.mockResolvedValue({
      id: 'p-old',
      category: ProductCategory.STOCK_FOIL_ADD,
    });

    const result = await setQuoteProductActiveAction(
      'p-old',
      false,
      fd({ reason: '历史分类清理' }),
    );

    expect(result.status).toBe('error');
    expect(productMock.setProductActive).not.toHaveBeenCalled();
  });
});
