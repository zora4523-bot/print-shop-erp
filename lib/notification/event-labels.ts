import {
  NOTIFICATION_EVENTS,
  SUPERSEDED_BEFORE_SEND_ERROR,
  TEST_EVENT_TYPE,
  type NotificationEvent,
} from './events';

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  [NOTIFICATION_EVENTS.ORDER_SUBMITTED]: '工单已提交',
  [NOTIFICATION_EVENTS.ORDER_CHANGE_REQUESTED]: '工单变更/取消申请',
  [NOTIFICATION_EVENTS.PRODUCTION_PROGRESS_ANOMALY]: '报工进度异常',
  [NOTIFICATION_EVENTS.PRODUCTION_STAGNANT]: '生产停滞',
  [NOTIFICATION_EVENTS.PENDING_FACTORY_BACKLOG]: '待确认积压',
  [NOTIFICATION_EVENTS.URGENT_ORDER]: '急单提醒',
  [NOTIFICATION_EVENTS.ORDER_SCHEDULED]: '工单已下发',
  [NOTIFICATION_EVENTS.ORDER_COMPLETED]: '工单已完工',
  [NOTIFICATION_EVENTS.ORDER_SHIPPED]: '工单已发货',
  [NOTIFICATION_EVENTS.OUTSOURCE_OVERDUE]: '外协超期',
  [NOTIFICATION_EVENTS.ORDER_OVERDUE]: '工单交期逾期',
  [NOTIFICATION_EVENTS.STOCK_ALERT]: '库存预警',
  [NOTIFICATION_EVENTS.DAILY_WORKER_SALARY]: '师傅日薪汇总',
};

export function notificationEventLabel(eventType: string): string {
  if (eventType === TEST_EVENT_TYPE) return '测试消息';
  return (
    NOTIFICATION_EVENT_LABELS[eventType as NotificationEvent] ?? '未识别事件'
  );
}

export function notificationDeliveryMessage(
  errorMessage: string | null | undefined,
): string | null {
  const message = errorMessage?.trim();
  if (!message) return null;
  if (message === 'MOCK') return '测试模式';
  if (message === SUPERSEDED_BEFORE_SEND_ERROR) {
    return '工单状态或版本已变化，未发送';
  }
  if (message.startsWith('人工')) return message;
  if (message === 'channel inactive') return '群已停用';
  if (message === 'invalid wecom webhook url') {
    return '企业微信 Webhook 地址无效';
  }
  if (/smart bot credentials (?:not configured|incomplete)/i.test(message)) {
    return '智能机器人凭据未配齐';
  }
  if (/smart bot target not bound/i.test(message)) {
    return '智能机器人尚未绑定企业微信群';
  }
  if (/smart bot identity changed/i.test(message)) {
    return '当前 Bot ID 与群绑定身份不一致';
  }
  if (/smart bot duplicate connection detected/i.test(message)) {
    return '智能机器人检测到重复长连接';
  }
  if (/smart bot not authenticated/i.test(message)) {
    return '智能机器人长连接尚未认证';
  }
  if (/smart bot acknowledgement unavailable/i.test(message)) {
    return '送达结果不明';
  }
  if (/errcode/i.test(message)) return '企业微信拒绝发送';
  if (/http\s+429/i.test(message)) return '推送频率受限';
  if (/markdown content exceeds 4096 bytes/i.test(message)) {
    return '消息内容超过企业微信限制';
  }
  if (/timeout/i.test(message)) return '推送超时';
  if (/response lost|lease ended|outcome unknown/i.test(message)) {
    return '送达结果不明';
  }
  if (/finalization failed|persist/i.test(message)) {
    return '推送结果保存失败';
  }
  if (/^http\s+\d+$/i.test(message) || message === 'invalid wecom response') {
    return '推送服务异常';
  }
  return '推送失败';
}
