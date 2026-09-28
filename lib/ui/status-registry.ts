import {
  AgentMonthlyBillExportStatus,
  AgentMonthlyBillStatus,
  BackgroundJobStatus,
  BillStatus,
  DesignBundleStatus,
  NotificationStatus,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderExportStatus,
  OrderStatus,
  OutsourceStatus,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  ProductionOperationStatus,
  ProductionTaskDisputeStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import type { RuleCenterEffect } from '@/lib/navigation/rule-center';

/**
 * Semantic tones accepted by the shared StatusBadge.
 *
 * Keep business state here instead of coupling domain code to a concrete Badge
 * variant. In particular, `danger` is reserved for failed or cancelled work;
 * queued, running and attention-required states use neutral/info/warning.
 */
export type StatusTone =
  | 'primary'
  | 'warning'
  | 'info'
  | 'success'
  | 'danger'
  | 'neutral';

export type StatusDefinition = Readonly<{
  label: string;
  /** 在筛选器需要更明确的领域动词时保留既有文案。 */
  filterLabel?: string;
  tone: StatusTone;
  dot?: boolean;
}>;

export type StatusRegistry<TStatus extends PropertyKey> = Readonly<
  Record<TStatus, StatusDefinition>
>;

export function statusFilterLabel(definition: StatusDefinition): string {
  return definition.filterLabel ?? definition.label;
}

export const ORDER_STATUS_REGISTRY: StatusRegistry<OrderStatus> = {
  [OrderStatus.DRAFT]: { label: '草稿', tone: 'neutral' },
  [OrderStatus.PENDING_FACTORY]: { label: '待处理', tone: 'info' },
  [OrderStatus.REJECTED]: { label: '已驳回', tone: 'danger' },
  [OrderStatus.CONFIRMED]: { label: '待下发生产', tone: 'success' },
  [OrderStatus.ON_HOLD]: { label: '已暂停', tone: 'warning', dot: true },
  [OrderStatus.RELEASED]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.FOILING]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.PACKING]: { label: '待打包发货', tone: 'info', dot: true },
  [OrderStatus.SETTLED]: { label: '已结算', tone: 'success' },
  [OrderStatus.SUBMITTED]: { label: '待处理', tone: 'info' },
  // SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED 只存在于迁移前的老行
  // （见 lib/order/status-machine.ts 的转换表注释）。它们的名字与在产状态
  // 高度相似，不加标记会让管理员误判「我到底下发过没有」，因此把「（历史）」
  // 写进 label 本身——只在工作台加后缀会让同一状态在管理端出现两个名字。
  // SUBMITTED 保持「待处理」不加标记：它与 PENDING_FACTORY 同名，加标记等于
  // 把枚举差异外显给用户。
  [OrderStatus.SCHEDULING]: {
    label: '排产中（历史）',
    tone: 'info',
    dot: true,
  },
  [OrderStatus.IN_PRODUCTION]: {
    label: '生产中（历史）',
    tone: 'info',
    dot: true,
  },
  [OrderStatus.COMPLETED]: { label: '已完工（历史）', tone: 'success' },
  [OrderStatus.SHIPPED]: { label: '已发货', tone: 'success' },
  [OrderStatus.FINISHED]: { label: '已完成（历史）', tone: 'neutral' },
  [OrderStatus.CANCELLED]: { label: '已取消', tone: 'danger' },
};

/**
 * 承诺交期预警是 `lib/order/promised-date` 的派生展示态，不写回业务状态机。
 * key 取 'overdue' / 'due-soon'，与 `PromisedDateAlert['kind']` 逐字一致，
 * 调用方可以直接用 alert.kind 索引，不必再维护一张映射表。
 *
 * 逾期用 danger：承诺交期已经过去，是一次已经发生的履约失败（与
 * NotificationStatus.FAILED 同类），不是「还需要留意一下」；3 天内到期
 * 是提醒，用 warning。两档必须区分开，否则升级关系在颜色上就丢了。
 *
 * 天数要拼进 label（「逾期 5 天」/「剩 2 天」），所以注册表只存基础文案，
 * 由 `promisedDateAlertDefinition` 组装，页面不再自己写颜色类名。
 */
