import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';

const { exportMock, permissionsMock } = vi.hoisted(() => {
  class FailedError extends Error {}
  class NotFoundError extends Error {}
  class NotReadyError extends Error {}
  return {
    exportMock: {
      AgentMonthlyBillExportFailedError: FailedError,
      AgentMonthlyBillExportNotFoundError: NotFoundError,
      AgentMonthlyBillExportNotReadyError: NotReadyError,
      prepareAgentMonthlyBillExportDownload: vi.fn(),
    },
    permissionsMock: { requireSessionPermission: vi.fn() },
  };
});

vi.mock('@/lib/auth/config', () => ({ auth: (handler: unknown) => handler }));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/agent-monthly-billing/export', () => exportMock);

import { handleAgentMonthlyBillExportDownload } from '../route';

function request(): NextAuthRequest {
  return Object.assign(
    new NextRequest('http://test.local/api/owner/agent-bills/exports/export-1'),
    { auth: null },
  ) as NextAuthRequest;
}

const context = { params: Promise.resolve({ id: 'export-1' }) };
const actor = { id: 'admin-1', role: 'ADMIN', displayName: '管理员' };

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.requireSessionPermission.mockResolvedValue(actor);
});

describe('GET monthly bill export download', () => {
  it('re-authorizes the current database-backed session', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    const response = await handleAgentMonthlyBillExportDownload(
      request(),
      context,
    );
    expect(response.status).toBe(401);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'bill:view:all',
      null,
    );
    expect(exportMock.prepareAgentMonthlyBillExportDownload).not.toHaveBeenCalled();
  });

  it.each([
    [new exportMock.AgentMonthlyBillExportNotReadyError(), 409],
    [new exportMock.AgentMonthlyBillExportFailedError(), 410],
    [new exportMock.AgentMonthlyBillExportNotFoundError(), 404],
  ])('maps a safe terminal response', async (error, status) => {
    exportMock.prepareAgentMonthlyBillExportDownload.mockRejectedValue(error);
    const response = await handleAgentMonthlyBillExportDownload(
      request(),
      context,
    );
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('private');
  });

  it('streams a private XLSX and does not cache it', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    exportMock.prepareAgentMonthlyBillExportDownload.mockResolvedValue({
      stream: Readable.from([bytes]),
      byteLength: bytes.length,
      fileName: '代理商月账单_20260902.xlsx',
    });
    const response = await handleAgentMonthlyBillExportDownload(
      request(),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Disposition')).toContain(
      encodeURIComponent('代理商月账单_20260902.xlsx'),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});
