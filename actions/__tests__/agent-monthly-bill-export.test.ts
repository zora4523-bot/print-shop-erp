import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/errors';

const {
  backgroundJobsModeMock,
  exportMock,
  permissionsMock,
  revalidatePathMock,
  InvalidRequestError,
} = vi.hoisted(() => ({
  backgroundJobsModeMock: vi.fn(),
  exportMock: {
    requestAgentMonthlyBillExport: vi.fn(),
    processAgentMonthlyBillExportInline: vi.fn(),
  },
  permissionsMock: { requirePermission: vi.fn() },
  revalidatePathMock: vi.fn(),
  InvalidRequestError: class extends Error {},
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: backgroundJobsModeMock,
}));
vi.mock('@/lib/agent-monthly-billing/export', () => ({
  InvalidAgentMonthlyBillExportRequestError: InvalidRequestError,
  requestAgentMonthlyBillExport: exportMock.requestAgentMonthlyBillExport,
  processAgentMonthlyBillExportInline:
    exportMock.processAgentMonthlyBillExportInline,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { requestAgentMonthlyBillExportAction } from '../agent-monthly-bill-export';

const actor = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
};

function form(values: Record<string, string> = {}): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    requestKey: '5ba4ce49-6a55-4c27-b876-f6b6edae13a4',
    period: '2026-08',
    status: 'CONFIRMED',
    agentUserId: 'agent-1',
    ...values,
  })) {
    result.set(key, value);
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionsMock.requirePermission.mockResolvedValue(actor);
  backgroundJobsModeMock.mockReturnValue('durable');
  exportMock.requestAgentMonthlyBillExport.mockResolvedValue({
    id: 'export-1',
    status: 'PENDING',
  });
});

describe('requestAgentMonthlyBillExportAction', () => {
  it('authorizes before parsing untrusted form input', async () => {
    permissionsMock.requirePermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );
    await expect(
      requestAgentMonthlyBillExportAction(null, new FormData()),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'bill:manage',
    );
    expect(exportMock.requestAgentMonthlyBillExport).not.toHaveBeenCalled();
  });

  it('rejects an unknown status at the action boundary', async () => {
    await expect(
      requestAgentMonthlyBillExportAction(null, form({ status: 'UNKNOWN' })),
    ).resolves.toEqual({ status: 'invalid', message: '导出状态不合法' });
    expect(exportMock.requestAgentMonthlyBillExport).not.toHaveBeenCalled();
  });

  it('queues the normalized filter on the durable HEAVY path', async () => {
    await expect(
      requestAgentMonthlyBillExportAction(null, form()),
    ).resolves.toEqual({ status: 'queued', exportId: 'export-1' });
    expect(exportMock.requestAgentMonthlyBillExport).toHaveBeenCalledWith({
      actor,
      requestKey: '5ba4ce49-6a55-4c27-b876-f6b6edae13a4',
      filter: {
        period: '2026-08',
        status: 'CONFIRMED',
        agentUserId: 'agent-1',
      },
      durable: true,
    });
    expect(exportMock.processAgentMonthlyBillExportInline).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/agent-bills');
  });

  it('materializes pending exports inline outside durable mode', async () => {
    backgroundJobsModeMock.mockReturnValue('inline');
    await expect(
      requestAgentMonthlyBillExportAction(null, form()),
    ).resolves.toEqual({ status: 'success', exportId: 'export-1' });
    expect(exportMock.processAgentMonthlyBillExportInline).toHaveBeenCalledWith(
      'export-1',
    );
  });

  it('maps a domain validation failure without exposing an internal error', async () => {
    exportMock.requestAgentMonthlyBillExport.mockRejectedValue(
      new InvalidRequestError('账期不合法'),
    );
    await expect(
      requestAgentMonthlyBillExportAction(null, form()),
    ).resolves.toEqual({ status: 'invalid', message: '账期不合法' });
  });

  it('keeps a recoverable inline failure on the current page without disclosing errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    backgroundJobsModeMock.mockReturnValue('inline');
    exportMock.processAgentMonthlyBillExportInline.mockRejectedValueOnce(new Error('private filesystem path'));
    const result = await requestAgentMonthlyBillExportAction(null, form());
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/agent-bills');
    log.mockRestore();
  });
});
