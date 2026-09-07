import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requirePermissionMock,
  revalidatePathMock,
  testChannelMock,
  getChannelMock,
  enqueueSmartBotChannelTestMock,
} =
  vi.hoisted(() => ({
    requirePermissionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    testChannelMock: vi.fn(),
    getChannelMock: vi.fn(),
    enqueueSmartBotChannelTestMock: vi.fn(),
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
    IneligibleChannelBindError: DomainError,
    RuleNotFoundError: DomainError,
    StaleChannelIdsError: DomainError,
    TooManyChannelsForPrivateEventError: DomainError,
    createChannel: vi.fn(),
    getChannel: getChannelMock,
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
    enqueueSmartBotChannelTest: enqueueSmartBotChannelTestMock,
  };
});

import { TestChannelError } from '@/lib/notification/test-channel';
import { testChannelAction } from '../owner-notifications';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'owner-1' });
  revalidatePathMock.mockReset();
  getChannelMock.mockReset().mockResolvedValue({ transport: 'WECOM_SMART_BOT' });
  testChannelMock.mockReset().mockResolvedValue({ ok: true, mock: true });
  enqueueSmartBotChannelTestMock.mockReset().mockResolvedValue({
    queued: true,
    mock: false,
  });
});

describe('testChannelAction', () => {
  it('blocks stale or forged legacy test requests without sending or queueing', async () => {
    getChannelMock.mockResolvedValue({ transport: 'WECOM_GROUP_WEBHOOK' });
    await expect(testChannelAction('legacy')).resolves.toEqual({
      status: 'error',
      message: '旧版 Webhook 已停止配置和测试，请改用智能机器人目标。',
    });
    expect(testChannelMock).not.toHaveBeenCalled();
    expect(enqueueSmartBotChannelTestMock).not.toHaveBeenCalled();
  });

  it('rejects a deleted target before attempting to send', async () => {
    getChannelMock.mockResolvedValue(null);
    await expect(testChannelAction('missing')).resolves.toEqual({ status: 'error', message: '该群不存在' });
    expect(testChannelMock).not.toHaveBeenCalled();
  });
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

  it('queues a real smart-bot test instead of connecting from the Web action', async () => {
    testChannelMock.mockRejectedValue(
      new TestChannelError('SMART_BOT_WORKER_REQUIRED'),
    );

    await expect(testChannelAction('smart-1')).resolves.toEqual({
      status: 'queued',
      mock: false,
    });
    expect(enqueueSmartBotChannelTestMock).toHaveBeenCalledExactlyOnceWith(
      'smart-1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/notifications');
  });

  it('reports when the connected LIGHT worker is unavailable at enqueue time', async () => {
    testChannelMock.mockRejectedValue(
      new TestChannelError('SMART_BOT_WORKER_REQUIRED'),
    );
    enqueueSmartBotChannelTestMock.mockRejectedValue(
      new TestChannelError('SMART_BOT_WORKER_UNAVAILABLE'),
    );

    await expect(testChannelAction('smart-1')).resolves.toEqual({
      status: 'error',
      message:
        '智能机器人连接尚未就绪，或检测到多个 LIGHT worker，请检查后台任务状态',
    });
    expect(enqueueSmartBotChannelTestMock).toHaveBeenCalledExactlyOnceWith(
      'smart-1',
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ['CHANNEL_NOT_FOUND', '该群不存在'],
    ['CHANNEL_INACTIVE', '该群已停用，请先启用再测试'],
    ['SMART_BOT_NOT_BOUND', '智能机器人尚未绑定企业微信群'],
    [
      'SMART_BOT_IDENTITY_MISMATCH',
      '当前 Bot ID 与该群绑定时不一致；请使用原机器人，或新建通知目标重新绑定',
    ],
    ['CHANNEL_CONFIGURATION_INVALID', '通知目标配置不完整'],
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
    expect(getChannelMock).not.toHaveBeenCalled();
    expect(testChannelMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