export const PROMISED_DATE_ALERT_STATUS = {
  OVERDUE: 'overdue',
  DUE_SOON: 'due-soon',
} as const;

export type PromisedDateAlertStatus =
  (typeof PROMISED_DATE_ALERT_STATUS)[keyof typeof PROMISED_DATE_ALERT_STATUS];

export const PROMISED_DATE_ALERT_REGISTRY: StatusRegistry<PromisedDateAlertStatus> = {
  [PROMISED_DATE_ALERT_STATUS.OVERDUE]: { label: '逾期', tone: 'danger' },
  [PROMISED_DATE_ALERT_STATUS.DUE_SOON]: { label: '今天到期', tone: 'warning' },
};

/**
 * @param kind `promisedDateAlert()` 返回的预警种类。
 * @param days 逾期天数或剩余天数（均为非负数）。
 */
export function promisedDateAlertDefinition(
  kind: PromisedDateAlertStatus,
  days: number,
): StatusDefinition {
  const base = PROMISED_DATE_ALERT_REGISTRY[kind];
  if (kind === PROMISED_DATE_ALERT_STATUS.OVERDUE) {
    return { ...base, label: `${base.label} ${days} 天` };
  }
  return days === 0 ? base : { ...base, label: `剩 ${days} 天` };
}

export const BILL_STATUS_REGISTRY: StatusRegistry<BillStatus> = {
  [BillStatus.DRAFT]: { label: '草稿', tone: 'neutral' },
  [BillStatus.ISSUED]: { label: '已发单', tone: 'warning', dot: true },
  [BillStatus.PARTIAL_PAID]: {
    label: '部分结清',
    tone: 'info',
    dot: true,
  },
  [BillStatus.FULLY_PAID]: { label: '已结清', tone: 'success' },
};

export const AGENT_MONTHLY_BILL_STATUS_REGISTRY: StatusRegistry<AgentMonthlyBillStatus> = {
  [AgentMonthlyBillStatus.DRAFT]: { label: '草稿', tone: 'neutral' },
  [AgentMonthlyBillStatus.CONFIRMED]: {
    label: '已确认·待收',
    tone: 'warning',
    dot: true,
  },
  [AgentMonthlyBillStatus.PAID]: { label: '已收', tone: 'success' },
};

/**
 * 销售端（外部代理商）看到的同一组状态：管理端是收款视角（待收 / 已收），
 * 销售端是付款视角（待支付 / 已结清），DRAFT 对销售意味着"管理员还在整理、金额未定稿"。
 * tone 与管理端一致，只换文案；两端页面都必须从这里取，不得各写字面量。
 */
export const SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY: StatusRegistry<AgentMonthlyBillStatus> = {
  [AgentMonthlyBillStatus.DRAFT]: { label: '整理中', tone: 'neutral' },
  [AgentMonthlyBillStatus.CONFIRMED]: { label: '待支付', tone: 'warning', dot: true },
  [AgentMonthlyBillStatus.PAID]: { label: '已结清', tone: 'success' },
};

export const AGENT_MONTHLY_BILL_EXPORT_STATUS_REGISTRY: StatusRegistry<AgentMonthlyBillExportStatus> = {
  [AgentMonthlyBillExportStatus.PENDING]: {
    label: '生成中',
    tone: 'info',
    dot: true,
  },
  [AgentMonthlyBillExportStatus.READY]: { label: '已生成', tone: 'success' },
  [AgentMonthlyBillExportStatus.FAILED]: { label: '失败', tone: 'danger' },
  [AgentMonthlyBillExportStatus.EXPIRED]: { label: '已过期', tone: 'neutral' },
};

