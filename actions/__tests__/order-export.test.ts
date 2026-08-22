import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  backgroundJobsModeMock,
  exportMock,
  permissionsMock,
  revalidatePathMock,
  MockInvalidOrderExportRequestError,
} = vi.hoisted(() => ({
  backgroundJobsModeMock: vi.fn(),
  exportMock: {
    requestOrderExport: vi.fn(),
    processOrderExportInline: vi.fn(),
  },
  permissionsMock: { requirePermission: vi.fn() },
  revalidatePathMock: vi.fn(),
  MockInvalidOrderExportRequestError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidOrderExportRequestError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: backgroundJobsModeMock,
}));
vi.mock('@/lib/order/export', () => ({
  InvalidOrderExportRequestError: MockInvalidOrderExportRequestError,
  ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH: 10_000,
  processOrderExportInline: exportMock.processOrderExportInline,
  requestOrderExport: exportMock.requestOrderExport,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { requestOrderExportAction } from '../order-export';

const ownerActor = {
  id: 'owner-1',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

function fd(data: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(data)) formData.set(key, value);
  return formData;
}

function validForm(overrides: Record<string, string> = {}): FormData {
  return fd({
    requestKey: 'export-request-1',
    scope: 'filtered',
    params: JSON.stringify({ status: 'SUBMITTED', q: '中秋' }),
    ...overrides,
  });
}

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  backgroundJobsModeMock.mockReset();
  exportMock.requestOrderExport.mockReset();
  exportMock.processOrderExportInline.mockReset();
  revalidatePathMock.mockReset();
});

describe('requestOrderExportAction', () => {
  it("checks order:export:all before validating even an empty request", async () => {
    permissionsMock.requirePermission.mockRejectedValueOnce(
      new UnauthorizedError('未登录'),
    );

    await expect(requestOrderExportAction(null, new FormData())).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'order:export:all',
    );
    expect(backgroundJobsModeMock).not.toHaveBeenCalled();
    expect(exportMock.requestOrderExport).not.toHaveBeenCalled();
    expect(exportMock.processOrderExportInline).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing request key',
      formData: fd({ scope: 'all', params: '{}' }),
    },
    {
      name: 'unsupported scope',
      formData: validForm({ scope: 'mine' }),
    },
  ])('rejects an incomplete request: $name', async ({ formData }) => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    await expect(requestOrderExportAction(null, formData)).resolves.toEqual({
      status: 'invalid',
      message: '导出请求不完整，请刷新页面后重试',
    });

    expect(exportMock.requestOrderExport).not.toHaveBeenCalled();
    expect(backgroundJobsModeMock).not.toHaveBeenCalled();
  });

  it('rejects params larger than the action boundary limit', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    await expect(
      requestOrderExportAction(
        null,
        validForm({ params: 'x'.repeat(10_001) }),
      ),
    ).resolves.toEqual({ status: 'invalid', message: '筛选条件过长' });

    expect(exportMock.requestOrderExport).not.toHaveBeenCalled();
    expect(backgroundJobsModeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a non-string parameter value', '{"status":1}'],
  ])('rejects invalid params: %s', async (_name, params) => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    await expect(
      requestOrderExportAction(null, validForm({ params })),
    ).resolves.toEqual({ status: 'invalid', message: '筛选条件不合法' });

    expect(exportMock.requestOrderExport).not.toHaveBeenCalled();
    expect(backgroundJobsModeMock).not.toHaveBeenCalled();
  });

  it('queues a durable export and leaves HEAVY processing to the worker', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('durable');
    exportMock.requestOrderExport.mockResolvedValue({
      id: 'export-1',
      status: 'PENDING',
    });

    const result = await requestOrderExportAction(
      null,
      validForm({
        requestKey: '  export-request-1  ',
        params: '{"status":"SUBMITTED","q":"中秋"}',
      }),
    );

    expect(result).toEqual({ status: 'queued', exportId: 'export-1' });
    expect(exportMock.requestOrderExport).toHaveBeenCalledWith({
      actor: ownerActor,
      requestKey: 'export-request-1',
      scope: 'filtered',
      params: { status: 'SUBMITTED', q: '中秋' },
      durable: true,
    });
    expect(exportMock.processOrderExportInline).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
  });

  it('passes a valid 501-character multi-value filter through to the domain', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('durable');
    exportMock.requestOrderExport.mockResolvedValue({
      id: 'export-long-filter',
      status: 'PENDING',
    });
    const foilColor = [
      ...Array.from(
        { length: 100 },
        (_, index) => `色${String(index).padStart(3, '0')}`,
      ),
      '金',
    ].join(',');
    expect(foilColor).toHaveLength(501);

    await expect(
      requestOrderExportAction(
        null,
        validForm({ params: JSON.stringify({ foilColor }) }),
      ),
    ).resolves.toEqual({ status: 'queued', exportId: 'export-long-filter' });

    expect(exportMock.requestOrderExport).toHaveBeenCalledWith(
      expect.objectContaining({ params: { foilColor } }),
    );
  });

  it('processes a newly pending export inline outside durable mode', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('inline');
    exportMock.requestOrderExport.mockResolvedValue({
      id: 'export-2',
      status: 'PENDING',
    });
    exportMock.processOrderExportInline.mockResolvedValue(undefined);

    const result = await requestOrderExportAction(null, validForm());

    expect(result).toEqual({ status: 'success', exportId: 'export-2' });
    expect(exportMock.requestOrderExport).toHaveBeenCalledWith(
      expect.objectContaining({ durable: false }),
    );
    expect(exportMock.processOrderExportInline).toHaveBeenCalledOnce();
    expect(exportMock.processOrderExportInline).toHaveBeenCalledWith('export-2');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
  });

  it('reuses an already materialized inline export without processing it again', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('inline');
    exportMock.requestOrderExport.mockResolvedValue({
      id: 'export-ready',
      status: 'READY',
    });

    await expect(requestOrderExportAction(null, validForm())).resolves.toEqual({
      status: 'success',
      exportId: 'export-ready',
    });

    expect(exportMock.processOrderExportInline).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders');
  });

  it('maps InvalidOrderExportRequestError to the public invalid result', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('durable');
    exportMock.requestOrderExport.mockRejectedValueOnce(
      new MockInvalidOrderExportRequestError('筛选条件与导出范围不一致'),
    );

    await expect(requestOrderExportAction(null, validForm())).resolves.toEqual({
      status: 'invalid',
      message: '筛选条件与导出范围不一致',
    });

    expect(exportMock.processOrderExportInline).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected failures instead of misreporting invalid input', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    backgroundJobsModeMock.mockReturnValue('durable');
    const unexpected = new Error('database unavailable');
    exportMock.requestOrderExport.mockRejectedValueOnce(unexpected);

    await expect(requestOrderExportAction(null, validForm())).rejects.toBe(
      unexpected,
    );

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
