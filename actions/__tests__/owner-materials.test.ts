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
  MockMaterialUnitChangeError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  materialMock: {
    createMaterial: vi.fn(),
    updateMaterial: vi.fn(),
    setMaterialActive: vi.fn(),
    createMaterialTransaction: vi.fn(),
    getMaterialSummary: vi.fn(),
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
  MockMaterialUnitChangeError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MaterialUnitChangeError';
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
  getMaterialSummary: materialMock.getMaterialSummary,
  MaterialInvariantError: MockMaterialInvariantError,
  MaterialUnitChangeError: MockMaterialUnitChangeError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createMaterialAction,
  createNonPaperMaterialAction,
  createPaperAction,
  createPaperTransactionAction,
  createMaterialTransactionAction,
  setPaperActiveAction,
  setMaterialActiveAction,
  updatePaperAction,
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
  materialMock.getMaterialSummary.mockReset();
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

  it('keeps paper creation inside the rule center', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'mat1' });

    await expect(
      createMaterialAction(
        null,
        fd({ ...validMaterial, routeBase: '/owner/rules/papers' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith('/owner/rules/papers/mat1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/papers');
  });

  it('纸张专用 action 强制 PAPER 分类与 canonical 返回路径', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'paper-1' });

    await expect(
      createPaperAction(
        null,
        fd({
          ...validMaterial,
          category: MaterialCategory.OTHER,
          routeBase: '/owner/materials',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(materialMock.createMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ category: MaterialCategory.PAPER }),
    );
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/papers/paper-1',
    );
  });

  it('通用物料字典的专用 action 拒绝纸张分类', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    const result = await createNonPaperMaterialAction(
      null,
      fd({ ...validMaterial, routeBase: '/foreman/materials' }),
    );

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        category: ['纸张请在规则配置中心统一维护'],
      },
    });
    expect(materialMock.createMaterial).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('通用物料字典的专用 action 将非纸张物料固定返回旧物料详情', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.createMaterial.mockResolvedValue({ id: 'foil-1' });

    await expect(
      createNonPaperMaterialAction(
        null,
        fd({
          ...validMaterial,
          category: MaterialCategory.FOIL,
          routeBase: '/foreman/materials',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(materialMock.createMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ category: MaterialCategory.FOIL }),
    );
    expect(redirectMock).toHaveBeenCalledWith('/owner/materials/foil-1');
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

  it('纸张专用更新不允许修改分类或跨类编辑', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.getMaterialSummary.mockResolvedValue({
      id: 'paper-1',
      category: MaterialCategory.PAPER,
    });
    materialMock.updateMaterial.mockResolvedValue({ id: 'paper-1' });

    await updatePaperAction(
      'paper-1',
      null,
      fd({ ...validMaterial, category: MaterialCategory.OTHER }),
    );
    expect(materialMock.updateMaterial).toHaveBeenCalledWith(
      'paper-1',
      expect.objectContaining({ category: MaterialCategory.PAPER }),
    );

    materialMock.getMaterialSummary.mockResolvedValue({
      id: 'foil-1',
      category: MaterialCategory.FOIL,
    });
    const result = await updatePaperAction(
      'foil-1',
      null,
      fd(validMaterial),
    );
    expect(result.status).toBe('error');
    expect(materialMock.updateMaterial).toHaveBeenCalledTimes(1);
  });

  it('maps MaterialInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.updateMaterial.mockRejectedValueOnce(
      new MockMaterialInvariantError('目标物料不存在'),
    );
    const result = await updateMaterialAction('mat1', null, fd(validMaterial));
    expect(result.status).toBe('error');
  });

  it('maps an immutable unit change to the unit field', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.updateMaterial.mockRejectedValueOnce(
      new MockMaterialUnitChangeError('物料创建后不能修改单位；如需新单位，请新建物料'),
    );

    const result = await updateMaterialAction(
      'mat1',
      null,
      fd({ ...validMaterial, unit: '卷' }),
    );

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        unit: ['物料创建后不能修改单位；如需新单位，请新建物料'],
      },
    });
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

  it('纸张专用启停 action 拒绝非纸张 ID', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.getMaterialSummary.mockResolvedValue({
      id: 'foil-1',
      category: MaterialCategory.FOIL,
    });

    const result = await setPaperActiveAction('foil-1', false);

    expect(result.status).toBe('error');
    expect(materialMock.setMaterialActive).not.toHaveBeenCalled();
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
    idempotencyKey: 'bd0e055a-ed96-4aeb-93c3-b92b8e0cffed',
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
      idempotencyKey: validTx.idempotencyKey,
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

  it.each(['', 'not-a-request-key'])('rejects a missing or malformed request key before any stock write: %s', async (idempotencyKey) => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createMaterialTransactionAction('mat1', null, fd({ ...validTx, idempotencyKey }));
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

  it('纸张专用库存 action 拒绝非纸张 ID', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    materialMock.getMaterialSummary.mockResolvedValue({
      id: 'bag-1',
      category: MaterialCategory.BAG,
    });

    const result = await createPaperTransactionAction(
      'bag-1',
      null,
      fd(validTx),
    );

    expect(result.status).toBe('error');
    expect(materialMock.createMaterialTransaction).not.toHaveBeenCalled();
  });
});