export const NOTIFICATION_STATUS_REGISTRY: StatusRegistry<NotificationStatus> = {
  [NotificationStatus.SENDING]: {
    label: '发送中',
    tone: 'info',
    dot: true,
  },
  [NotificationStatus.SUCCESS]: { label: '成功', tone: 'success' },
  [NotificationStatus.FAILED]: { label: '失败', tone: 'danger' },
  [NotificationStatus.RETRYING]: {
    label: '重试中',
    tone: 'warning',
    dot: true,
  },
  [NotificationStatus.UNKNOWN]: {
    label: '待人工核对',
    tone: 'warning',
  },
};

const EXHAUSTED_NOTIFICATION_STATUS: StatusDefinition = {
  label: '重试耗尽',
  tone: 'danger',
};

export function notificationStatusDefinition(
  status: NotificationStatus,
  options: { hasDeadLetterJob?: boolean } = {},
): StatusDefinition {
  if (
    status === NotificationStatus.RETRYING &&
    options.hasDeadLetterJob === true
  ) {
    return EXHAUSTED_NOTIFICATION_STATUS;
  }
  return NOTIFICATION_STATUS_REGISTRY[status];
}

export const BACKGROUND_JOB_STATUS_REGISTRY: StatusRegistry<BackgroundJobStatus> = {
  [BackgroundJobStatus.PENDING]: {
    label: '排队中',
    tone: 'neutral',
    dot: true,
  },
  [BackgroundJobStatus.RUNNING]: {
    label: '执行中',
    tone: 'info',
    dot: true,
  },
  [BackgroundJobStatus.SUCCEEDED]: { label: '已完成', tone: 'success' },
  [BackgroundJobStatus.DEAD]: { label: '已失败', tone: 'danger' },
  [BackgroundJobStatus.CANCELLED]: { label: '已取消', tone: 'danger' },
};

export const PAYMENT_DISPLAY_STATUS = {
  PAID: 'PAID',
  UNPAID: 'UNPAID',
} as const;

export type PaymentDisplayStatus =
  (typeof PAYMENT_DISPLAY_STATUS)[keyof typeof PAYMENT_DISPLAY_STATUS];

export const PAYMENT_STATUS_REGISTRY: StatusRegistry<PaymentDisplayStatus> = {
  [PAYMENT_DISPLAY_STATUS.PAID]: { label: '已发', tone: 'success' },
  [PAYMENT_DISPLAY_STATUS.UNPAID]: { label: '未发', tone: 'warning' },
};

export function paymentStatusDefinition(isPaid: boolean): StatusDefinition {
  return PAYMENT_STATUS_REGISTRY[
    isPaid ? PAYMENT_DISPLAY_STATUS.PAID : PAYMENT_DISPLAY_STATUS.UNPAID
  ];
}

/**
 * 主数据的启停两态（`isActive` 布尔列，不是 Prisma 枚举）：账号、客户/供应商、
 * 物料、产品分类共用同一张表。停用是正常的收口动作而不是失败，所以是 neutral
 * 而不是 danger。
 */
export const ACTIVE_DISPLAY_STATUS = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
} as const;

export type ActiveDisplayStatus =
  (typeof ACTIVE_DISPLAY_STATUS)[keyof typeof ACTIVE_DISPLAY_STATUS];

export const ACTIVE_STATUS_REGISTRY: StatusRegistry<ActiveDisplayStatus> = {
  [ACTIVE_DISPLAY_STATUS.ENABLED]: { label: '启用', tone: 'success' },
  [ACTIVE_DISPLAY_STATUS.DISABLED]: { label: '停用', tone: 'neutral' },
};

export function activeStatusDefinition(isActive: boolean): StatusDefinition {
  return ACTIVE_STATUS_REGISTRY[
    isActive ? ACTIVE_DISPLAY_STATUS.ENABLED : ACTIVE_DISPLAY_STATUS.DISABLED
  ];
}

/**
 * 计件保底态是「今天这份工资是怎么算出来的」的展示态：由计件合计与每日保底
 * 比较派生，不落库、没有 Prisma 枚举。放在这里让师傅端列表、师傅端明细与
 * 管理端历史日薪三处共用同一套 label + tone，避免各页自己发明颜色。
 *
 * 「按保底补足」是保护师傅的兜底机制、不是异常，因此用 info 而非 warning /
 * danger。师傅端在徽章下方另有一段 warning 色的原因说明，徽章本身不重复加压。
 *
 * 三个 label 由 SPEC-v1.2.md §313-314 明文规定，不得改写。
 */
