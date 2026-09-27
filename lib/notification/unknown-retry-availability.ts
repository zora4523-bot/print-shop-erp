import { isNotificationEvent } from './events';

/**
 * 「确认未送达并重发」是否可用，由服务端判定后以原因字符串传给客户端组件
 * （null = 可用）。与 resolveUnknownNotification 的服务端拒绝口径一致：
 * 没有持久化任务（NOT_DURABLE）或事件已从注册表删除（RETIRED_EVENT）都不能重发。
 */
export function unknownNotificationRetryUnavailableReason(log: {
  deliveryKey: string | null;
  eventType: string;
}): string | null {
  if (log.deliveryKey === null) return '该消息缺少重发记录，无法自动重发';
  if (!isNotificationEvent(log.eventType)) {
    return '该通知事件已停用，只能确认已送达或忽略';
  }
  return null;
}
