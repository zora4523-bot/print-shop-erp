import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';

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

import { handleInventoryCountMaterialsGet } from '@/app/api/admin/inventory-count/materials/handler';

function request(url: string): NextAuthRequest {
  return Object.assign(new NextRequest(url), { auth: null }) as NextAuthRequest;
}

beforeEach(() => {
  permissionsMock.requireSessionPermission.mockReset();
  inventoryMock.listInventoryCountMaterials.mockReset();
});

describe('P2 regression: inventory-count limit validation', () => {
  it('returns 400 and never queries for an invalid limit', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue({ id: 'owner1' });
    inventoryMock.listInventoryCountMaterials.mockResolvedValue([]);

    const response = await handleInventoryCountMaterialsGet(
      request(
        'http://test.local/api/admin/inventory-count/materials?limit=abc',
      ),
    );
    expect(response.status).toBe(400);
    expect(inventoryMock.listInventoryCountMaterials).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'limit 必须是 1 到 100 之间的整数',
    });
  });
});