export const SALARY_FLOOR_DISPLAY_STATUS = {
  ABOVE_FLOOR: 'ABOVE_FLOOR',
  AT_FLOOR: 'AT_FLOOR',
  TOPPED_UP_TO_FLOOR: 'TOPPED_UP_TO_FLOOR',
} as const;

export type SalaryFloorDisplayStatus =
  (typeof SALARY_FLOOR_DISPLAY_STATUS)[keyof typeof SALARY_FLOOR_DISPLAY_STATUS];

export const SALARY_FLOOR_STATUS_REGISTRY: StatusRegistry<SalaryFloorDisplayStatus> = {
  [SALARY_FLOOR_DISPLAY_STATUS.ABOVE_FLOOR]: {
    label: '计件高于保底',
    tone: 'success',
  },
  [SALARY_FLOOR_DISPLAY_STATUS.AT_FLOOR]: {
    label: '计件等于保底',
    tone: 'neutral',
  },
  [SALARY_FLOOR_DISPLAY_STATUS.TOPPED_UP_TO_FLOOR]: {
    label: '按保底补足',
    tone: 'info',
  },
};

/**
 * @param comparison 计件合计与每日保底的比较结果，即 Decimal#cmp 的返回值：
 *   正数 = 高于保底，0 = 等于保底，负数 = 按保底补足。
 *   入参刻意取 number 而不是 Decimal —— 本模块保持零运行时依赖，
 *   金额比较由调用方完成。
 */
export function salaryFloorStatusDefinition(
  comparison: number,
): StatusDefinition {
  if (comparison > 0) {
    return SALARY_FLOOR_STATUS_REGISTRY[
      SALARY_FLOOR_DISPLAY_STATUS.ABOVE_FLOOR
    ];
  }
  if (comparison === 0) {
    return SALARY_FLOOR_STATUS_REGISTRY[SALARY_FLOOR_DISPLAY_STATUS.AT_FLOOR];
  }
  return SALARY_FLOOR_STATUS_REGISTRY[
    SALARY_FLOOR_DISPLAY_STATUS.TOPPED_UP_TO_FLOOR
  ];
}

export const ORDER_CHANGE_REQUEST_STATUS_REGISTRY: StatusRegistry<OrderChangeRequestStatus> = {
  [OrderChangeRequestStatus.PENDING]: {
    label: '待审核',
    tone: 'warning',
    dot: true,
  },
  [OrderChangeRequestStatus.APPROVED]: {
    label: '已批准',
    tone: 'success',
  },
  [OrderChangeRequestStatus.DENIED]: {
    label: '已驳回',
    tone: 'danger',
  },
  [OrderChangeRequestStatus.WITHDRAWN]: {
    label: '已撤回',
    tone: 'neutral',
  },
  [OrderChangeRequestStatus.REJECTED]: {
    label: '已拒绝',
    tone: 'danger',
  },
  [OrderChangeRequestStatus.CANCELLED]: {
    label: '已撤销',
    tone: 'danger',
  },
  [OrderChangeRequestStatus.STALE]: {
    label: '版本已过期',
    tone: 'neutral',
  },
};

/**
 * 修改 / 取消申请的“类型”不是状态：它在申请的整个生命周期里不变，只回答
 * “这张申请要做什么”，旁边那颗状态徽章才表示审批进度。类型标签由 shadcn
 * Badge 承载，这里只集中文案，避免页面各写一份中文映射。
 *
 * 两档都用 neutral：CANCEL 是一次“待审的请求”，不是失败或取消终态，
 * 给它 danger 会和同一行的「已拒绝 / 已撤销」抢红色。
 */
