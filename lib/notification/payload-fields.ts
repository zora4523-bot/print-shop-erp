import type { NotificationEvent } from './events';

// Runtime mirror of NotificationPayloads keys (lib/notification/events.ts).
// Two consumers:
//   1. /owner/notifications/rules/[event] UI 渲染&ldquo;可用占位符&rdquo;提示
//   2. tests/notification 单测 cross-check：
//      seed.ts 模板里 {placeholder} ⊆ NOTIFICATION_PAYLOAD_FIELDS[event]
//      未来人加新占位符 / 改 payload 字段，CI 会立刻挂掉
//      （DECISIONS / HANDOFF 2026-04-27 提的&ldquo;可选延伸&rdquo;）
//
// 改 payload 字段时同步改这里；TS 没法把 type → array runtime 转，
// 必须手维护。下方 PayloadFieldsCheck 类型是&ldquo;运行时 vs 类型同步&rdquo;的
// 编译期闸——任何 NotificationPayloads 字段缺失会 typecheck 报错。
export const NOTIFICATION_PAYLOAD_FIELDS = {
  ORDER_SUBMITTED: ['orderId', 'orderNo', 'summary', 'deepLink'],
  ORDER_CHANGE_REQUESTED: ['orderId', 'orderNo', 'summary', 'deepLink'],
  PRODUCTION_PROGRESS_ANOMALY: ['orderId', 'orderNo', 'summary', 'deepLink'],
  PRODUCTION_STAGNANT: ['orderId', 'orderNo', 'summary', 'deepLink'],
  PENDING_FACTORY_BACKLOG: ['orderId', 'orderNo', 'summary', 'deepLink'],
  URGENT_ORDER: ['orderId', 'orderNo', 'submitterName', 'externalSalesName', 'customerRef'],
  ORDER_SCHEDULED: ['orderId', 'orderNo', 'taskCount'],
  ORDER_COMPLETED: [
    'orderId',
    'orderNo',
    'workOrderVersion',
    'externalSalesName',
    'customerRef',
  ],
  ORDER_SHIPPED: ['orderId', 'orderNo', 'trackingNo'],
  OUTSOURCE_OVERDUE: [
    'outsourceId',
    'supplierName',
    'orderNo',
    'daysOverdue',
    'expectedDate',
  ],
  ORDER_OVERDUE: [
    'orderId',
    'orderNo',
    'externalSalesName',
    'customerRef',
    'promisedDate',
    'daysOverdue',
    'status',
  ],
  STOCK_ALERT: ['materialName', 'currentStock', 'safetyStock'],
  DAILY_WORKER_SALARY: ['date', 'workerCount', 'totalAmount'],
} as const satisfies Record<NotificationEvent, readonly string[]>;

/**
 * 已停用、只为兼容管理员自定义旧模板而保留在载荷里的占位符；规则编辑页不再
 * 列为“可用占位符”（客户自 2026-09-13 起不再录入，恒为空）。
 */
export const RETIRED_NOTIFICATION_PAYLOAD_FIELDS: ReadonlySet<string> = new Set(['customerRef']);

export type NotificationPayloadField =
  (typeof NOTIFICATION_PAYLOAD_FIELDS)[NotificationEvent][number];
