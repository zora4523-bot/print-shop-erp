import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';

const { permissionsMock, queryMock } = vi.hoisted(() => ({
  permissionsMock: {
    requireSessionPermission: vi.fn(),
  },
  queryMock: {
    listAgentMonthlyBills: vi.fn(),
    getAgentMonthlyBillingStats: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/agent-monthly-billing/query', () => queryMock);

import { handleAgentMonthlyBillsGet } from '../handler';

function request(query = ''): NextAuthRequest {
  return Object.assign(
    new NextRequest(`http://test.local/api/owner/agent-bills${query}`),
    { auth: null },
  ) as NextAuthRequest;
}

const actor = { id: 'admin-1', role: 'ADMIN', displayName: '管理员' };
const bills = {
  rows: [{ id: 'bill-1', period: '2026-08' }],
  page: 2,
  pageSize: 30,
  total: 31,
  pageCount: 2,
};
const stats = {
  receivableAmount: '88.00',
  receivableBillCount: 1,
  unbilledOrderCount: 2,
  draftBillCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.requireSessionPermission.mockResolvedValue(actor);
  queryMock.listAgentMonthlyBills.mockResolvedValue(bills);
  queryMock.getAgentMonthlyBillingStats.mockResolvedValue(stats);
});

describe('GET /api/owner/agent-bills', () => {
  it('requires the existing all-bills view permission', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const response = await handleAgentMonthlyBillsGet(request());

    expect(response.status).toBe(401);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'bill:view:all',
      null,
    );
    expect(queryMock.listAgentMonthlyBills).not.toHaveBeenCalled();
    expect(queryMock.getAgentMonthlyBillingStats).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: '未授权' });
  });

  it.each([
    '?period=2026-8',
    '?status=UNKNOWN',
    '?agentUserId=has%20space',
    '?page=0',
    '?page=1&page=2',
  ])('rejects malformed or repeated filters before querying: %s', async (query) => {
    const response = await handleAgentMonthlyBillsGet(request(query));

    expect(response.status).toBe(400);
    expect(queryMock.listAgentMonthlyBills).not.toHaveBeenCalled();
    expect(queryMock.getAgentMonthlyBillingStats).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: '筛选条件不合法',
    });
  });

  it('returns paginated bills and workspace stats with private no-store headers', async () => {
    const response = await handleAgentMonthlyBillsGet(
      request('?period=2026-08&status=CONFIRMED&agentUserId=agent-1&page=2'),
    );

    expect(queryMock.listAgentMonthlyBills).toHaveBeenCalledWith({
      period: '2026-08',
      status: AgentMonthlyBillStatus.CONFIRMED,
      agentUserId: 'agent-1',
      page: 2,
    });
    expect(queryMock.getAgentMonthlyBillingStats).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({ bills, stats });
  });
});
