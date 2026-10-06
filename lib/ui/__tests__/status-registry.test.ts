import { describe, expect, it } from 'vitest';
import {
  BackgroundJobStatus,
  BillStatus,
  DesignBundleStatus,
  NotificationStatus,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderExportStatus,
  OrderStatus,
  OutsourceStatus,
  ProductionTaskDisputeStatus,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import type { RuleCenterEffect } from '@/lib/navigation/rule-center';
import type { PromisedDateAlert } from '@/lib/order/promised-date';
import * as statusRegistryModule from '../status-registry';
import {
  ACTIVE_DISPLAY_STATUS,
  ACTIVE_STATUS_REGISTRY,
  BACKGROUND_JOB_STATUS_REGISTRY,
  BILL_STATUS_REGISTRY,
  CUSTOMER_PRICE_BOOK_VERSION_STATUS,
  CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY,
  DESIGN_BUNDLE_DISPLAY_STATUS,
  DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY,
  NOTIFICATION_STATUS_REGISTRY,
  OPS_READINESS_DISPLAY_STATUS,
  OPS_READINESS_STATUS_REGISTRY,
  ORDER_CHANGE_REQUEST_STATUS_REGISTRY,
  ORDER_CHANGE_REQUEST_TYPE_REGISTRY,
  ORDER_EXPORT_STATUS_REGISTRY,
  ORDER_STATUS_REGISTRY,
  OUTSOURCE_STATUS_REGISTRY,
  PAYMENT_STATUS_REGISTRY,
  PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY,
  PRODUCTION_TASK_STATUS_REGISTRY,
  PROMISED_DATE_ALERT_REGISTRY,
  PROMISED_DATE_ALERT_STATUS,
  PURCHASE_ORDER_STATUS_REGISTRY,
  PURCHASE_RECEIPT_STATUS_REGISTRY,
  RULE_CENTER_EFFECT_REGISTRY,
  SALARY_FLOOR_DISPLAY_STATUS,
  SALARY_FLOOR_STATUS_REGISTRY,
  SENSITIVE_COLUMN_MASKING_STATUS,
  SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY,
  SHIPMENT_STATUS_REGISTRY,
  activeStatusDefinition,
  notificationStatusDefinition,
  opsReadinessDefinition,
  paymentStatusDefinition,
  promisedDateAlertDefinition,
  salaryFloorStatusDefinition,
  sensitiveColumnMaskingDefinition,
  statusFilterLabel,
  type StatusDefinition,
  type StatusTone,
} from '../status-registry';

const LEGAL_TONES: readonly StatusTone[] = [
  'primary',
  'warning',
  'info',
  'success',
  'danger',
  'neutral',
];

function isStatusDefinition(value: unknown): value is StatusDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { label?: unknown }).label === 'string' &&
    typeof (value as { tone?: unknown }).tone === 'string'
  );
}

/**
 * 所有以 `_REGISTRY` 结尾的导出，连同它们的每一条定义。新增注册表无需
 * 修改这份清单——忘了给它写专属断言时，通用契约仍然兜得住。
 */
function allRegistryEntries(): Array<[string, string, StatusDefinition]> {
  const entries: Array<[string, string, StatusDefinition]> = [];
  for (const [exportName, exported] of Object.entries(statusRegistryModule)) {
    if (!exportName.endsWith('_REGISTRY')) continue;
    for (const [key, definition] of Object.entries(
      exported as Record<string, unknown>,
    )) {
      expect(isStatusDefinition(definition), `${exportName}.${key}`).toBe(true);
      entries.push([exportName, key, definition as StatusDefinition]);
    }
  }
  return entries;
}

