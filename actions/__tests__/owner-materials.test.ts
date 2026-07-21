import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { MaterialCategory, TxDirection } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  materialMock,
  revalidatePathMock,
  redirectMock,
  MockMaterialInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  materialMock: {
    createMaterial: vi.fn(),
    updateMaterial: vi.fn(),
    setMaterialActive: vi.fn(),
    createMaterialTransaction: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockMaterialInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MaterialInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/material', () => ({
  createMaterial: materialMock.createMaterial,
  updateMaterial: materialMock.updateMaterial,
  setMaterialActive: materialMock.setMaterialActive,
  createMaterialTransaction: materialMock.createMaterialTransaction,
  MaterialInvariantError: MockMaterialInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createMaterialAction,
  createMaterialTransactionAction,
  setMaterialActiveAction,
  updateMaterialAction,
} from '../owner-materials';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validMaterial = {
  code: 'PAPER-A4',
  name: 'A4 白卡纸',
  category: 'PAPER',
  specification: '250g A4',
  unit: '张',
  safetyStock: '2.00',
  averageCost: '0.1200',
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  materialMock.createMaterial.mockReset();
  materialMock.updateMaterial.mockReset();
  materialMock.setMaterialActive.mockReset();
  materialMock.createMaterialTransaction.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createMaterialAction', () => {
  it('passes null to the library when code is left for automatic generation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'mat1' });

    await expect(
      createMaterialAction(null, fd({ ...validMaterial, code: '' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(materialMock.createMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ code: null }),
    );
  });

  it("first-line requirePermission('material:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createMaterialAction(null, fd(validMaterial))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('material:manage');
    expect(materialMock.createMaterial).not.toHaveBeenCalled();
  });

  it('returns invalid on schema failure', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createMaterialAction(
      null,
      fd({ ...validMaterial, name: '' }),
    );
    expect(result.status).toBe('invalid');
    expect(materialMock.createMaterial).not.toHaveBeenCalled();
  });

  it('passes parsed material fields to lib.createMaterial', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'mat1' });
    await expect(createMaterialAction(null, fd(validMaterial))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(materialMock.createMaterial).toHaveBeenCalledWith({
      code: 'PAPER-A4',
      name: 'A4 白卡纸',
      category: MaterialCategory.PAPER,
      specification: '250g A4',
      unit: '张',
      safetyStock: '2.00',
      averageCost: '0.1200',
    });
  });

  it('redirects to the foreman route when form routeBase asks for it', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'mat1' });
    await expect(
      createMaterialAction(
        null,
        fd({ ...validMaterial, routeBase: '/foreman/materials' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith('/foreman/materials/mat1');
  });

  it('maps P2002 on material code to invalid.code field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );
    const result = await createMaterialAction(null, fd(validMaterial));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该物料编码已被占用');
    }
  });
});

describe('updateMaterialAction', () => {
  it('requires material:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updateMaterialAction('mat1', null, fd(validMaterial))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps MaterialInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.updateMaterial.mockRejectedValueOnce(
      new MockMaterialInvariantError('目标物料不存在'),
    );
    const result = await updateMaterialAction('mat1', null, fd(validMaterial));
    expect(result.status).toBe('error');
  });

  it('does not forward currentStock or isActive through basic edit', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.updateMaterial.mockResolvedValue({ id: 'mat1' });
    await updateMaterialAction(
      'mat1',
      null,
      fd({ ...validMaterial, currentStock: '999', isActive: 'on' }),
    );
    const passed = materialMock.updateMaterial.mock.calls[0][1] as Record<string, unknown>;
    expect('currentStock' in passed).toBe(false);
    expect('isActive' in passed).toBe(false);
  });

  it('revalidates material pages and required-material pickers on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.updateMaterial.mockResolvedValue({ id: 'mat1' });
    const result = await updateMaterialAction('mat1', null, fd(validMaterial));
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials/mat1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/materials');
    expect(revalidatePathMock).toHaveBeenCalledWith('/foreman/materials/mat1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/purchases/new');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/boms/new');
  });
});

describe('setMaterialActiveAction', () => {
  it('requires material:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setMaterialActiveAction('mat1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps invariant to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.setMaterialActive.mockRejectedValueOnce(
      new MockMaterialInvariantError('目标物料不存在'),
    );
    const result = await setMaterialActiveAction('mat1', false);
    expect(result.status).toBe('error');
  });
});

describe('createMaterialTransactionAction', () => {
  const validTx = {
    direction: 'OUT',
    quantity: '3.50',
    reasonType: 'PRODUCTION_USE',
    unitCost: '',
    remark: '工单消耗',
  };

  it('requires material:manage and uses actor id as operatorId', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterialTransaction.mockResolvedValue({});
    const result = await createMaterialTransactionAction(
      'mat1',
      null,
      fd(validTx),
    );
    expect(result.status).toBe('success');
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('material:manage');
    expect(materialMock.createMaterialTransaction).toHaveBeenCalledWith({
      materialId: 'mat1',
      locationId: null,
      direction: TxDirection.OUT,
      quantity: '3.50',
      reasonType: 'PRODUCTION_USE',
      unitCost: null,
      remark: '工单消耗',
      operatorId: 'actor-owner',
    });
  });

  it('returns invalid for zero quantity', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createMaterialTransactionAction(
      'mat1',
      null,
      fd({ ...validTx, quantity: '0' }),
    );
    expect(result.status).toBe('invalid');
    expect(materialMock.createMaterialTransaction).not.toHaveBeenCalled();
  });

  it('maps negative-stock invariant to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterialTransaction.mockRejectedValueOnce(
      new MockMaterialInvariantError('库存不足，不能出库到负数'),
    );
    const result = await createMaterialTransactionAction(
      'mat1',
      null,
      fd(validTx),
    );
    expect(result).toEqual({
      status: 'error',
      message: '库存不足，不能出库到负数',
    });
  });
});
