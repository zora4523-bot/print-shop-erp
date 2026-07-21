import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  warehouseMock,
  revalidatePathMock,
  MockWarehouseInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  warehouseMock: {
    createWarehouse: vi.fn(),
    createWarehouseLocation: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  MockWarehouseInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WarehouseInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/warehouse', () => ({
  createWarehouse: warehouseMock.createWarehouse,
  createWarehouseLocation: warehouseMock.createWarehouseLocation,
  WarehouseInvariantError: MockWarehouseInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  createWarehouseAction,
  createWarehouseLocationAction,
} from '../owner-warehouses';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  warehouseMock.createWarehouse.mockReset();
  warehouseMock.createWarehouseLocation.mockReset();
  revalidatePathMock.mockReset();
});

describe('createWarehouseAction', () => {
  it('passes null to the library when code is left for automatic generation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouse.mockResolvedValue({ id: 'wh1' });

    const result = await createWarehouseAction(
      null,
      fd({ code: '', name: '自动编码仓库' }),
    );

    expect(result.status).toBe('success');
    expect(warehouseMock.createWarehouse).toHaveBeenCalledWith({
      code: null,
      name: '自动编码仓库',
    });
  });

  it("first-line requirePermission('warehouse:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });

    await expect(
      createWarehouseAction(null, fd({ code: 'WH1', name: '一号仓' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'warehouse:manage',
    );
    expect(warehouseMock.createWarehouse).not.toHaveBeenCalled();
  });

  it('passes parsed warehouse fields to lib.createWarehouse', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouse.mockResolvedValue({ id: 'wh1' });

    const result = await createWarehouseAction(
      null,
      fd({ code: 'WH1', name: '一号仓' }),
    );

    expect(result.status).toBe('success');
    expect(warehouseMock.createWarehouse).toHaveBeenCalledWith({
      code: 'WH1',
      name: '一号仓',
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/warehouses');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/materials/[id]',
      'page',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/purchases/[id]',
      'page',
    );
  });

  it('maps duplicate warehouse code to invalid.code field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouse.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );

    const result = await createWarehouseAction(
      null,
      fd({ code: 'WH1', name: '一号仓' }),
    );

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该仓库编码已被占用');
    }
  });
});

describe('createWarehouseLocationAction', () => {
  it('passes null to the library when code is left for automatic generation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouseLocation.mockResolvedValue({ id: 'loc1' });

    const result = await createWarehouseLocationAction(
      null,
      fd({ warehouseId: 'wh1', code: '', name: '自动编码库位' }),
    );

    expect(result.status).toBe('success');
    expect(warehouseMock.createWarehouseLocation).toHaveBeenCalledWith({
      warehouseId: 'wh1',
      code: null,
      name: '自动编码库位',
    });
  });

  it('passes parsed location fields to lib.createWarehouseLocation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouseLocation.mockResolvedValue({ id: 'loc1' });

    const result = await createWarehouseLocationAction(
      null,
      fd({ warehouseId: 'wh1', code: 'A01', name: 'A01' }),
    );

    expect(result.status).toBe('success');
    expect(warehouseMock.createWarehouseLocation).toHaveBeenCalledWith({
      warehouseId: 'wh1',
      code: 'A01',
      name: 'A01',
    });
  });

  it('maps warehouse invariant errors to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    warehouseMock.createWarehouseLocation.mockRejectedValueOnce(
      new MockWarehouseInvariantError('仓库已停用'),
    );

    const result = await createWarehouseLocationAction(
      null,
      fd({ warehouseId: 'wh1', code: 'A01', name: 'A01' }),
    );

    expect(result).toEqual({ status: 'error', message: '仓库已停用' });
  });
});