export const ORDER_CHANGE_REQUEST_TYPE_REGISTRY: StatusRegistry<OrderChangeRequestType> = {
  [OrderChangeRequestType.MODIFY]: { label: '修改申请', tone: 'neutral' },
  [OrderChangeRequestType.CANCEL]: { label: '取消申请', tone: 'neutral' },
};

export const OUTSOURCE_STATUS_REGISTRY: StatusRegistry<OutsourceStatus> = {
  [OutsourceStatus.SENT]: {
    label: '已发出',
    filterLabel: '已发送',
    tone: 'info',
    dot: true,
  },
  [OutsourceStatus.IN_PROGRESS]: {
    label: '进行中',
    tone: 'info',
    dot: true,
  },
  [OutsourceStatus.RECEIVED]: {
    label: '已回货',
    filterLabel: '已收货',
    tone: 'success',
  },
  [OutsourceStatus.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
};

export const PRODUCTION_TASK_STATUS_REGISTRY: StatusRegistry<TaskStatus> = {
  [TaskStatus.PENDING]: {
    label: '待开始',
    filterLabel: '待生产',
    tone: 'neutral',
    dot: true,
  },
  [TaskStatus.IN_PROGRESS]: {
    label: '进行中',
    filterLabel: '生产中',
    tone: 'info',
    dot: true,
  },
  [TaskStatus.COMPLETED]: {
    label: '已完工',
    tone: 'success',
  },
  [TaskStatus.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
};

/**
 * 师傅报工争议的处理状态。待处理是需要主管跟进的在途项 → warning + dot；
 * 「已驳回」是这张争议的非正常终态，与 OrderChangeRequestStatus.DENIED
 * 取同一档 danger。
 */
export const PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY: StatusRegistry<ProductionTaskDisputeStatus> = {
  [ProductionTaskDisputeStatus.PENDING]: {
    label: '待处理',
    tone: 'warning',
    dot: true,
  },
  [ProductionTaskDisputeStatus.RESOLVED]: {
    label: '已解决',
    tone: 'success',
  },
  [ProductionTaskDisputeStatus.REJECTED]: {
    label: '已驳回',
    tone: 'danger',
  },
};

export const PRODUCTION_OPERATION_STATUS_REGISTRY: StatusRegistry<ProductionOperationStatus> = {
  [ProductionOperationStatus.PENDING]: {
    label: '待报工',
    tone: 'neutral',
    dot: true,
  },
  [ProductionOperationStatus.IN_PROGRESS]: {
    label: '进行中',
    tone: 'warning',
    dot: true,
  },
  [ProductionOperationStatus.COMPLETED]: {
    label: '已完工',
    tone: 'success',
  },
  [ProductionOperationStatus.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
};

export const SHIPMENT_STATUS_REGISTRY: StatusRegistry<ShipmentStatus> = {
  [ShipmentStatus.PLANNED]: {
    label: '待发货',
    tone: 'warning',
    dot: true,
  },
  [ShipmentStatus.SHIPPED]: {
    label: '已发货',
    tone: 'success',
  },
};

export const PURCHASE_ORDER_STATUS_REGISTRY: StatusRegistry<PurchaseOrderStatus> = {
  [PurchaseOrderStatus.ORDERED]: {
    label: '已下单',
    tone: 'info',
    dot: true,
  },
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: {
    label: '部分收货',
    tone: 'warning',
    dot: true,
  },
  [PurchaseOrderStatus.RECEIVED]: {
    label: '已收货',
    tone: 'success',
  },
  [PurchaseOrderStatus.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
};

export const PURCHASE_RECEIPT_STATUS_REGISTRY: StatusRegistry<PurchaseReceiptStatus> = {
  [PurchaseReceiptStatus.POSTED]: {
    label: '已收货过账',
    tone: 'success',
  },
  [PurchaseReceiptStatus.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
};

export const ORDER_EXPORT_STATUS_REGISTRY: StatusRegistry<OrderExportStatus> = {
  [OrderExportStatus.PENDING]: {
    label: '生成中',
    tone: 'info',
    dot: true,
  },
  [OrderExportStatus.READY]: {
    label: '已生成',
    tone: 'success',
  },
  [OrderExportStatus.FAILED]: {
    label: '生成失败，请重新导出',
    tone: 'danger',
  },
  [OrderExportStatus.EXPIRED]: {
    label: '已过期',
    tone: 'neutral',
  },
};

/**
 * CDR 的“过期”“已撤销”和 mock URL 是 READY 记录的展示态，不写回业务状态机。
 * 将它们放在 UI registry 中，避免页面重新发明标签或危险色。
 */
export const DESIGN_BUNDLE_DISPLAY_STATUS = {
  PENDING: DesignBundleStatus.PENDING,
  READY: DesignBundleStatus.READY,
  FAILED: DesignBundleStatus.FAILED,
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  MOCK: 'MOCK',
} as const;

export type DesignBundleDisplayStatus =
  (typeof DESIGN_BUNDLE_DISPLAY_STATUS)[keyof typeof DESIGN_BUNDLE_DISPLAY_STATUS];

export const DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY: StatusRegistry<DesignBundleDisplayStatus> = {
  [DESIGN_BUNDLE_DISPLAY_STATUS.PENDING]: {
    label: '排队生成中',
    tone: 'info',
    dot: true,
  },
  [DESIGN_BUNDLE_DISPLAY_STATUS.READY]: {
    label: '已生成',
    tone: 'success',
  },
  [DESIGN_BUNDLE_DISPLAY_STATUS.FAILED]: {
    label: '生成失败',
    tone: 'danger',
  },
  [DESIGN_BUNDLE_DISPLAY_STATUS.EXPIRED]: {
    label: '已过期',
    tone: 'neutral',
  },
  [DESIGN_BUNDLE_DISPLAY_STATUS.REVOKED]: {
    label: '已撤销',
    tone: 'neutral',
  },
  [DESIGN_BUNDLE_DISPLAY_STATUS.MOCK]: {
    label: '暂不可下载',
    tone: 'neutral',
  },
};

/**
 * Customer price-book version state is derived by the admin query rather than
 * persisted as a Prisma enum. Keeping its display union here still gives the UI
 * one exhaustive mapping without coupling client components to a server-only
 * query module.
 */
export const CUSTOMER_PRICE_BOOK_VERSION_STATUS = {
  DRAFT: 'DRAFT',
  CURRENT: 'CURRENT',
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
  HISTORICAL: 'HISTORICAL',
} as const;

export type CustomerPriceBookVersionStatus =
  (typeof CUSTOMER_PRICE_BOOK_VERSION_STATUS)[keyof typeof CUSTOMER_PRICE_BOOK_VERSION_STATUS];

export const CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY: StatusRegistry<CustomerPriceBookVersionStatus> = {
  [CUSTOMER_PRICE_BOOK_VERSION_STATUS.DRAFT]: {
    label: '草稿',
    tone: 'warning',
  },
  [CUSTOMER_PRICE_BOOK_VERSION_STATUS.CURRENT]: {
    label: '当前生效',
    tone: 'success',
  },
  [CUSTOMER_PRICE_BOOK_VERSION_STATUS.SCHEDULED]: {
    label: '计划生效',
    tone: 'info',
    dot: true,
  },
  [CUSTOMER_PRICE_BOOK_VERSION_STATUS.CANCELLED]: {
    label: '已取消',
    tone: 'danger',
  },
  [CUSTOMER_PRICE_BOOK_VERSION_STATUS.HISTORICAL]: {
    label: '历史',
    tone: 'neutral',
  },
};

/**
 * 规则中心的“何时生效”标记。不是持久化枚举，而是导航配置
 * （lib/navigation/rule-center.ts）里声明的生效方式。收在这里是为了让
 * 规则页头徽章与规则总览列表用同一份文案，不再各写一张本地表。
 */
export const RULE_CENTER_EFFECT_REGISTRY: StatusRegistry<RuleCenterEffect> = {
  mixed: { label: '分域生效', tone: 'neutral' },
  versioned: {
    label: '版本发布后生效',
    tone: 'warning',
    dot: true,
  },
  immediate: {
    label: '保存后即时生效',
    tone: 'success',
    dot: true,
  },
  'effective-dated': {
    label: '按生效时间启用',
    tone: 'info',
    dot: true,
  },
};

/**
 * Pigsty 运维页的就绪态由 (ready, blockers) 派生，不是持久化枚举。
 * 放进 registry 让六张就绪表共用同一套文案与色档，页面不再自带 tone 函数。
 *
 * dot 挂在「有阻塞」而不是「就绪」：业务状态注册表里的圆点一律标「在途 /
 * 需要跟进」，没有一个落定的 success 终态带点；把它扣在唯一不需要注意的
 * 那一档上是反的。
 */
export const OPS_READINESS_DISPLAY_STATUS = {
  READY: 'READY',
  BLOCKED: 'BLOCKED',
  NOT_ENABLED: 'NOT_ENABLED',
} as const;

export type OpsReadinessDisplayStatus =
  (typeof OPS_READINESS_DISPLAY_STATUS)[keyof typeof OPS_READINESS_DISPLAY_STATUS];

export const OPS_READINESS_STATUS_REGISTRY: StatusRegistry<OpsReadinessDisplayStatus> = {
  [OPS_READINESS_DISPLAY_STATUS.READY]: { label: '就绪', tone: 'success' },
  [OPS_READINESS_DISPLAY_STATUS.BLOCKED]: {
    label: '有阻塞',
    tone: 'warning',
    dot: true,
  },
  [OPS_READINESS_DISPLAY_STATUS.NOT_ENABLED]: {
    label: '未启用',
    tone: 'neutral',
  },
};

export function opsReadinessDefinition(
  ready: boolean,
  blockers: readonly string[],
): StatusDefinition {
  if (ready) {
    return OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.READY];
  }
  return OPS_READINESS_STATUS_REGISTRY[
    blockers.length > 0
      ? OPS_READINESS_DISPLAY_STATUS.BLOCKED
      : OPS_READINESS_DISPLAY_STATUS.NOT_ENABLED
  ];
}

/**
 * 敏感列脱敏就绪态：同为 Pigsty 运维页的派生展示态。
 * 非 anon_security_label 策略沿用 success —— 那类列由导出流程兜住，
 * 不是缺陷，只是换了条处理路径。
 */
export const SENSITIVE_COLUMN_MASKING_STATUS = {
  LABEL_APPLIED: 'LABEL_APPLIED',
  LABEL_PENDING: 'LABEL_PENDING',
  EXPORT_HANDLED: 'EXPORT_HANDLED',
} as const;

export type SensitiveColumnMaskingStatus =
  (typeof SENSITIVE_COLUMN_MASKING_STATUS)[keyof typeof SENSITIVE_COLUMN_MASKING_STATUS];

export const SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY: StatusRegistry<SensitiveColumnMaskingStatus> = {
  [SENSITIVE_COLUMN_MASKING_STATUS.LABEL_APPLIED]: {
    label: '标签已应用',
    tone: 'success',
  },
  [SENSITIVE_COLUMN_MASKING_STATUS.LABEL_PENDING]: {
    label: '待应用标签',
    tone: 'warning',
    dot: true,
  },
  [SENSITIVE_COLUMN_MASKING_STATUS.EXPORT_HANDLED]: {
    label: '需导出流程处理',
    tone: 'success',
  },
};

export function sensitiveColumnMaskingDefinition(
  maskingStrategy: string,
  anonLabelApplied: boolean,
): StatusDefinition {
  if (maskingStrategy !== 'anon_security_label') {
    return SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY[
      SENSITIVE_COLUMN_MASKING_STATUS.EXPORT_HANDLED
    ];
  }
  return SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY[
    anonLabelApplied
      ? SENSITIVE_COLUMN_MASKING_STATUS.LABEL_APPLIED
      : SENSITIVE_COLUMN_MASKING_STATUS.LABEL_PENDING
  ];
}
