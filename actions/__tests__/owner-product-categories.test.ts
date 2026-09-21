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
    createProductCategoryNode: vi.fn(),
    updateProductCategoryNode: vi.fn(),
    setProductCategoryNodeActive: vi.fn(),
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
  createProductCategoryNode: productMock.createProductCategoryNode,
  updateProductCategoryNode: productMock.updateProductCategoryNode,
  setProductCategoryNodeActive: productMock.setProductCategoryNodeActive,
  ProductInvariantError: MockProductInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createRuleCenterProductCategoryNodeAction,
  setProductCategoryNodeActiveAction,
  updateProductCategoryNodeAction,
} from '../owner-product-categories';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validCategory = {
  parentId: 'cat_custom',
  name: '新分类',
  legacyCategory: 'COLOR_PRINT',
  sortOrder: '70',
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  productMock.createProductCategoryNode.mockReset();
  productMock.updateProductCategoryNode.mockReset();
  productMock.setProductCategoryNodeActive.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createRuleCenterProductCategoryNodeAction', () => {
  it("first-line requirePermission('dict:product:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      createRuleCenterProductCategoryNodeAction(null, fd(validCategory)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'dict:product:manage',
    );
    expect(productMock.createProductCategoryNode).not.toHaveBeenCalled();
  });

  it('returns invalid for empty name', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createRuleCenterProductCategoryNodeAction(
      null,
      fd({ ...validCategory, name: '  ' }),
    );
    expect(result.status).toBe('invalid');
    expect(productMock.createProductCategoryNode).not.toHaveBeenCalled();
  });

  it('passes parsed fields to lib.createProductCategoryNode', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockResolvedValue({ id: 'cat1' });
    await expect(
      createRuleCenterProductCategoryNodeAction(null, fd(validCategory)),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(productMock.createProductCategoryNode).toHaveBeenCalledWith({
      parentId: 'cat_custom',
      name: '新分类',
      legacyCategory: ProductCategory.COLOR_PRINT,
      sortOrder: 70,
    });
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1?created=1',
    );
  });

  it('规则中心创建后保持在 canonical 分类路由', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockResolvedValue({ id: 'cat1' });

    await expect(
      createRuleCenterProductCategoryNodeAction(
        null,
        fd({
          ...validCategory,
          routeBase: '/owner/rules/product-categories',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1?created=1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1',
    );
  });

  it('规则中心专用 action 忽略伪造的旧返回路径', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockResolvedValue({ id: 'cat1' });

    await expect(
      createRuleCenterProductCategoryNodeAction(
        null,
        fd({
          ...validCategory,
          routeBase: '/owner/product-categories',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1?created=1',
    );
  });

  it('maps P2002 path collision to a retry-level general error（自动段名，无表单字段可指）', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['path'] },
      }),
    );
    const result = await createRuleCenterProductCategoryNodeAction(null, fd(validCategory));
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('分类创建冲突，请重试');
    }
  });

  it('maps database ltree constraint errors to a general error（表单无 path 字段可指）', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('constraint', {
        code: 'P2004',
        clientVersion: 'test',
      }),
    );
    const result = await createRuleCenterProductCategoryNodeAction(null, fd(validCategory));
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/内部路径校验未通过/);
    }
  });
});

describe('updateProductCategoryNodeAction', () => {
  it('maps ProductInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProductCategoryNode.mockRejectedValueOnce(
      new MockProductInvariantError('目标产品分类不存在'),
    );
    const result = await updateProductCategoryNodeAction(
      'cat1',
      null,
      fd(validCategory),
    );
    expect(result).toEqual({
      status: 'error',
      message: '目标产品分类不存在',
    });
  });

  it('revalidates related product/category paths on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProductCategoryNode.mockResolvedValue({ id: 'cat1' });
    const result = await updateProductCategoryNodeAction(
      'cat1',
      null,
      fd(validCategory),
    );
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/items',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/items/new',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/boms/new');
  });
});

describe('setProductCategoryNodeActiveAction', () => {
  it('requires dict:product:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      setProductCategoryNodeActiveAction('cat1', false),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps a retired-category activation invariant without revalidating', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductCategoryNodeActive.mockRejectedValueOnce(
      new MockProductInvariantError('历史产品分类已退役，不能重新启用'),
    );

    const result = await setProductCategoryNodeActiveAction('cat1', true);

    expect(result).toEqual({
      status: 'error',
      message: '历史产品分类已退役，不能重新启用',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductCategoryNodeActive.mockResolvedValue({ id: 'cat1' });
    const result = await setProductCategoryNodeActiveAction('cat1', false);
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/product-categories/cat1',
    );
  });
});
