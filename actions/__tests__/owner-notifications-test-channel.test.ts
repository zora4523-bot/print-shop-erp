import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requirePermissionMock, revalidatePathMock, testChannelMock } =
  vi.hoisted(() => ({
    requirePermissionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    testChannelMock: vi.fn(),
  }));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/notification/admin', () => {
  class DomainError extends Error {}
  return {
    ChannelInUseError: DomainError,
    EmptyChannelIdsError: DomainError,
    InactiveChannelBindError: DomainError,
    RuleNotFoundError: DomainError,
    StaleChannelIdsError: DomainError,
    TooManyChannelsForPrivateEventError: DomainError,
    createChannel: vi.fn(),
    deleteChannel: vi.fn(),
    updateChannel: vi.fn(),
    updateRuleWithGuard: vi.fn(),
  };
});
vi.mock('@/lib/notification/resolve', () => ({
  UnknownNotificationResolutionError: class extends Error {},
  resolveUnknownNotification: vi.fn(),
}));
vi.mock('@/lib/notification/test-channel', () => {
  class TestError extends Error {
    constructor(public readonly code: string) {
      super(`cannot test notification channel: ${code}`);
    }
  }
  return {
    TestChannelError: TestError,
    testChannel: testChannelMock,
  };
});

import { TestChannelError } from '@/lib/notification/test-channel';
import { testChannelAction } from '../owner-notifications';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'owner-1' });
  revalidatePathMock.mockReset();
  testChannelMock.mockReset().mockResolvedValue({ ok: true, mock: true });
});

describe('testChannelAction', () => {
  it('authorizes, delegates to lib and revalidates the owner log page', async () => {
    await expect(testChannelAction('channel-1')).resolves.toEqual({
      status: 'success',
      mock: true,
    });

    expect(requirePermissionMock).toHaveBeenCalledExactlyOnceWith(
      'notification:config',
    );
    expect(testChannelMock).toHaveBeenCalledExactlyOnceWith('channel-1');
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith(
      '/owner/notifications',
    );
  });

  it('returns a sender failure reason without duplicating the UI prefix', async () => {
    testChannelMock.mockResolvedValue({
      ok: false,
      mock: false,
      errorMessage: 'http 500',
    });

    await expect(testChannelAction('channel-1')).resolves.toEqual({
      status: 'error',
      message: 'http 500',
    });
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith(
      '/owner/notifications',
    );
  });

  it.each([
    ['CHANNEL_NOT_FOUND', '该群不存在'],
    ['CHANNEL_INACTIVE', '该群已停用，请先启用再测试'],
    [
      'LOG_WRITE_FAILED',
      '测试推送结果未能写入日志，请检查数据库后再核对群消息',
    ],
  ] as const)('maps %s to its owner-facing message', async (code, message) => {
    testChannelMock.mockRejectedValue(new TestChannelError(code));

    await expect(testChannelAction('channel-1')).resolves.toEqual({
      status: 'error',
      message,
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected infrastructure errors', async () => {
    testChannelMock.mockRejectedValue(new Error('database unavailable'));

    await expect(testChannelAction('channel-1')).rejects.toThrow(
      'database unavailable',
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('does not touch lib when authorization fails', async () => {
    requirePermissionMock.mockRejectedValue(new Error('forbidden'));

    await expect(testChannelAction('channel-1')).rejects.toThrow('forbidden');
    expect(testChannelMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
