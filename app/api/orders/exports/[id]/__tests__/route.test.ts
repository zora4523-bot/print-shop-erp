import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';

const { exportMock, permissionsMock } = vi.hoisted(() => {
  class OrderExportFailedError extends Error {}
  class OrderExportNotFoundError extends Error {}
  class OrderExportNotReadyError extends Error {}

  return {
    exportMock: {
      OrderExportFailedError,
      OrderExportNotFoundError,
      OrderExportNotReadyError,
      prepareOrderExportDownload: vi.fn(),
    },
    permissionsMock: {
      requireSessionPermission: vi.fn(),
    },
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requireSessionPermission: permissionsMock.requireSessionPermission,
}));
vi.mock('@/lib/order/export', () => exportMock);

import { handleOrderExportDownload } from '../route';

function request(): NextAuthRequest {
  return Object.assign(
    new NextRequest('http://test.local/api/orders/exports/export-1'),
    { auth: null },
  ) as NextAuthRequest;
}

function context(id = 'export-1') {
  return { params: Promise.resolve({ id }) };
}

const actor = { id: 'admin-1', role: 'ADMIN', displayName: '管理员' };

beforeEach(() => {
  permissionsMock.requireSessionPermission.mockReset();
  exportMock.prepareOrderExportDownload.mockReset();
});

describe('GET /api/orders/exports/[id]', () => {
  it('requires the all-orders export permission', async () => {
    permissionsMock.requireSessionPermission.mockRejectedValue(
      new UnauthorizedError('未登录'),
    );

    const response = await handleOrderExportDownload(request(), context());

    expect(response.status).toBe(401);
    expect(permissionsMock.requireSessionPermission).toHaveBeenCalledWith(
      'order:export:all',
      null,
    );
    expect(exportMock.prepareOrderExportDownload).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: '未授权' });
  });

  it('returns a retryable conflict while the export is not ready', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    exportMock.prepareOrderExportDownload.mockRejectedValue(
      new exportMock.OrderExportNotReadyError(),
    );

    const response = await handleOrderExportDownload(
      request(),
      context('pending-export'),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(exportMock.prepareOrderExportDownload).toHaveBeenCalledWith(
      'pending-export',
      actor,
    );
    await expect(response.json()).resolves.toEqual({
      error: '导出文件正在生成',
    });
  });

  it('returns a non-retryable terminal response when generation failed', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    exportMock.prepareOrderExportDownload.mockRejectedValue(
      new exportMock.OrderExportFailedError(),
    );

    const response = await handleOrderExportDownload(
      request(),
      context('failed-export'),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(exportMock.prepareOrderExportDownload).toHaveBeenCalledWith(
      'failed-export',
      actor,
    );
    await expect(response.json()).resolves.toEqual({
      error: '导出文件生成失败，请重新导出',
    });
  });

  it('does not reveal whether an export is absent, expired, or belongs to another actor', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    exportMock.prepareOrderExportDownload.mockRejectedValue(
      new exportMock.OrderExportNotFoundError(),
    );

    const response = await handleOrderExportDownload(
      request(),
      context('invisible-export'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: '导出文件不存在或已过期',
    });
  });

  it('streams a private XLSX attachment with exact headers and body', async () => {
    permissionsMock.requireSessionPermission.mockResolvedValue(actor);
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    exportMock.prepareOrderExportDownload.mockResolvedValue({
      stream: Readable.from([bytes]),
      byteLength: bytes.byteLength,
      fileName: '工单 导出 2026.xlsx',
    });

    const response = await handleOrderExportDownload(
      request(),
      context('ready-export'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('Content-Length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="2026.xlsx"; filename*=UTF-8''${encodeURIComponent('工单 导出 2026.xlsx')}`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});
