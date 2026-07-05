import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth/errors';

const { permissionsMock, inventoryMock } = vi.hoisted(() => ({
  permissionsMock: {
    requirePermission: vi.fn(),
  },
  inventoryMock: {
    listInventoryCountMaterials: vi.fn(),
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/inventory-count', () => ({
  listInventoryCountMaterials: inventoryMock.listInventoryCountMaterials,
}));

import { GET } from '../route';

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  inventoryMock.listInventoryCountMaterials.mockReset();
});

describe('GET /api/admin/inventory-count/materials', () => {
  it('reuses material:manage permission and returns inventory count rows', async () => {
    permissionsMock.requirePermission.mockResolvedValue({ id: 'owner1' });
    inventoryMock.listInventoryCountMaterials.mockResolvedValue([
      { id: 'mat1', code: 'PAPER' },
    ]);

    const res = await GET(
      new NextRequest('http://test.local/api/admin/inventory-count/materials?q=PAPER&limit=20'),
    );

    expect(res.status).toBe(200);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'material:manage',
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
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const res = await GET(
      new NextRequest('http://test.local/api/admin/inventory-count/materials'),
    );

    expect(res.status).toBe(401);
    expect(inventoryMock.listInventoryCountMaterials).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: '未登录' });
  });
});
