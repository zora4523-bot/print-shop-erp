import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requirePermissionMock, retryMock, revalidatePathMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  retryMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({ requirePermission: requirePermissionMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/background-jobs/repository', () => {
  class RetiredBackgroundJobTypeError extends Error {
    constructor(public readonly type: string) {
      super(`retired background job type: ${type}`);
    }
  }
  return {
    RetiredBackgroundJobTypeError,
    cancelPendingBackgroundJob: vi.fn(),
    retryDeadBackgroundJob: retryMock,
  };
});

import { retryBackgroundJobAction } from '../background-jobs';
import { RetiredBackgroundJobTypeError } from '@/lib/background-jobs/repository';

function form(jobId: string): FormData {
  const data = new FormData();
  data.set('jobId', jobId);
  return data;
}

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'owner-1' });
  retryMock.mockReset();
  revalidatePathMock.mockReset();
});

describe('retryBackgroundJobAction', () => {
  it('checks permission first and reports a successful requeue', async () => {
    retryMock.mockResolvedValue(true);
    await expect(retryBackgroundJobAction(null, form('job-1'))).resolves.toEqual({
      status: 'success',
      message: '已重新入队',
    });
    expect(requirePermissionMock).toHaveBeenCalledWith('ops:jobs:manage');
  });

  it('explains in Chinese that a retired job type can no longer be retried', async () => {
    retryMock.mockRejectedValue(new RetiredBackgroundJobTypeError('CRON_CS_SETTLE'));
    const result = await retryBackgroundJobAction(null, form('job-2'));
    expect(result).toEqual({
      status: 'error',
      message: expect.stringContaining('已停用'),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/background-jobs');
  });

  it('rethrows unknown errors', async () => {
    retryMock.mockRejectedValue(new Error('db down'));
    await expect(retryBackgroundJobAction(null, form('job-3'))).rejects.toThrow('db down');
  });
});
