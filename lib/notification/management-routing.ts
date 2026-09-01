import { db } from '../db';
import { getSetting } from '../settings';
import {
  managementNotificationRoleForEvent,
  type ManagementNotificationRole,
} from './events';

export type ManagementNotificationRoute = {
  role: ManagementNotificationRole;
  enabled: boolean;
  channelIds: string[];
};

/**
 * Resolve only the role switch and channel IDs. Active/existence validation is
 * intentionally performed by notify() in the same channel read that supplies
 * webhook URLs, so routing cannot be validated in one query and then silently
 * changed before a second, unrelated lookup.
 */
export async function resolveManagementNotificationRoute(
  eventType: string,
): Promise<ManagementNotificationRoute | null> {
  const role = managementNotificationRoleForEvent(eventType);
  if (!role) return null;

  const routing = await getSetting('management_notification_routing');
  const configured = routing[role];
  return {
    role,
    enabled: configured.enabled,
    channelIds: [...configured.channelIds],
  };
}

export type ManagementNotificationChannelOption = {
  id: string;
  channelKey: string;
  channelName: string;
  isActive: boolean;
};

/** Settings UI read model; webhookUrl is deliberately never sent to the form. */
export async function listManagementNotificationChannels(): Promise<
  ManagementNotificationChannelOption[]
> {
  return db.notificationChannel.findMany({
    orderBy: [{ isActive: 'desc' }, { channelName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      channelKey: true,
      channelName: true,
      isActive: true,
    },
  });
}
