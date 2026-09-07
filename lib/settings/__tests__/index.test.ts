import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type SettingsTransactionMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  notificationChannel: { findMany: ReturnType<typeof vi.fn> };
  setting: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

const { dbMock, txMock, auditMock } = vi.hoisted(() => {
  const tx: SettingsTransactionMock = {
    $queryRaw: vi.fn(),
    notificationChannel: { findMany: vi.fn() },
    setting: { findMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    txMock: tx,
    dbMock: {
      $transaction: vi.fn(
        async (
          fn: (transaction: SettingsTransactionMock) => Promise<unknown>,
        ) => fn(tx),
      ),
    },
    auditMock: { write: vi.fn() },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLogInTx: auditMock.write,
}));

import { smartBotIdDigest } from '../../notification/smart-bot-identity';
import { SettingValidationError, updateSettings } from '../index';

function webhookChannel(id: string, isActive = true) {
  return {
    id,
    transport: 'WECOM_GROUP_WEBHOOK',
    webhookUrl: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${id}`,
    smartBotBotDigest: null,
    smartBotTargetId: null,
    smartBotChatType: null,
    smartBotBoundAt: null,
    isActive,
  };
}

function smartBotChannel(id: string, botDigest: string, isActive = true) {
  return {
    id,
    transport: 'WECOM_SMART_BOT',
    webhookUrl: null,
    smartBotBotDigest: botDigest,
    smartBotTargetId: `group-${id}`,
    smartBotChatType: 'GROUP',
    smartBotBoundAt: new Date('2026-09-04T00:00:00.000Z'),
    isActive,
  };
}

beforeEach(() => {
  dbMock.$transaction.mockClear();
  txMock.$queryRaw.mockReset().mockResolvedValue([]);
  txMock.notificationChannel.findMany.mockReset();
  txMock.setting.findMany.mockReset().mockResolvedValue([]);
  txMock.setting.upsert.mockReset().mockResolvedValue({});
  auditMock.write.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('updateSettings management notification channel validation', () => {
  const routing = {
    factoryConfirmer: { enabled: true, channelIds: ['factory-channel'] },
    owner: { enabled: true, channelIds: ['owner-channel'] },
  };

  it('事务内锁定并确认所有绑定都是 active channel', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      webhookChannel('factory-channel'),
      webhookChannel('owner-channel'),
    ]);

    await updateSettings({ management_notification_routing: routing });

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = Array.from(
      txMock.$queryRaw.mock.calls[0]![0] as readonly string[],
    ).join(' ');
    expect(sql).toMatch(/NotificationChannel/);
    expect(sql).toMatch(/ORDER BY id\s+FOR UPDATE/);
    expect(txMock.notificationChannel.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['factory-channel', 'owner-channel'] } },
      select: {
        id: true,
        transport: true,
        webhookUrl: true,
        smartBotBotDigest: true,
        smartBotTargetId: true,
        smartBotChatType: true,
        smartBotBoundAt: true,
        isActive: true,
      },
    });
    expect(txMock.setting.upsert).toHaveBeenCalledTimes(1);
  });

  it('删除或停用的 ID 使整份设置不落库', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      webhookChannel('factory-channel'),
    ]);

    await expect(
      updateSettings({ management_notification_routing: routing }),
    ).rejects.toMatchObject({
      name: 'SettingValidationError',
      key: 'management_notification_routing',
    } satisfies Partial<SettingValidationError>);
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
    expect(auditMock.write).not.toHaveBeenCalled();
  });

  it('拒绝新绑 Bot ID 不一致的 active 智能机器人目标', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    txMock.notificationChannel.findMany.mockResolvedValue([
      smartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await expect(
      updateSettings({
        management_notification_routing: {
          factoryConfirmer: { enabled: true, channelIds: ['smart-old'] },
          owner: { enabled: false, channelIds: [] },
        },
      }),
    ).rejects.toMatchObject({
      name: 'SettingValidationError',
      key: 'management_notification_routing',
    });
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('已有的不可用角色绑定可保留，但不能借此新绑到另一角色', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    const previousRouting = {
      factoryConfirmer: { enabled: true, channelIds: ['smart-old'] },
      owner: { enabled: false, channelIds: [] },
    };
    txMock.setting.findMany.mockResolvedValue([
      {
        key: 'management_notification_routing',
        value: previousRouting,
      },
    ]);
    txMock.notificationChannel.findMany.mockResolvedValue([
      smartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await expect(
      updateSettings({ management_notification_routing: previousRouting }),
    ).resolves.toBeUndefined();

    await expect(
      updateSettings({
        management_notification_routing: {
          ...previousRouting,
          owner: { enabled: true, channelIds: ['smart-old'] },
        },
      }),
    ).rejects.toBeInstanceOf(SettingValidationError);
  });

  it('关闭角色携已有不合格目标重新启用时拒绝', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    const previousRouting = {
      factoryConfirmer: { enabled: false, channelIds: ['smart-old'] },
      owner: { enabled: false, channelIds: [] },
    };
    txMock.setting.findMany.mockResolvedValue([
      {
        key: 'management_notification_routing',
        value: previousRouting,
      },
    ]);
    txMock.notificationChannel.findMany.mockResolvedValue([
      smartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await expect(
      updateSettings({ management_notification_routing: previousRouting }),
    ).resolves.toBeUndefined();

    await expect(
      updateSettings({
        management_notification_routing: {
          ...previousRouting,
          factoryConfirmer: {
            enabled: true,
            channelIds: ['smart-old'],
          },
        },
      }),
    ).rejects.toBeInstanceOf(SettingValidationError);
  });

  it('两个角色都关闭且无群时不做无意义的 channel 查询', async () => {
    await updateSettings({
      management_notification_routing: {
        factoryConfirmer: { enabled: false, channelIds: [] },
        owner: { enabled: false, channelIds: [] },
      },
    });

    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.notificationChannel.findMany).not.toHaveBeenCalled();
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });
});
