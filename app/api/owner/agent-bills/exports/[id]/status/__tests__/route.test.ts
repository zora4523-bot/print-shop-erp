import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/errors';

const { exportMock, permissionsMock } = vi.hoisted(() => {
  class NotFoundError extends Error {}
  return {
    exportMock: {
      AgentMonthlyBillExportNotFoundError: NotFoundError,
      getAgentMonthlyBillExportStatus: vi.fn(),
    },
    permissionsMock: { requireSessionPermission: vi.fn() },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: (handler: unknown) => handler }));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/agent-monthly-billing/export', () => exportMock);

import { handleAgentMonthlyBillExportStatus } from '../handler';

const context = { params: Promise.resolve({ id: 'export-1' }) };
const actor = { id: 'admin-1', role: 'ADMIN', displayName: '管理员' };

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.requireSessionPermission.mockResolvedValue(actor);
  exportMock.getAgentMonthlyBillExportStatus.mockResolvedValue({
    id: 'export-1',
    status: 'PENDING',
  });
});

describe('GET monthly bill export status', () => {
  it('requires the existing all-bills permission', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    const response = await handleAgentMonthlyBillExportStatus(
      { auth: null } as never,
      context,
    );
    expect(response.status).toBe(401);
    expect(exportMock.getAgentMonthlyBillExportStatus).not.toHaveBeenCalled();
  });

  it('does not reveal another actor export', async () => {
    exportMock.getAgentMonthlyBillExportStatus.mockRejectedValue(
      new exportMock.AgentMonthlyBillExportNotFoundError(),
    );
    const response = await handleAgentMonthlyBillExportStatus(
      { auth: {} } as never,
      context,
    );
    expect(response.status).toBe(404);
  });

  it('returns a private no-store status receipt', async () => {
    const response = await handleAgentMonthlyBillExportStatus(
      { auth: {} } as never,
      context,
    );
    expect(exportMock.getAgentMonthlyBillExportStatus).toHaveBeenCalledWith(
      'export-1',
      actor,
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({
      export: { id: 'export-1', status: 'PENDING' },
    });
  });
});
