import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
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
  ProductInvariantError: MockProductInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createProductAction,
  updateProductAction,
  setProductActiveAction,
} from '../owner-products';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: 'OWNER',
  workerType: null,
  machineType: null,
};

const validCreate = {
  code: '',
  categoryNodeId: 'cat_blank_stock',
  name: '空白红包',
  specification: '',
  paperType: '',
  baseUnitPrice: '0.12',
  minOrderQty: '1000',
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
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createProductAction', () => {
  it("first-line requirePermission('dict:product:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createProductAction(null, fd(validCreate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('dict:product:manage');
    expect(productMock.createProduct).not.toHaveBeenCalled();
  });

  it('returns invalid on schema failure (empty name)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createProductAction(
      null,
      fd({ ...validCreate, name: '' }),
    );
    expect(result.status).toBe('invalid');
    expect(productMock.createProduct).not.toHaveBeenCalled();
  });

  it('passes parsed Decimal string + int minOrderQty to lib.createProduct', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(createProductAction(null, fd(validCreate))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(productMock.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryNodeId: 'cat_blank_stock',
        code: null,
        name: '空白红包',
        specification: null,
        paperType: null,
        baseUnitPrice: '0.12',
        minOrderQty: 1000,
      }),
    );
  });

  it('passes optional product code through', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(
      createProductAction(null, fd({ ...validCreate, code: 'HB001' })),
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
    const result = await createProductAction(
      null,
      fd({ ...validCreate, code: 'HB001' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该产品编码已被占用');
    }
  });

  it('converts empty minOrderQty / baseUnitPrice into undefined / null', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(
      createProductAction(
        null,
        fd({ ...validCreate, baseUnitPrice: '', minOrderQty: '' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const arg = productMock.createProduct.mock.calls[0][0];
    expect(arg.baseUnitPrice).toBeNull();
    expect(arg.minOrderQty).toBeUndefined();
  });

  it('rejects >4-decimal baseUnitPrice (schema refine)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createProductAction(
      null,
      fd({ ...validCreate, baseUnitPrice: '1.23456' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.baseUnitPrice).toBeDefined();
    }
  });

  it('revalidates + redirects to new product edit page on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.createProduct.mockResolvedValue({ id: 'p1' });
    await expect(createProductAction(null, fd(validCreate))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products');
    expect(redirectMock).toHaveBeenCalledWith('/owner/products/p1');
  });
});

describe('updateProductAction', () => {
  const baseUpdate = { ...validCreate };

  it('requires dict:product:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updateProductAction('p1', null, fd(baseUpdate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps ProductInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockRejectedValueOnce(
      new MockProductInvariantError('目标产品不存在'),
    );
    const result = await updateProductAction('p1', null, fd(baseUpdate));
    expect(result.status).toBe('error');
  });

  it('does not forward isActive to lib.updateProduct (activation is owned by setProductActive)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockResolvedValue({ id: 'p1' });
    // Even if an isActive=on field sneaks through FormData, the schema strips it.
    await updateProductAction('p1', null, fd({ ...baseUpdate, isActive: 'on' }));
    const passed = productMock.updateProduct.mock.calls[0][1] as Record<string, unknown>;
    expect('isActive' in passed).toBe(false);
  });

  it('revalidates both list + item on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.updateProduct.mockResolvedValue({ id: 'p1' });
    const result = await updateProductAction('p1', null, fd(baseUpdate));
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products/p1');
  });
});

describe('setProductActiveAction', () => {
  it('requires dict:product:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setProductActiveAction('p1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps invariant to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductActive.mockRejectedValueOnce(
      new MockProductInvariantError('目标产品不存在'),
    );
    const r = await setProductActiveAction('p1', false);
    expect(r.status).toBe('error');
  });

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    productMock.setProductActive.mockResolvedValue({ id: 'p1' });
    const r = await setProductActiveAction('p1', false);
    expect(r.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/products');
  });
});