describe('status registry', () => {
  it('gives every registry entry a legal tone and a non-empty label', () => {
    const entries = allRegistryEntries();
    // 注册表数量只增不减；写死一个下界，防止改名后整轮通用契约悄悄空跑。
    expect(new Set(entries.map(([name]) => name)).size).toBeGreaterThanOrEqual(
      20,
    );
    for (const [exportName, key, definition] of entries) {
      const where = `${exportName}.${key}`;
      expect(LEGAL_TONES, where).toContain(definition.tone);
      expect(definition.label.trim(), where).not.toBe('');
      if (definition.filterLabel !== undefined) {
        expect(definition.filterLabel.trim(), where).not.toBe('');
      }
      // §7 文案十律：不得外显内部枚举值。
      expect(definition.label, where).not.toMatch(/^[A-Z][A-Z0-9_]*$/u);
    }
  });

  it('exhaustively covers persisted status enums', () => {
    expect(Object.keys(ORDER_STATUS_REGISTRY).sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
    expect(Object.keys(BILL_STATUS_REGISTRY).sort()).toEqual(
      Object.values(BillStatus).sort(),
    );
    expect(Object.keys(NOTIFICATION_STATUS_REGISTRY).sort()).toEqual(
      Object.values(NotificationStatus).sort(),
    );
    expect(Object.keys(BACKGROUND_JOB_STATUS_REGISTRY).sort()).toEqual(
      Object.values(BackgroundJobStatus).sort(),
    );
    expect(Object.keys(ORDER_CHANGE_REQUEST_STATUS_REGISTRY).sort()).toEqual(
      Object.values(OrderChangeRequestStatus).sort(),
    );
    expect(Object.keys(OUTSOURCE_STATUS_REGISTRY).sort()).toEqual(
      Object.values(OutsourceStatus).sort(),
    );
    expect(Object.keys(PRODUCTION_TASK_STATUS_REGISTRY).sort()).toEqual(
      Object.values(TaskStatus).sort(),
    );
    expect(Object.keys(SHIPMENT_STATUS_REGISTRY).sort()).toEqual(
      Object.values(ShipmentStatus).sort(),
    );
    expect(Object.keys(PURCHASE_ORDER_STATUS_REGISTRY).sort()).toEqual(
      Object.values(PurchaseOrderStatus).sort(),
    );
    expect(Object.keys(PURCHASE_RECEIPT_STATUS_REGISTRY).sort()).toEqual(
      Object.values(PurchaseReceiptStatus).sort(),
    );
    expect(Object.keys(ORDER_EXPORT_STATUS_REGISTRY).sort()).toEqual(
      Object.values(OrderExportStatus).sort(),
    );
    expect(
      Object.values(DesignBundleStatus).every(
        (status) => status in DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY,
      ),
    ).toBe(true);
    expect(Object.keys(DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY).sort()).toEqual(
      Object.values(DESIGN_BUNDLE_DISPLAY_STATUS).sort(),
    );
    expect(
      Object.keys(CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY).sort(),
    ).toEqual(Object.values(CUSTOMER_PRICE_BOOK_VERSION_STATUS).sort());
    expect(Object.keys(ORDER_CHANGE_REQUEST_TYPE_REGISTRY).sort()).toEqual(
      Object.values(OrderChangeRequestType).sort(),
    );
    expect(
      Object.keys(PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY).sort(),
    ).toEqual(Object.values(ProductionTaskDisputeStatus).sort());
  });

  it('exhaustively covers the derived display unions', () => {
    expect(Object.keys(ACTIVE_STATUS_REGISTRY).sort()).toEqual(
      Object.values(ACTIVE_DISPLAY_STATUS).sort(),
    );
    expect(Object.keys(SALARY_FLOOR_STATUS_REGISTRY).sort()).toEqual(
      Object.values(SALARY_FLOOR_DISPLAY_STATUS).sort(),
    );
    expect(Object.keys(OPS_READINESS_STATUS_REGISTRY).sort()).toEqual(
      Object.values(OPS_READINESS_DISPLAY_STATUS).sort(),
    );
    expect(
      Object.keys(SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY).sort(),
    ).toEqual(Object.values(SENSITIVE_COLUMN_MASKING_STATUS).sort());
    expect(Object.keys(PROMISED_DATE_ALERT_REGISTRY).sort()).toEqual(
      Object.values(PROMISED_DATE_ALERT_STATUS).sort(),
    );

    // 交期预警的 key 必须与 promisedDateAlert() 返回的 kind 逐字一致，
    // 否则调用方还得再写一层映射——这里同时靠类型标注做编译期约束。
    const alertKinds: readonly PromisedDateAlert['kind'][] = Object.values(
      PROMISED_DATE_ALERT_STATUS,
    );
    expect([...alertKinds].sort()).toEqual(['due-soon', 'overdue']);

    const ruleCenterEffects: readonly RuleCenterEffect[] = [
      'mixed',
      'versioned',
      'immediate',
      'effective-dated',
    ];
    expect(Object.keys(RULE_CENTER_EFFECT_REGISTRY).sort()).toEqual(
      [...ruleCenterEffects].sort(),
    );
  });

  it('marks the migration-only order statuses without leaking the enum', () => {
    // status-machine.ts：SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED
    // 只存在于迁移前的老行。后缀写在 registry 而不是工作台本地表，
    // 否则同一状态在管理端会有两个名字。
    for (const status of [
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.COMPLETED,
      OrderStatus.FINISHED,
    ] as const) {
      expect(ORDER_STATUS_REGISTRY[status].label).toContain('（历史）');
    }
    // SUBMITTED 与 PENDING_FACTORY 同名，标记它等于把枚举差异外显。
    expect(ORDER_STATUS_REGISTRY[OrderStatus.SUBMITTED].label).toBe('待完善');
    expect(ORDER_STATUS_REGISTRY[OrderStatus.SHIPPED].label).toBe('已发货');
  });

  it('does not render queued, running, or unresolved work as danger', () => {
    expect(ORDER_STATUS_REGISTRY[OrderStatus.PENDING_FACTORY]).toMatchObject({
      label: '待完善',
      tone: 'info',
    });
    expect(ORDER_STATUS_REGISTRY[OrderStatus.SUBMITTED].label).toBe(
      '待完善',
    );
    expect(ORDER_STATUS_REGISTRY[OrderStatus.IN_PRODUCTION].tone).toBe('info');
    expect(BILL_STATUS_REGISTRY[BillStatus.ISSUED].tone).toBe('warning');
    expect(
      NOTIFICATION_STATUS_REGISTRY[NotificationStatus.SENDING].tone,
    ).toBe('info');
    expect(
      NOTIFICATION_STATUS_REGISTRY[NotificationStatus.RETRYING].tone,
    ).toBe('warning');
    expect(
      NOTIFICATION_STATUS_REGISTRY[NotificationStatus.UNKNOWN].tone,
    ).toBe('warning');
    expect(
      BACKGROUND_JOB_STATUS_REGISTRY[BackgroundJobStatus.PENDING].tone,
    ).toBe('neutral');
    expect(
      BACKGROUND_JOB_STATUS_REGISTRY[BackgroundJobStatus.RUNNING].tone,
    ).toBe('info');
    expect(
      ORDER_CHANGE_REQUEST_STATUS_REGISTRY[
        OrderChangeRequestStatus.PENDING
      ].tone,
    ).toBe('warning');
    expect(OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.SENT].tone).toBe('info');
    expect(OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.IN_PROGRESS].tone).toBe(
      'info',
    );
    expect(PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.PENDING].tone).toBe(
      'neutral',
    );
    expect(SHIPMENT_STATUS_REGISTRY[ShipmentStatus.PLANNED].tone).toBe(
      'warning',
    );
    expect(
      PURCHASE_ORDER_STATUS_REGISTRY[PurchaseOrderStatus.ORDERED].tone,
    ).toBe('info');
    expect(
      PURCHASE_ORDER_STATUS_REGISTRY[
        PurchaseOrderStatus.PARTIALLY_RECEIVED
      ].tone,
    ).toBe('warning');
    expect(
      ORDER_EXPORT_STATUS_REGISTRY[OrderExportStatus.PENDING].tone,
    ).toBe('info');
    expect(
      DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[
        DESIGN_BUNDLE_DISPLAY_STATUS.PENDING
      ].tone,
    ).toBe('info');
    expect(
      ORDER_EXPORT_STATUS_REGISTRY[OrderExportStatus.EXPIRED].tone,
    ).toBe('neutral');
    expect(
      DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[
        DESIGN_BUNDLE_DISPLAY_STATUS.EXPIRED
      ].tone,
    ).toBe('neutral');
    expect(
      DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[
        DESIGN_BUNDLE_DISPLAY_STATUS.MOCK
      ].tone,
    ).toBe('neutral');
    expect(
      CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY[
        CUSTOMER_PRICE_BOOK_VERSION_STATUS.SCHEDULED
      ].tone,
    ).toBe('info');
    expect(
      PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY[
        ProductionTaskDisputeStatus.PENDING
      ],
    ).toMatchObject({ label: '待处理', tone: 'warning', dot: true });
    // 停用是正常收口、不是失败；「申请取消」是一次待审的请求，红色要留给
    // 同一行的「已拒绝 / 已撤销」。
    expect(ACTIVE_STATUS_REGISTRY[ACTIVE_DISPLAY_STATUS.DISABLED].tone).toBe(
      'neutral',
    );
    expect(
      ORDER_CHANGE_REQUEST_TYPE_REGISTRY[OrderChangeRequestType.CANCEL].tone,
    ).toBe('neutral');
    expect(
      ORDER_CHANGE_REQUEST_TYPE_REGISTRY[OrderChangeRequestType.MODIFY].tone,
    ).toBe('neutral');
    // 「按保底补足」是保护师傅的兜底机制，不是异常。
    expect(
      SALARY_FLOOR_STATUS_REGISTRY[
        SALARY_FLOOR_DISPLAY_STATUS.TOPPED_UP_TO_FLOOR
      ].tone,
    ).toBe('info');
    expect(
      SALARY_FLOOR_STATUS_REGISTRY[SALARY_FLOOR_DISPLAY_STATUS.AT_FLOOR].tone,
    ).toBe('neutral');
    expect(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.BLOCKED].tone,
    ).toBe('warning');
    expect(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.NOT_ENABLED]
        .tone,
    ).toBe('neutral');
    expect(
      SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY[
        SENSITIVE_COLUMN_MASKING_STATUS.LABEL_PENDING
      ].tone,
    ).toBe('warning');
    expect(
      PROMISED_DATE_ALERT_REGISTRY[PROMISED_DATE_ALERT_STATUS.DUE_SOON].tone,
    ).toBe('warning');
    expect(RULE_CENTER_EFFECT_REGISTRY.mixed.tone).toBe('neutral');
  });

  it('reserves danger for failed, cancelled, dead, or exhausted states', () => {
    expect(
      NOTIFICATION_STATUS_REGISTRY[NotificationStatus.FAILED].tone,
    ).toBe('danger');
    expect(
      notificationStatusDefinition(NotificationStatus.RETRYING, {
        hasDeadLetterJob: true,
      }),
    ).toMatchObject({ label: '重试耗尽', tone: 'danger' });
    expect(
      BACKGROUND_JOB_STATUS_REGISTRY[BackgroundJobStatus.DEAD].tone,
    ).toBe('danger');
    expect(
      BACKGROUND_JOB_STATUS_REGISTRY[BackgroundJobStatus.CANCELLED].tone,
    ).toBe('danger');
    expect(
      ORDER_CHANGE_REQUEST_STATUS_REGISTRY[
        OrderChangeRequestStatus.REJECTED
      ].tone,
    ).toBe('danger');
    expect(
      OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.CANCELLED].tone,
    ).toBe('danger');
    expect(
      PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.CANCELLED].tone,
    ).toBe('danger');
    expect(
      PURCHASE_ORDER_STATUS_REGISTRY[PurchaseOrderStatus.CANCELLED].tone,
    ).toBe('danger');
    expect(
      PURCHASE_RECEIPT_STATUS_REGISTRY[PurchaseReceiptStatus.CANCELLED].tone,
    ).toBe('danger');
    expect(
      ORDER_EXPORT_STATUS_REGISTRY[OrderExportStatus.FAILED].tone,
    ).toBe('danger');
    expect(
      DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[
        DESIGN_BUNDLE_DISPLAY_STATUS.FAILED
      ].tone,
    ).toBe('danger');
    expect(
      PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY[
        ProductionTaskDisputeStatus.REJECTED
      ].tone,
    ).toBe('danger');
    // 逾期 = 承诺交期已经过去，是一次已经发生的履约失败，不是「留意一下」；
    // 与 3 天内到期的 warning 必须分档，否则升级关系在颜色上就丢了。
    expect(
      PROMISED_DATE_ALERT_REGISTRY[PROMISED_DATE_ALERT_STATUS.OVERDUE].tone,
    ).toBe('danger');
  });

  it('keeps completed and current domain work positive', () => {
    expect(
      ORDER_CHANGE_REQUEST_STATUS_REGISTRY[
        OrderChangeRequestStatus.APPROVED
      ].tone,
    ).toBe('success');
    expect(OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.RECEIVED].tone).toBe(
      'success',
    );
    expect(PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.COMPLETED].tone).toBe(
      'success',
    );
    expect(SHIPMENT_STATUS_REGISTRY[ShipmentStatus.SHIPPED].tone).toBe(
      'success',
    );
    expect(
      PURCHASE_ORDER_STATUS_REGISTRY[PurchaseOrderStatus.RECEIVED].tone,
    ).toBe('success');
    expect(
      PURCHASE_RECEIPT_STATUS_REGISTRY[PurchaseReceiptStatus.POSTED].tone,
    ).toBe('success');
    expect(
      ORDER_EXPORT_STATUS_REGISTRY[OrderExportStatus.READY].tone,
    ).toBe('success');
    expect(
      DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[
        DESIGN_BUNDLE_DISPLAY_STATUS.READY
      ].tone,
    ).toBe('success');
    expect(
      CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY[
        CUSTOMER_PRICE_BOOK_VERSION_STATUS.CURRENT
      ].tone,
    ).toBe('success');
    expect(
      PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY[
        ProductionTaskDisputeStatus.RESOLVED
      ].tone,
    ).toBe('success');
    expect(ACTIVE_STATUS_REGISTRY[ACTIVE_DISPLAY_STATUS.ENABLED].tone).toBe(
      'success',
    );
    expect(
      SALARY_FLOOR_STATUS_REGISTRY[SALARY_FLOOR_DISPLAY_STATUS.ABOVE_FLOOR]
        .tone,
    ).toBe('success');
    expect(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.READY].tone,
    ).toBe('success');
    expect(
      SENSITIVE_COLUMN_MASKING_STATUS_REGISTRY[
        SENSITIVE_COLUMN_MASKING_STATUS.LABEL_APPLIED
      ].tone,
    ).toBe('success');
    // 业务状态注册表的约定：圆点标记「在途 / 需要跟进」，落定的 success
    // 终态不带点。RULE_CENTER_EFFECT_REGISTRY 例外——它标的是规则的生效
    // 方式而不是一件事的进度，圆点在那里只用来把三种具体生效方式与
    // 「分域生效」区分开，沿用页头徽章既有视觉。
    for (const [exportName, key, definition] of allRegistryEntries()) {
      if (exportName === 'RULE_CENTER_EFFECT_REGISTRY') continue;
      if (definition.tone !== 'success') continue;
      expect(definition.dot ?? false, `${exportName}.${key}`).toBe(false);
    }
  });

  it('uses consistent payment semantics', () => {
    expect(paymentStatusDefinition(true)).toEqual(
      PAYMENT_STATUS_REGISTRY.PAID,
    );
    expect(paymentStatusDefinition(false)).toEqual(
      PAYMENT_STATUS_REGISTRY.UNPAID,
    );
  });

  it('derives active, salary-floor, readiness and masking definitions', () => {
    expect(activeStatusDefinition(true)).toEqual(
      ACTIVE_STATUS_REGISTRY[ACTIVE_DISPLAY_STATUS.ENABLED],
    );
    expect(activeStatusDefinition(false)).toEqual(
      ACTIVE_STATUS_REGISTRY[ACTIVE_DISPLAY_STATUS.DISABLED],
    );

    // 入参是 Decimal#cmp 的返回值：正数 / 0 / 负数。
    expect(salaryFloorStatusDefinition(1).label).toBe('计件高于保底');
    expect(salaryFloorStatusDefinition(0).label).toBe('计件等于保底');
    expect(salaryFloorStatusDefinition(-1).label).toBe('按保底补足');

    expect(opsReadinessDefinition(true, [])).toEqual(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.READY],
    );
    expect(opsReadinessDefinition(true, ['ignored'])).toEqual(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.READY],
    );
    expect(opsReadinessDefinition(false, ['pg_cron 未安装'])).toEqual(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.BLOCKED],
    );
    expect(opsReadinessDefinition(false, [])).toEqual(
      OPS_READINESS_STATUS_REGISTRY[OPS_READINESS_DISPLAY_STATUS.NOT_ENABLED],
    );

    expect(
      sensitiveColumnMaskingDefinition('anon_security_label', true).label,
    ).toBe('标签已应用');
    expect(
      sensitiveColumnMaskingDefinition('anon_security_label', false).label,
    ).toBe('待应用标签');
    expect(sensitiveColumnMaskingDefinition('export_redaction', false).label).toBe(
      '需导出流程处理',
    );
  });

  it('renders promised-date alerts with the day count baked into the label', () => {
    expect(
      promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.OVERDUE, 5),
    ).toEqual({ label: '逾期 5 天', tone: 'danger' });
    expect(
      promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.OVERDUE, 1),
    ).toEqual({ label: '逾期 1 天', tone: 'danger' });
    expect(
      promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.DUE_SOON, 0),
    ).toEqual({ label: '今天到期', tone: 'warning' });
    expect(
      promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.DUE_SOON, 2),
    ).toEqual({ label: '剩 2 天', tone: 'warning' });
    // 组装出来的定义不得污染注册表本体。
    expect(
      PROMISED_DATE_ALERT_REGISTRY[PROMISED_DATE_ALERT_STATUS.OVERDUE].label,
    ).toBe('逾期');
  });

  it('keeps precise filter wording without duplicating local label maps', () => {
    expect(
      statusFilterLabel(PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.PENDING]),
    ).toBe('待生产');
    expect(
      statusFilterLabel(
        PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.IN_PROGRESS],
      ),
    ).toBe('生产中');
    expect(
      statusFilterLabel(OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.SENT]),
    ).toBe('已发送');
    expect(
      statusFilterLabel(OUTSOURCE_STATUS_REGISTRY[OutsourceStatus.RECEIVED]),
    ).toBe('已收货');
    expect(
      statusFilterLabel(SHIPMENT_STATUS_REGISTRY[ShipmentStatus.PLANNED]),
    ).toBe('待发货');
  });
});

