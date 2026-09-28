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
vi.mock('@/lib/warehouse-maintenance', async (importOriginal) => { const original = await importOriginal<typeof import('@/lib/warehouse-maintenance')>(); return { ...original, maintainWarehouse: vi.fn() }; });
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  maintainWarehouseAction,
  createWarehouseAction,
  createWarehouseLocationAction,
} from '../owner-warehouses';

import { maintainWarehouse } from '@/lib/warehouse-maintenance';

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
  vi.mocked(maintainWarehouse).mockReset();
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
    }, ownerActor.id);
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
    }, ownerActor.id);
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
    }, ownerActor.id);
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
    }, ownerActor.id);
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

describe('maintainWarehouseAction', () => {
  const input = { kind: 'location', id: 'loc1', operation: 'disable', expectedUpdatedAt: '2026-09-27T00:00:00.000Z' };
  it('checks permission before parsing or calling the domain', async () => {
    permissionsMock.requirePermission.mockRejectedValue(new UnauthorizedError('无权限'));
    await expect(maintainWarehouseAction(null, fd(input))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(maintainWarehouse).not.toHaveBeenCalled();
  });
  it('validates the expected version and names', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    expect((await maintainWarehouseAction(null, fd({ ...input, expectedUpdatedAt: 'invalid' }))).status).toBe('invalid');
    expect((await maintainWarehouseAction(null, fd({ ...input, operation: 'rename', name: ' ' }))).status).toBe('invalid');
    expect(maintainWarehouse).not.toHaveBeenCalled();
  });
  it('passes actor and facts to domain and invalidates every stock selector consumer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    await expect(maintainWarehouseAction(null, fd(input))).resolves.toEqual({ status: 'success', message: '已停用' });
    expect(maintainWarehouse).toHaveBeenCalledWith({ ...input, name: undefined }, ownerActor.id);
    for (const path of ['/owner/materials/[id]', '/owner/rules/papers/[id]', '/foreman/materials/[id]', '/owner/purchases/[id]']) expect(revalidatePathMock).toHaveBeenCalledWith(path, 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials/count');
  });
  it('returns conflicts without success or invalidation', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    vi.mocked(maintainWarehouse).mockRejectedValue(new MockWarehouseInvariantError('仍有库存'));
    expect(await maintainWarehouseAction(null, fd(input))).toEqual({ status: 'error', message: '仍有库存' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
