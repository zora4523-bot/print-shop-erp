// 企业微信推送事件枚举（CLAUDE.md §7.2 强约束：禁止字面量字符串）。
//
// 每个事件 const 的 string value 同时充当 NotificationRule.eventType +
// NotificationLog.eventType 的 PG 行值——schema 用 `String` 列存这些
// const，没用 PG enum，所以这里改名要小心（要写 migration 改 historic
// log 行）。
//
// SPEC §8.1 列了 10 个事件，现已全部接线。STOCK_ALERT 的 wire 点在
// lib/material.ts createMaterialTransaction 与 lib/purchase.ts
// cancelPurchaseReceipt（跨越检测：库存从 >=安全库存 跌破那一次变动
// 才触发，持续低位不重复；见 DECISIONS 2026-07-05）。
//
// ORDER_OVERDUE 是 SPEC 之外的业主新增需求（2026-07-07 拍板）：工单
// 承诺交期已过仍未发货，每日 cron 扫描推送管理群；口径与 dashboard
// 交期预警共用 lib/order/promised-date。

export const NOTIFICATION_EVENTS = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_CHANGE_REQUESTED: 'ORDER_CHANGE_REQUESTED',
  PRODUCTION_PROGRESS_ANOMALY: 'PRODUCTION_PROGRESS_ANOMALY',
  PRODUCTION_STAGNANT: 'PRODUCTION_STAGNANT',
  PENDING_FACTORY_BACKLOG: 'PENDING_FACTORY_BACKLOG',
  URGENT_ORDER: 'URGENT_ORDER',
  ORDER_SCHEDULED: 'ORDER_SCHEDULED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  OUTSOURCE_OVERDUE: 'OUTSOURCE_OVERDUE',
  ORDER_OVERDUE: 'ORDER_OVERDUE',
  STOCK_ALERT: 'STOCK_ALERT',
  CS_PERIOD_ENDING: 'CS_PERIOD_ENDING',
  CS_PERIOD_SETTLED: 'CS_PERIOD_SETTLED',
  DAILY_WORKER_SALARY: 'DAILY_WORKER_SALARY',
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export const MANAGEMENT_NOTIFICATION_ROLES = {
  FACTORY_CONFIRMER: 'factoryConfirmer',
  OWNER: 'owner',
} as const;

export type ManagementNotificationRole =
  (typeof MANAGEMENT_NOTIFICATION_ROLES)[keyof typeof MANAGEMENT_NOTIFICATION_ROLES];

/**
 * 管理工作台五类事件的收件角色是业务真值，不是可配置数据。
 * SystemSetting 只能为这两个角色选开关和真实 channel ID，
 * 不能把“新单”篡改成发给老板，也不能追加第三个任意角色。
 */
export const MANAGEMENT_NOTIFICATION_ROLE_BY_EVENT = {
  [NOTIFICATION_EVENTS.ORDER_SUBMITTED]:
    MANAGEMENT_NOTIFICATION_ROLES.FACTORY_CONFIRMER,
  [NOTIFICATION_EVENTS.ORDER_CHANGE_REQUESTED]:
    MANAGEMENT_NOTIFICATION_ROLES.FACTORY_CONFIRMER,
  [NOTIFICATION_EVENTS.PRODUCTION_PROGRESS_ANOMALY]:
    MANAGEMENT_NOTIFICATION_ROLES.OWNER,
  [NOTIFICATION_EVENTS.PRODUCTION_STAGNANT]:
    MANAGEMENT_NOTIFICATION_ROLES.OWNER,
  [NOTIFICATION_EVENTS.PENDING_FACTORY_BACKLOG]:
    MANAGEMENT_NOTIFICATION_ROLES.OWNER,
} as const satisfies Partial<Record<NotificationEvent, ManagementNotificationRole>>;

export function managementNotificationRoleForEvent(
  eventType: string,
): ManagementNotificationRole | null {
  return (
    (MANAGEMENT_NOTIFICATION_ROLE_BY_EVENT as Partial<
      Record<string, ManagementNotificationRole>
    >)[eventType] ?? null
  );
}