describe('customer charge display status (2026-10-01 D-10)', () => {
  it('keeps the original precedence: confirmed > trusted admin review > waived > amount pending > estimate', () => {
    const { customerChargeDisplayStatus, CUSTOMER_CHARGE_STATUS_REGISTRY } = statusRegistryModule;
    const label = (status: string, trusted: boolean) =>
      CUSTOMER_CHARGE_STATUS_REGISTRY[customerChargeDisplayStatus(status, trusted)].label;
    expect(label('FINAL', true)).toBe('已确认');
    expect(label('FINAL', false)).toBe('已确认');
    expect(label('ESTIMATED', true)).toBe('已人工核对（待结算）');
    expect(label('WAIVED', true)).toBe('已人工核对（待结算）');
    expect(label('WAIVED', false)).toBe('已免收');
    expect(label('PENDING_AMOUNT', false)).toBe('金额待定');
    expect(label('ESTIMATED', false)).toBe('创建时估算');
    // 业主 2026-10-01：估算用 info，不与已定稿的 neutral 混在一起。
    expect(
      CUSTOMER_CHARGE_STATUS_REGISTRY[customerChargeDisplayStatus('ESTIMATED', false)].tone,
    ).toBe('info');
    // 正常的估算、免收与人工核对都不是失败，不用 danger。
    for (const definition of Object.values(CUSTOMER_CHARGE_STATUS_REGISTRY)) {
      expect(definition.tone).not.toBe('danger');
    }
  });
});
