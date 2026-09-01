import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const { dbMock, requirePermissionMock, revalidatePathMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findFirst: vi.fn() },
    userOrderStar: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
  requirePermissionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { setOrderStarredAction } from '../order-workspace';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({
    id: 'admin-1',
    role: Role.ADMIN,
  });
  dbMock.order.findFirst.mockResolvedValue({ id: 'order-1' });
  dbMock.userOrderStar.upsert.mockResolvedValue({});
  dbMock.userOrderStar.deleteMany.mockResolvedValue({ count: 1 });
});

describe('setOrderStarredAction', () => {
  it('checks the centralized all-order permission before validating input', async () => {
    const result = await setOrderStarredAction({ orderId: '', starred: true });
    expect(requirePermissionMock).toHaveBeenCalledWith('order:view:all');
    expect(result).toEqual({ status: 'invalid', message: '星标请求不合法' });
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('idempotently adds a personal star and revalidates the workspace', async () => {
    const result = await setOrderStarredAction({
      orderId: 'order-1',
      starred: true,
    });
    expect(dbMock.userOrderStar.upsert).toHaveBeenCalledWith({
      where: {
        userId_orderId: { userId: 'admin-1', orderId: 'order-1' },
      },
      create: { userId: 'admin-1', orderId: 'order-1' },
      update: {},
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
    expect(result).toEqual({
      status: 'success',
      orderId: 'order-1',
      starred: true,
    });
  });

  it('removes only the current user star', async () => {
    await setOrderStarredAction({ orderId: 'order-1', starred: false });
    expect(dbMock.userOrderStar.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', orderId: 'order-1' },
    });
    expect(dbMock.userOrderStar.upsert).not.toHaveBeenCalled();
  });

  it('does not write when the scoped order is missing', async () => {
    dbMock.order.findFirst.mockResolvedValue(null);
    const result = await setOrderStarredAction({
      orderId: 'missing',
      starred: true,
    });
    expect(result).toEqual({
      status: 'not-found',
      message: '工单不存在或无权访问',
    });
    expect(dbMock.userOrderStar.upsert).not.toHaveBeenCalled();
  });
});