// Per-event payload 形状。模板里能用的 placeholder 与这里对齐——
// rule 里写 `{orderNo}` 时，对应 payload 必须有 orderNo 字段。
//
// 字段名与 prisma/seed.ts:seedNotificationEvents 里的默认 template
// 一一对应—— 任何不一致会让模板渲染时留 raw
// `{placeholder}` 文本流到群消息。修改字段名时同步改 seed.ts。
//
// 管理工作流新增事件只允许携带工单号、业务摘要和深链，不携带金额。
// ORDER_SUBMITTED 的 totalAmount 仅作为旧调用方的编译兼容字段保留；三条
// 运行时入口都会在持久化或渲染前移除它，后台模板字段列表也不再暴露它。
//
// 范围注：DECISIONS 2026-04-24 限定的是 cron HTTP 响应 / pg_cron stdout
// 不漏金额；企业微信群消息是已认证收件人（管理员群 / 排产群），含金额
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
    /** @deprecated 管理工作流通知禁止携带金额；运行时会主动移除。 */
    totalAmount?: string;
    urgentMark: string; // '🚨 急单' / ''
    summary?: string;
    deepLink?: string;
  };
  ORDER_CHANGE_REQUESTED: {
    orderId: string;
    orderNo: string;
    summary: string;
    deepLink: string;
  };
  PRODUCTION_PROGRESS_ANOMALY: {
    orderId: string;
    orderNo: string;
    summary: string;
    deepLink: string;
  };
  PRODUCTION_STAGNANT: {
    orderId: string;
    orderNo: string;
    summary: string;
    deepLink: string;
  };
  PENDING_FACTORY_BACKLOG: {
    orderId: string;
    orderNo: string;
    summary: string;
    deepLink: string;
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
    // 。lib/order.ts:shipOrder 业务允许 trackingNo
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
  ORDER_OVERDUE: {
    orderId: string;
    orderNo: string;
    // 必填 string——seed 模板引用 {customerRef}；调用方负责 null → '未填'
    customerRef: string;
    promisedDate: string; // YYYY/MM/DD（已 zh-CN format）
    daysOverdue: number;
    status: string; // 中文状态标签（调用方用 orderStatusZh 映射）
  };
  STOCK_ALERT: {
    materialName: string;
    currentStock: string; // 已 toFixed(2)，如 '1.50'——number 会丢尾零（1.50 → '1.5'）
    safetyStock: string; // 同上
  };
  CS_PERIOD_ENDING: {
    periodId: string;
    csName: string;
    daysLeft: number;
    // **业绩合计（含期初 initialSales）**——同 dashboard `salesForTier`
    // 口径，与提成档位计算一致。CS_TIERS 是
    // 按 totalSales + initialSales 算的；如果这里只发 totalSales，
    // initialSales != 0 时消息&ldquo;业绩&rdquo;会比命中档位低，管理员看不出 why。
    // Slice D wire (`/api/cron/cs-period-ending`) 用 lib/dashboard/
    // owner-watchlist.salesForTier 喂入。seed.ts 模板&ldquo;业绩合计&rdquo;标签
    // 同步反映这一点。
    totalSales: string; // Decimal-string，已 formatMoneyPlain
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

/** Remove forbidden commercial data before rendering or durable persistence. */
export function sanitizeNotificationPayload<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
): NotificationPayloadFor<E> {
  const record = payload as unknown as Record<string, unknown>;
  const orderNo = typeof record.orderNo === 'string' ? record.orderNo : '';
  const canonicalDeepLink = `/orders#wo=${encodeURIComponent(orderNo)}`;
  switch (event) {
    case NOTIFICATION_EVENTS.ORDER_SUBMITTED:
      return {
        orderId: String(record.orderId ?? ''),
        orderNo,
        summary: '新工单已提交，待工厂确认',
        deepLink: canonicalDeepLink,
      } as NotificationPayloadFor<E>;
    case NOTIFICATION_EVENTS.ORDER_CHANGE_REQUESTED:
      return {
        orderId: String(record.orderId ?? ''),
        orderNo,
        summary: '工单变更/取消申请已提交，待工厂确认',
        deepLink: canonicalDeepLink,
      } as NotificationPayloadFor<E>;
    case NOTIFICATION_EVENTS.PRODUCTION_PROGRESS_ANOMALY:
    case NOTIFICATION_EVENTS.PRODUCTION_STAGNANT:
    case NOTIFICATION_EVENTS.PENDING_FACTORY_BACKLOG:
      return {
        orderId: String(record.orderId ?? ''),
        orderNo,
        summary: String(record.summary ?? ''),
        deepLink: canonicalDeepLink,
      } as NotificationPayloadFor<E>;
    default:
      return payload;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 事件级策略常量 —— 定义在 events.ts（事件的"属性"跟事件枚举同住），
// 而非 admin.ts/notify.ts（那会让发送管道反向依赖管理端 CRUD 模块）。
// ─────────────────────────────────────────────────────────────────────

// CS_PERIOD_* 事件含具体客服的业绩/提成金额，schema 没有 per-user
// 路由（P2 才加 User.notificationChannelId），多 channel 即广播隐私。
// 写侧（admin.updateRuleWithGuard）与发送侧（notify fan-out cap）共用
// 这一份判定。注意保持 ReadonlySet<string>：调用方传的是 string 列值。
const PRIVATE_PER_CS_EVENTS: ReadonlySet<string> = new Set([
  NOTIFICATION_EVENTS.CS_PERIOD_ENDING,
  NOTIFICATION_EVENTS.CS_PERIOD_SETTLED,
]);

export function isPrivatePerCsEvent(eventType: string): boolean {
  return PRIVATE_PER_CS_EVENTS.has(eventType);
}

export const PRIVATE_EVENT_MAX_CHANNELS = 1;

// owner "测试发送" 写入 NotificationLog 的哨兵 eventType。**不并入**
// NOTIFICATION_EVENTS —— 那会让 '__TEST__' 变成可配置规则事件
// （admin.updateRule 与 rules/[event] 页面都用 Object.values(...) 校验）。
// 写入方 actions/owner-notifications.ts 与排除方 admin.countRecentFailures
// 必须引用同一常量：两处字符串一旦漂移，24h 失败告警会把测试失败
// 误计入生产推送健康度。
export const TEST_EVENT_TYPE = '__TEST__';
