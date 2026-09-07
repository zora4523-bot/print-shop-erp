import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';

const { requireSessionPermissionMock, getAdminOrderByOrderNoMock, getSettingMock, inlineOperationsMock } = vi.hoisted(
  () => ({
    requireSessionPermissionMock: vi.fn(),
    getAdminOrderByOrderNoMock: vi.fn(),
    getSettingMock: vi.fn(),
    inlineOperationsMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: requireSessionPermissionMock,
}));
vi.mock('@/lib/order/admin-workspace', () => ({
  getAdminOrderByOrderNo: getAdminOrderByOrderNoMock,
}));
vi.mock('@/lib/settings', () => ({ getSetting: getSettingMock }));
vi.mock('@/lib/order/admin-inline-operations', () => ({ getAdminOrderInlineOperations: inlineOperationsMock }));

import { handleAdminOrderWorkspaceDetail } from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionPermissionMock.mockResolvedValue({
    id: 'admin-1',
    role: Role.ADMIN,
  });
  getAdminOrderByOrderNoMock.mockResolvedValue({
    id: 'order-1',
    orderNo: 'GD-260902-001',
  });
  getSettingMock.mockResolvedValue({ days: 2 });
  inlineOperationsMock.mockResolvedValue(null);
});

describe('admin order workspace detail route', () => {
  it('requires the centralized all-order permission', async () => {
    requireSessionPermissionMock.mockRejectedValue(
      new UnauthorizedError('无权访问'),
    );
    const response = await handleAdminOrderWorkspaceDetail(
      { auth: null } as never,
      { params: Promise.resolve({ orderNo: 'GD-260902-001' }) },
    );
    expect(response.status).toBe(401);
    expect(getAdminOrderByOrderNoMock).not.toHaveBeenCalled();
    expect(inlineOperationsMock).not.toHaveBeenCalled();
  });

  it('defends the ADMIN-only boundary after permission resolution', async () => {
    requireSessionPermissionMock.mockResolvedValue({
      id: 'sales-1',
      role: Role.SALES,
    });
    const response = await handleAdminOrderWorkspaceDetail(
      { auth: {} } as never,
      { params: Promise.resolve({ orderNo: 'GD-260902-001' }) },
    );
    expect(response.status).toBe(403);
    expect(getAdminOrderByOrderNoMock).not.toHaveBeenCalled();
    expect(inlineOperationsMock).not.toHaveBeenCalled();
  });

  it('returns only the explicit safe DTO with no-store headers', async () => {
    const response = await handleAdminOrderWorkspaceDetail(
      { auth: {} } as never,
      { params: Promise.resolve({ orderNo: 'GD-260902-001' }) },
    );
    expect(requireSessionPermissionMock).toHaveBeenCalledWith(
      'order:view:all',
      {},
    );
    expect(getAdminOrderByOrderNoMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', role: Role.ADMIN }),
      'GD-260902-001',
      expect.any(Date),
      2,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      order: { id: 'order-1', orderNo: 'GD-260902-001', inlineOperations: null },
    });
  });

  it('does not reveal whether an inaccessible order exists', async () => {
    getAdminOrderByOrderNoMock.mockResolvedValue(null);
    const response = await handleAdminOrderWorkspaceDetail(
      { auth: {} } as never,
      { params: Promise.resolve({ orderNo: 'missing' }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: '工单不存在或无权访问',
    });
  });
});
