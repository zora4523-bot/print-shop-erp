import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const { requirePermissionMock, resolveMock, revalidatePathMock } = vi.hoisted(
  () => ({
    requirePermissionMock: vi.fn(),
    resolveMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

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
    deleteChannel: vi.fn(),
    updateChannel: vi.fn(),
    updateRuleWithGuard: vi.fn(),
  };
});
vi.mock('@/lib/notification/resolve', () => {
  class ResolutionError extends Error {
    constructor(public readonly code: string) {
      super(`cannot resolve unknown notification: ${code}`);
    }
  }
  return {
    UnknownNotificationResolutionError: ResolutionError,
    resolveUnknownNotification: resolveMock,
  };
});
vi.mock('@/lib/notification/test-channel', () => ({
  TestChannelError: class extends Error {},
  testChannel: vi.fn(),
}));

import {
  confirmUnknownNotificationDeliveredAction,
  ignoreUnknownNotificationAction,
  retryUnknownNotificationAction,
} from '../owner-notifications';
import { UnknownNotificationResolutionError } from '@/lib/notification/resolve';

const actor = {
  id: 'owner-1',
  role: Role.ADMIN,
  username: 'owner',
  displayName: '管理员',
  workerType: null,
  machineType: null,
};

function form(logId = 'log-1', stateVersion = '7', reason?: string) {
  const data = new FormData();
  data.set('logId', logId);
  data.set('stateVersion', stateVersion);
  if (reason !== undefined) data.set('reason', reason);
  return data;
}

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue(actor);
  resolveMock.mockReset().mockResolvedValue({
    backgroundJobId: null,
    pendingUnknownCount: 0,
    rearmed: false,
    completed: true,
  });
  revalidatePathMock.mockReset();
});

describe('UNKNOWN notification resolution actions', () => {
  it('authenticates first and forwards the current owner into delivered audit resolution', async () => {
    await expect(
      confirmUnknownNotificationDeliveredAction(null, form()),
    ).resolves.toEqual({
      status: 'success',
      message: '已记录人工核对：消息已送达',
    });

    expect(requirePermissionMock).toHaveBeenCalledExactlyOnceWith(
      'notification:config',
    );
    expect(resolveMock).toHaveBeenCalledExactlyOnceWith(
      'log-1',
      'DELIVERED',
      actor,
      7,
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ['/owner/notifications'],
      ['/owner/background-jobs'],
    ]);
  });

  it('uses the explicit not-delivered resolution and refreshes both ledgers', async () => {
    resolveMock.mockResolvedValue({
      backgroundJobId: 'job-1',
      pendingUnknownCount: 0,
      rearmed: true,
      completed: false,
    });

    await expect(retryUnknownNotificationAction(null, form())).resolves.toEqual({
      status: 'success',
      message: '已按原任务内容与原投递目标重新入队',
    });

    expect(resolveMock).toHaveBeenCalledExactlyOnceWith(
      'log-1',
      'NOT_DELIVERED_RETRY',
      actor,
      7,
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ['/owner/notifications'],
      ['/owner/background-jobs'],
    ]);
  });

  it('requires an ignore reason and forwards the trimmed reason into the audited domain decision', async () => {
    await expect(
      ignoreUnknownNotificationAction(
        null,
        form('log-1', '7', '  业务已电话确认  '),
      ),
    ).resolves.toEqual({
      status: 'success',
      message: '已记录忽略理由并关闭该条待办',
    });

    expect(resolveMock).toHaveBeenCalledExactlyOnceWith(
      'log-1',
      'IGNORED',
      actor,
      7,
      '业务已电话确认',
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ['/owner/notifications'],
      ['/owner/background-jobs'],
    ]);
  });

  it('rejects IGNORE without a reason after authorization and before domain mutation', async () => {
    await expect(
      ignoreUnknownNotificationAction(null, form('log-1', '7', '   ')),
    ).resolves.toEqual({
      status: 'error',
      message: '请填写 1–500 字的忽略理由',
    });

    expect(requirePermissionMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('maps a concurrent stale submit to an actionable refresh message', async () => {
    resolveMock.mockRejectedValue(
      new UnknownNotificationResolutionError('CONFLICT'),
    );

    await expect(
      confirmUnknownNotificationDeliveredAction(null, form()),
    ).resolves.toEqual({
      status: 'error',
      message: '该推送已被其他管理员处置，请刷新后核对',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('fails closed instead of rebuilding an inline UNKNOWN message', async () => {
    resolveMock.mockRejectedValue(
      new UnknownNotificationResolutionError('NOT_DURABLE'),
    );

    await expect(retryUnknownNotificationAction(null, form())).resolves.toEqual({
      status: 'error',
      message: '该记录没有可重放的原后台任务，只能核对后确认已送达',
    });
  });

  it('rejects an empty log id after permission checking', async () => {
    await expect(retryUnknownNotificationAction(null, form('  '))).resolves.toEqual({
      status: 'error',
      message: '推送日志状态参数无效',
    });
    expect(requirePermissionMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('does not suppress an unexpected infrastructure error', async () => {
    resolveMock.mockRejectedValue(new Error('database unavailable'));
    await expect(
      retryUnknownNotificationAction(null, form()),
    ).rejects.toThrow('database unavailable');
  });

  it('explains that a retired event can only be confirmed or ignored', async () => {
    resolveMock.mockRejectedValue(new UnknownNotificationResolutionError('RETIRED_EVENT'));

    const result = await retryUnknownNotificationAction(null, form());
    expect(result.status).toBe('error');
    expect(result.status === 'error' ? result.message : '').toContain('已停用');
  });
});
