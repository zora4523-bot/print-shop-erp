// 公开 API entry —— 业务代码只 `import { notify } from '@/lib/notification'`，
// 不直接 import notify.ts / events.ts (CLAUDE.md §7.1)。
export {
  notify,
  isMockMode,
  type NotifyOptions,
  type NotifyOutcome,
} from './notify';
export {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPayloadFor,
  type NotificationPayloads,
} from './events';
