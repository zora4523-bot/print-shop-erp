import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { SettingValidationError, updateSettings } from '../index';

beforeEach(() => {
  dbMock.$transaction.mockClear();
  txMock.$queryRaw.mockReset().mockResolvedValue([]);
  txMock.notificationChannel.findMany.mockReset();
  txMock.setting.findMany.mockReset().mockResolvedValue([]);
  txMock.setting.upsert.mockReset().mockResolvedValue({});
  auditMock.write.mockReset().mockResolvedValue(undefined);
});

describe('updateSettings management notification channel validation', () => {
  const routing = {
    factoryConfirmer: { enabled: true, channelIds: ['factory-channel'] },
    owner: { enabled: true, channelIds: ['owner-channel'] },
  };

  it('事务内锁定并确认所有绑定都是 active channel', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'factory-channel' },
      { id: 'owner-channel' },
    ]);

    await updateSettings({ management_notification_routing: routing });

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = Array.from(
      txMock.$queryRaw.mock.calls[0]![0] as readonly string[],
    ).join(' ');
    expect(sql).toMatch(/NotificationChannel/);
    expect(sql).toMatch(/ORDER BY id\s+FOR UPDATE/);
    expect(txMock.notificationChannel.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['factory-channel', 'owner-channel'] },
        isActive: true,
      },
      select: { id: true },
    });
    expect(txMock.setting.upsert).toHaveBeenCalledTimes(1);
  });

  it('删除或停用的 ID 使整份设置不落库', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'factory-channel' },
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
