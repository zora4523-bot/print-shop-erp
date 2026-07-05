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
  createProductCategoryNodeAction,
  setProductCategoryNodeActiveAction,
  updateProductCategoryNodeAction,
} from '../owner-product-categories';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: 'OWNER',
  workerType: null,
  machineType: null,
};

const validCategory = {
  path: 'product.custom.new',
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

describe('createProductCategoryNodeAction', () => {
  it("first-line requirePermission('dict:product:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      createProductCategoryNodeAction(null, fd(validCategory)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'dict:product:manage',
    );
    expect(productMock.createProductCategoryNode).not.toHaveBeenCalled();
  });

  it('returns invalid for non-ltree-safe path', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createProductCategoryNodeAction(
      null,
      fd({ ...validCategory, path: 'bad path' }),
    );
    expect(result.status).toBe('invalid');
    expect(productMock.createProductCategoryNode).not.toHaveBeenCalled();
  });

  it('passes parsed fields to lib.createProductCategoryNode', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockResolvedValue({ id: 'cat1' });
    await expect(
      createProductCategoryNodeAction(null, fd(validCategory)),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(productMock.createProductCategoryNode).toHaveBeenCalledWith({
      path: 'product.custom.new',
      name: '新分类',
      legacyCategory: ProductCategory.COLOR_PRINT,
      sortOrder: 70,
    });
    expect(redirectMock).toHaveBeenCalledWith('/owner/product-categories/cat1');
  });

  it('maps P2002 path conflict to invalid.path', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['path'] },
      }),
    );
    const result = await createProductCategoryNodeAction(null, fd(validCategory));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.path).toContain('该分类路径已被占用');
    }
  });

  it('maps database ltree constraint errors to invalid.path', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProductCategoryNode.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('constraint', {
        code: 'P2004',
        clientVersion: 'test',
      }),
    );
    const result = await createProductCategoryNodeAction(null, fd(validCategory));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.path).toContain(
        '分类路径不符合 PostgreSQL ltree 格式要求',
      );
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
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/product-categories');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/product-categories/cat1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products/new');
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

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductCategoryNodeActive.mockResolvedValue({ id: 'cat1' });
    const result = await setProductCategoryNodeActiveAction('cat1', false);
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/product-categories');
  });
});
