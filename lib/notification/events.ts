// 企业微信推送事件枚举（CLAUDE.md §7.2 强约束：禁止字面量字符串）。
//
// 每个事件 const 的 string value 同时充当 NotificationRule.eventType +
// NotificationLog.eventType 的 PG 行值——schema 用 `String` 列存这些
// const，没用 PG enum，所以这里改名要小心（要写 migration 改 historic
// log 行）。
//
// SPEC §8.1 列了 10 个事件；STOCK_ALERT 在本波 P1 #2 不实现（Material
// 模型是 P1 后置），但 const 仍保留——让未来加物料的人不用动这层。
// 调用 notify('STOCK_ALERT', ...) 现在不会有 active rule，会早 return。

export const NOTIFICATION_EVENTS = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  URGENT_ORDER: 'URGENT_ORDER',
  ORDER_SCHEDULED: 'ORDER_SCHEDULED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  OUTSOURCE_OVERDUE: 'OUTSOURCE_OVERDUE',
  STOCK_ALERT: 'STOCK_ALERT',
  CS_PERIOD_ENDING: 'CS_PERIOD_ENDING',
  CS_PERIOD_SETTLED: 'CS_PERIOD_SETTLED',
  DAILY_WORKER_SALARY: 'DAILY_WORKER_SALARY',
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

// Per-event payload 形状。模板里能用的 placeholder 与这里对齐——
// rule 里写 `{orderNo}` 时，对应 payload 必须有 orderNo 字段。
//
// 注：金额字段类型用 string（Decimal-string）而不是 number。理由：
// (a) 一致性，所有 lib 边界已经是 string；(b) 模板内只是字符串拼接
// 不做算术；(c) `formatMoney()` 由调用方在传入前完成。
//
// **绝不**在 payload 里塞包含金额的&ldquo;原始 model&rdquo;对象——只塞渲染
// 需要的字段。这是 DECISIONS 2026-04-24 cron-only 推论的延伸。
export type NotificationPayloads = {
  ORDER_SUBMITTED: {
    orderId: string;
    orderNo: string;
    submitterName: string;
    customerRef?: string | null;
  };
  URGENT_ORDER: {
    orderId: string;
    orderNo: string;
    submitterName: string;
    customerRef?: string | null;
  };
  ORDER_SCHEDULED: {
    orderId: string;
    orderNo: string;
    taskCount: number;
  };
  ORDER_COMPLETED: {
    orderId: string;
    orderNo: string;
    customerRef?: string | null;
  };
  ORDER_SHIPPED: {
    orderId: string;
    orderNo: string;
    trackingNo?: string | null;
  };
  OUTSOURCE_OVERDUE: {
    outsourceId: string;
    supplierName: string;
    orderNo?: string | null;
    daysOverdue: number;
  };
  STOCK_ALERT: {
    materialName: string;
    currentStock: number;
    safetyStock: number;
  };
  CS_PERIOD_ENDING: {
    periodId: string;
    csName: string;
    daysUntilEnd: number;
  };
  CS_PERIOD_SETTLED: {
    settledCount: number;
    // 注意：本字段**不**含具体金额（DECISIONS 2026-04-24 反复强调）。
    // 老板想看金额走 /owner/salary/cs 详情页（认证 session 内）。
  };
  DAILY_WORKER_SALARY: {
    date: string; // YYYY-MM-DD
    workerCount: number;
    // 同上：不含金额。
  };
};

// 类型化 notify(event, payload) 入口的 helper —— 让调用方写
// `notify('ORDER_SUBMITTED', { ... })` 时，IDE 能根据 event const 推
// 出 payload 形状必须含 orderNo / submitterName 等。
export type NotificationPayloadFor<E extends NotificationEvent> =
  NotificationPayloads[E];
