import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, settingsMock } = vi.hoisted(() => ({
  dbMock: { notificationChannel: { findMany: vi.fn() } },
  settingsMock: { getSetting: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/settings', () => ({ getSetting: settingsMock.getSetting }));

import {
  MANAGEMENT_NOTIFICATION_ROLE_BY_EVENT,
  managementNotificationRoleForEvent,
} from '../events';
import {
  listManagementNotificationChannels,
  resolveManagementNotificationRoute,
} from '../management-routing';

beforeEach(() => {
  settingsMock.getSetting.mockReset().mockResolvedValue({
    factoryConfirmer: { enabled: true, channelIds: ['factory-channel'] },
    owner: { enabled: false, channelIds: ['owner-channel'] },
  });
  dbMock.notificationChannel.findMany.mockReset().mockResolvedValue([]);
});

describe('management notification fixed role map', () => {
  it('只有五个真值事件，事件→角色不从配置读取', () => {
    expect(MANAGEMENT_NOTIFICATION_ROLE_BY_EVENT).toEqual({
      ORDER_SUBMITTED: 'factoryConfirmer',
      ORDER_CHANGE_REQUESTED: 'factoryConfirmer',
      PRODUCTION_PROGRESS_ANOMALY: 'owner',
      PRODUCTION_STAGNANT: 'owner',
      PENDING_FACTORY_BACKLOG: 'owner',
    });
    expect(managementNotificationRoleForEvent('URGENT_ORDER')).toBeNull();
    expect(managementNotificationRoleForEvent('MADE_UP_EVENT')).toBeNull();
  });

  it('仅从固定角色节点取 enabled 与 channelIds', async () => {
    await expect(
      resolveManagementNotificationRoute('ORDER_CHANGE_REQUESTED'),
    ).resolves.toEqual({
      role: 'factoryConfirmer',
      enabled: true,
      channelIds: ['factory-channel'],
    });
    await expect(
      resolveManagementNotificationRoute('PRODUCTION_STAGNANT'),
    ).resolves.toEqual({
      role: 'owner',
      enabled: false,
      channelIds: ['owner-channel'],
    });
    await expect(
      resolveManagementNotificationRoute('ORDER_SHIPPED'),
    ).resolves.toBeNull();
  });

  it('设置页只读群 ID/名称/状态，不把 webhook 传到客户端', async () => {
    await listManagementNotificationChannels();
    expect(dbMock.notificationChannel.findMany).toHaveBeenCalledWith({
      orderBy: [
        { isActive: 'desc' },
        { channelName: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        channelKey: true,
        channelName: true,
        isActive: true,
      },
    });
  });
});
