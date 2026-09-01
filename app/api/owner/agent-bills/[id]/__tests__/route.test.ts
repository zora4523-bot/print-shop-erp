import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';

const { permissionsMock, queryMock } = vi.hoisted(() => ({
  permissionsMock: {
    requireSessionPermission: vi.fn(),
  },
  queryMock: {
    getAgentMonthlyBillDetail: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/agent-monthly-billing/query', () => queryMock);

import { handleAgentMonthlyBillDetailGet } from '../route';

function request(): NextAuthRequest {
  return Object.assign(
    new NextRequest('http://test.local/api/owner/agent-bills/bill-1'),
    { auth: null },
  ) as NextAuthRequest;
}

function context(id = 'bill-1') {
  return { params: Promise.resolve({ id }) };
}

const actor = { id: 'admin-1', role: 'ADMIN', displayName: '管理员' };
const bill = {
  id: 'bill-1',
  period: '2026-08',
  status: 'CONFIRMED',
  totalAmount: '88.00',
};

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.requireSessionPermission.mockResolvedValue(actor);
  queryMock.getAgentMonthlyBillDetail.mockResolvedValue(bill);
});

describe('GET /api/owner/agent-bills/[id]', () => {
  it('requires the existing all-bills view permission', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const response = await handleAgentMonthlyBillDetailGet(
      request(),
      context(),
    );

    expect(response.status).toBe(401);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'bill:view:all',
      null,
    );
    expect(queryMock.getAgentMonthlyBillDetail).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: '未授权' });
  });

  it.each(['', 'has space', 'x'.repeat(129)])(
    'rejects an invalid bill id before querying: %j',
    async (id) => {
      const response = await handleAgentMonthlyBillDetailGet(
        request(),
        context(id),
      );

      expect(response.status).toBe(400);
      expect(queryMock.getAgentMonthlyBillDetail).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: '账单标识不合法',
      });
    },
  );

  it('returns 404 for an absent bill', async () => {
    queryMock.getAgentMonthlyBillDetail.mockResolvedValue(null);

    const response = await handleAgentMonthlyBillDetailGet(
      request(),
      context('missing'),
    );

    expect(response.status).toBe(404);
    expect(queryMock.getAgentMonthlyBillDetail).toHaveBeenCalledWith('missing');
    await expect(response.json()).resolves.toEqual({ error: '账单不存在' });
  });

  it('returns the detail DTO with private no-store headers', async () => {
    const response = await handleAgentMonthlyBillDetailGet(
      request(),
      context(),
    );

    expect(queryMock.getAgentMonthlyBillDetail).toHaveBeenCalledWith('bill-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({ bill });
  });
});
