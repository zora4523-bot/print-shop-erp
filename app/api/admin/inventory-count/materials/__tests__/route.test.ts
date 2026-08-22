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

import { handleInventoryCountMaterialsGet } from '../route';

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
});
