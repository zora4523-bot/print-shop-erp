import {
  BackgroundJobStatus,
  BillStatus,
  DesignBundleStatus,
  NotificationStatus,
  OrderChangeRequestStatus,
  OrderExportStatus,
  OrderStatus,
  OutsourceStatus,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  ProductionOperationStatus,
  SalaryPeriodStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';

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
  [OrderStatus.PENDING_FACTORY]: { label: '待工厂确认', tone: 'info' },
  [OrderStatus.SUBMITTED]: { label: '待工厂确认', tone: 'info' },
  [OrderStatus.SCHEDULING]: { label: '排产中', tone: 'info', dot: true },
  [OrderStatus.IN_PRODUCTION]: {
    label: '生产中',
    tone: 'info',
    dot: true,
  },
  [OrderStatus.COMPLETED]: { label: '已完工', tone: 'success' },
  [OrderStatus.SHIPPED]: { label: '已发货', tone: 'success' },
  [OrderStatus.FINISHED]: { label: '已完成', tone: 'neutral' },
  [OrderStatus.CANCELLED]: { label: '已取消', tone: 'danger' },
};

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

export const SALARY_PERIOD_DISPLAY_STATUS = {
  IN_PROGRESS: SalaryPeriodStatus.IN_PROGRESS,
  READY_TO_SETTLE: 'READY_TO_SETTLE',
  SETTLED: SalaryPeriodStatus.SETTLED,
} as const;

export type SalaryPeriodDisplayStatus =
  (typeof SALARY_PERIOD_DISPLAY_STATUS)[keyof typeof SALARY_PERIOD_DISPLAY_STATUS];

export const SALARY_PERIOD_STATUS_REGISTRY: StatusRegistry<SalaryPeriodDisplayStatus> = {
  [SALARY_PERIOD_DISPLAY_STATUS.IN_PROGRESS]: {
    label: '进行中',
    tone: 'info',
    dot: true,
  },
  [SALARY_PERIOD_DISPLAY_STATUS.READY_TO_SETTLE]: {
    label: '待结算',
    tone: 'warning',
    dot: true,
  },
  [SALARY_PERIOD_DISPLAY_STATUS.SETTLED]: {
    label: '已结算',
    tone: 'success',
  },
};

export function salaryPeriodStatusDefinition(
  status: SalaryPeriodStatus,
  options: { readyToSettle?: boolean } = {},
): StatusDefinition {
  const displayStatus =
    status === SalaryPeriodStatus.IN_PROGRESS &&
    options.readyToSettle === true
      ? SALARY_PERIOD_DISPLAY_STATUS.READY_TO_SETTLE
      : status;
  return SALARY_PERIOD_STATUS_REGISTRY[displayStatus];
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
 * CDR 的“过期”和 mock URL 是 READY 记录的展示态，不写回业务状态机。
 * 将它们放在 UI registry 中，避免页面重新发明标签或危险色。
 */
export const DESIGN_BUNDLE_DISPLAY_STATUS = {
  PENDING: DesignBundleStatus.PENDING,
  READY: DesignBundleStatus.READY,
  FAILED: DesignBundleStatus.FAILED,
  EXPIRED: 'EXPIRED',
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
