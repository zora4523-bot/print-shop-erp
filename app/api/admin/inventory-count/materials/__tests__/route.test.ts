import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';

const { permissionsMock, inventoryMock } = vi.hoisted(() => ({
  permissionsMock: {
    requireSessionPermission: vi.fn(),
  },
  inventoryMock: {
    listInventoryCountMaterials: vi.fn(),
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/inventory-count', () => ({
  listInventoryCountMaterials: inventoryMock.listInventoryCountMaterials,
}));

import { handleInventoryCountMaterialsGet } from '../handler';

function request(url: string): NextAuthRequest {
  return Object.assign(new NextRequest(url), { auth: null }) as NextAuthRequest;
}

beforeEach(() => {
  permissionsMock.requireSessionPermission.mockReset();
  inventoryMock.listInventoryCountMaterials.mockReset();
});

describe('GET /api/admin/inventory-count/materials', () => {
  it('reuses material:manage permission and returns inventory count rows', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });
    inventoryMock.listInventoryCountMaterials.mockResolvedValue([
      { id: 'mat1', code: 'PAPER' },
    ]);

    const res = await handleInventoryCountMaterialsGet(
      request('http://test.local/api/admin/inventory-count/materials?q=PAPER&limit=20'),
    );

    expect(res.status).toBe(200);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'material:manage',
      null,
    );
    expect(inventoryMock.listInventoryCountMaterials).toHaveBeenCalledWith({
      q: 'PAPER',
      limit: 20,
    });
    await expect(res.json()).resolves.toEqual({
      materials: [{ id: 'mat1', code: 'PAPER' }],
    });
  });

  it('returns 401 when the shared permission guard rejects the request', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const res = await handleInventoryCountMaterialsGet(
      request('http://test.local/api/admin/inventory-count/materials'),
    );

    expect(res.status).toBe(401);
    expect(inventoryMock.listInventoryCountMaterials).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: '未登录' });
  });

  it.each([
    '',
    'abc',
    '10x',
    '1.5',
    '0',
    '-1',
    '101',
    '9007199254740992',
  ])('returns 400 for invalid limit %j without querying', async (limit) => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });

    const res = await handleInventoryCountMaterialsGet(
      request(
        `http://test.local/api/admin/inventory-count/materials?limit=${encodeURIComponent(limit)}`,
      ),
    );

    expect(res.status).toBe(400);
    expect(inventoryMock.listInventoryCountMaterials).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: 'limit 必须是 1 到 100 之间的整数',
    });
  });

  it('returns 400 when limit is repeated', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });

    const res = await handleInventoryCountMaterialsGet(
      request(
        'http://test.local/api/admin/inventory-count/materials?limit=10&limit=20',
      ),
    );

    expect(res.status).toBe(400);
    expect(inventoryMock.listInventoryCountMaterials).not.toHaveBeenCalled();
  });

  it.each([1, 100])('accepts limit boundary %i', async (limit) => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });
    inventoryMock.listInventoryCountMaterials.mockResolvedValue([]);

    const res = await handleInventoryCountMaterialsGet(
      request(
        `http://test.local/api/admin/inventory-count/materials?limit=${limit}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(inventoryMock.listInventoryCountMaterials).toHaveBeenCalledWith({
      q: '',
      limit,
    });
  });

  it('uses the service default when limit is absent', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });
    inventoryMock.listInventoryCountMaterials.mockResolvedValue([]);

    const res = await handleInventoryCountMaterialsGet(
      request('http://test.local/api/admin/inventory-count/materials'),
    );

    expect(res.status).toBe(200);
    expect(inventoryMock.listInventoryCountMaterials).toHaveBeenCalledWith({
      q: '',
      limit: undefined,
    });
  });
});
