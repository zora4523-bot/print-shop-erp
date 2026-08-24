import { describe, expect, it } from 'vitest';
import {
  BackgroundJobStatus,
  BillStatus,
  NotificationStatus,
  OrderChangeRequestStatus,
  OutsourceStatus,
  SalaryPeriodStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import {
  BACKGROUND_JOB_STATUS_REGISTRY,
  BILL_STATUS_REGISTRY,
  CUSTOMER_PRICE_BOOK_VERSION_STATUS,
  CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY,
  NOTIFICATION_STATUS_REGISTRY,
  ORDER_CHANGE_REQUEST_STATUS_REGISTRY,
  OUTSOURCE_STATUS_REGISTRY,
  PAYMENT_STATUS_REGISTRY,
  PRODUCTION_TASK_STATUS_REGISTRY,
  SALARY_PERIOD_DISPLAY_STATUS,
  SALARY_PERIOD_STATUS_REGISTRY,
  notificationStatusDefinition,
  paymentStatusDefinition,
  salaryPeriodStatusDefinition,
} from '../status-registry';

describe('status registry', () => {
  it('exhaustively covers persisted status enums', () => {
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
    expect(
      Object.keys(CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY).sort(),
    ).toEqual(Object.values(CUSTOMER_PRICE_BOOK_VERSION_STATUS).sort());
  });

  it('does not render queued, running, or unresolved work as danger', () => {
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
    expect(PRODUCTION_TASK_STATUS_REGISTRY[TaskStatus.PENDING].tone).toBe(
      'neutral',
    );
    expect(
      CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY[
        CUSTOMER_PRICE_BOOK_VERSION_STATUS.SCHEDULED
      ].tone,
    ).toBe('info');
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
    expect(
      CUSTOMER_PRICE_BOOK_VERSION_STATUS_REGISTRY[
        CUSTOMER_PRICE_BOOK_VERSION_STATUS.CURRENT
      ].tone,
    ).toBe('success');
  });

  it('uses consistent salary period and payment semantics', () => {
    expect(paymentStatusDefinition(true)).toEqual(
      PAYMENT_STATUS_REGISTRY.PAID,
    );
    expect(paymentStatusDefinition(false)).toEqual(
      PAYMENT_STATUS_REGISTRY.UNPAID,
    );
    expect(
      salaryPeriodStatusDefinition(SalaryPeriodStatus.IN_PROGRESS, {
        readyToSettle: true,
      }),
    ).toEqual(
      SALARY_PERIOD_STATUS_REGISTRY[
        SALARY_PERIOD_DISPLAY_STATUS.READY_TO_SETTLE
      ],
    );
    expect(
      SALARY_PERIOD_STATUS_REGISTRY[
        SALARY_PERIOD_DISPLAY_STATUS.READY_TO_SETTLE
      ].tone,
    ).toBe('warning');
  });
});
