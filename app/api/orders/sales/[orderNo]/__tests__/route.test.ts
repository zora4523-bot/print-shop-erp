import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { Role } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';

const { permissionsMock, salesOrderMock } = vi.hoisted(() => ({
  permissionsMock: { requireSessionPermission: vi.fn() },
  salesOrderMock: { getSalesOrderByOrderNo: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/order/sales-list-query', () => salesOrderMock);

import { handleSalesOrderDetail } from '../route';

function request(): NextAuthRequest {
  return Object.assign(
    new NextRequest('http://test.local/api/orders/sales/GD-260827-001'),
    { auth: null },
  ) as NextAuthRequest;
}

function context(orderNo = 'GD-260827-001') {
  return { params: Promise.resolve({ orderNo }) };
}

beforeEach(() => {
  permissionsMock.requireSessionPermission.mockReset();
  salesOrderMock.getSalesOrderByOrderNo.mockReset();
});

describe('GET /api/orders/sales/[orderNo]', () => {
  it('requires a verified self-view session', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const response = await handleSalesOrderDetail(request(), context());

    expect(response.status).toBe(401);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'order:view:self',
      null,
    );
    expect(salesOrderMock.getSalesOrderByOrderNo).not.toHaveBeenCalled();
  });

  it('keeps the endpoint exclusive to the sales workspace', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue({
      id: 'worker-1',
      role: Role.WORKER,
    });

    const response = await handleSalesOrderDetail(request(), context());

    expect(response.status).toBe(403);
    expect(salesOrderMock.getSalesOrderByOrderNo).not.toHaveBeenCalled();
  });

  it('does not reveal whether an order is absent or belongs to another sales user', async () => {
    const actor = { id: 'sales-1', role: Role.SALES };
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    salesOrderMock.getSalesOrderByOrderNo.mockResolvedValue(null);

    const response = await handleSalesOrderDetail(
      request(),
      context('GD-OTHER'),
    );

    expect(response.status).toBe(404);
    expect(salesOrderMock.getSalesOrderByOrderNo).toHaveBeenCalledWith(
      actor,
      'GD-OTHER',
    );
    await expect(response.json()).resolves.toEqual({
      error: '工单不存在或无权访问',
    });
  });

  it('returns only the sales-safe DTO as a private response', async () => {
    const actor = { id: 'sales-1', role: Role.SALES };
    const order = { id: 'order-1', orderNo: 'GD-260827-001' };
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    salesOrderMock.getSalesOrderByOrderNo.mockResolvedValue(order);

    const response = await handleSalesOrderDetail(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({ order });
  });
});
