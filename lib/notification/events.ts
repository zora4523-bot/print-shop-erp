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
// 字段名与 prisma/seed.ts:seedNotificationEvents 里的默认 template
// 一一对应（Codex round 101 P1）—— 任何不一致会让模板渲染时留 raw
// `{placeholder}` 文本流到群消息。修改字段名时同步改 seed.ts。
//
// 金额字段：用 string（Decimal-string）而不是 number。理由：(a) 一致性，
// 所有 lib 边界已经是 string；(b) 模板内只是字符串拼接不做算术；
// (c) `formatMoney()` 由调用方在传入前完成。
//
// 范围注：DECISIONS 2026-04-24 限定的是 cron HTTP 响应 / pg_cron stdout
// 不漏金额；企业微信群消息是已认证收件人（老板群 / 排产群），含金额
// 是预期行为（SPEC §8.1 的群定向就是为此）。所以 payload **可以**含
// totalAmount / commission / totalSales 等。errorMessage 字段仍不放
// 业务字段（DECISIONS 2026-04-27 推论）。
//
// `urgentMark` 是约定字段：调用方传 '🚨 急单' 或 ''（空字符串），让
// 模板用 `{urgentMark}` 一行 toggle 急单标记不需要重写整段 template。
export type NotificationPayloads = {
  ORDER_SUBMITTED: {
    orderId: string;
    orderNo: string;
    submitterName: string;
    customerRef?: string | null;
    totalAmount: string; // Decimal-string，已 formatMoney 千分位
    urgentMark: string; // '🚨 急单' / ''
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
    // 必填 string —— prisma/seed.ts 的默认 template 引用 {trackingNo}，
    // null 会让 renderTemplate 留下 raw `{trackingNo}` 流到群消息
    // （Codex round 102 P1）。lib/order.ts:shipOrder 业务允许 trackingNo
    // 为 null（'   '.trim() === '' → null）；调用方在 Slice C wire 时
    // 责任：`trackingNo ?? '未填'` 之类映射后传入。
    trackingNo: string;
  };
  OUTSOURCE_OVERDUE: {
    outsourceId: string;
    supplierName: string;
    orderNo?: string | null;
    daysOverdue: number;
    expectedDate: string; // YYYY-MM-DD（已 zh-CN format）
  };
  STOCK_ALERT: {
    materialName: string;
    currentStock: number;
    safetyStock: number;
  };
  CS_PERIOD_ENDING: {
    periodId: string;
    csName: string;
    daysLeft: number;
    totalSales: string; // Decimal-string，已 formatMoney
  };
  CS_PERIOD_SETTLED: {
    settledCount: number;
    csName: string;
    totalSales: string; // Decimal-string
    commission: string; // Decimal-string
  };
  DAILY_WORKER_SALARY: {
    date: string; // YYYY-MM-DD
    workerCount: number;
    totalAmount: string; // Decimal-string
  };
};

// 类型化 notify(event, payload) 入口的 helper —— 让调用方写
// `notify('ORDER_SUBMITTED', { ... })` 时，IDE 能根据 event const 推
// 出 payload 形状必须含 orderNo / submitterName 等。
export type NotificationPayloadFor<E extends NotificationEvent> =
  NotificationPayloads[E];
