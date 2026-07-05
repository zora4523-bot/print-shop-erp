import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  bomMock,
  revalidatePathMock,
  redirectMock,
  MockBomInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  bomMock: {
    createBom: vi.fn(),
    setBomActive: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockBomInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BomInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/bom', () => ({
  createBom: bomMock.createBom,
  setBomActive: bomMock.setBomActive,
  BomInvariantError: MockBomInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import { createBomAction, setBomActiveAction } from '../owner-boms';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: 'OWNER',
  workerType: null,
  machineType: null,
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

const validBom = {
  targetType: 'PRODUCT',
  productId: 'prod1',
  categoryNodeId: '',
  name: '红包标准 BOM',
  version: '1',
  baseQuantity: '1000',
  itemCount: '1',
  'items.0.materialId': 'mat1',
  'items.0.quantity': '500.0000',
  'items.0.remark': '',
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  bomMock.createBom.mockReset();
  bomMock.setBomActive.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createBomAction', () => {
  it("first-line requirePermission('bom:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });

    await expect(createBomAction(null, fd(validBom))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('bom:manage');
    expect(bomMock.createBom).not.toHaveBeenCalled();
  });

  it('passes parsed BOM fields and redirects to detail', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    bomMock.createBom.mockResolvedValue({ id: 'bom1' });

    await expect(createBomAction(null, fd(validBom))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(bomMock.createBom).toHaveBeenCalledWith({
      targetType: 'PRODUCT',
      productId: 'prod1',
      categoryNodeId: null,
      name: '红包标准 BOM',
      version: 1,
      baseQuantity: 1000,
      items: [{ materialId: 'mat1', quantity: '500.0000', remark: null }],
    });
    expect(redirectMock).toHaveBeenCalledWith('/owner/boms/bom1');
  });

  it('maps active product unique violation to productId field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    bomMock.createBom.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['BillOfMaterial_active_product_key'] },
      }),
    );

    const result = await createBomAction(null, fd(validBom));

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.productId).toContain('该产品已有启用 BOM');
    }
  });
});

describe('setBomActiveAction', () => {
  it('requires bom:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });

    await expect(setBomActiveAction('bom1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps invariant errors to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    bomMock.setBomActive.mockRejectedValueOnce(
      new MockBomInvariantError('该产品已有启用 BOM'),
    );

    const result = await setBomActiveAction('bom1', true);

    expect(result).toEqual({ status: 'error', message: '该产品已有启用 BOM' });
  });
});
