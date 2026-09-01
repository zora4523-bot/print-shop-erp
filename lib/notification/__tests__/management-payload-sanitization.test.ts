import { describe, expect, it } from 'vitest';
import { sanitizeNotificationPayload } from '../events';

describe('management notification payload sanitization', () => {
  it('reduces a legacy new-order payload to order number, safe summary and #wo link', () => {
    const result = sanitizeNotificationPayload('ORDER_SUBMITTED', {
      orderId: 'order-1',
      orderNo: 'GD 260902/001',
      submitterName: '张三',
      customerRef: '秘密客户',
      totalAmount: '9999.00',
      urgentMark: '🚨 急单',
      summary: '客户和金额都不应持久化',
      deepLink: '/wrong-link',
    });

    expect(result).toEqual({
      orderId: 'order-1',
      orderNo: 'GD 260902/001',
      summary: '新工单已提交，待工厂确认',
      deepLink: '/orders#wo=GD%20260902%2F001',
    });
  });

  it.each([
    'ORDER_CHANGE_REQUESTED',
    'PRODUCTION_PROGRESS_ANOMALY',
    'PRODUCTION_STAGNANT',
    'PENDING_FACTORY_BACKLOG',
  ] as const)('drops extra fields before persisting %s', (event) => {
    const result = sanitizeNotificationPayload(event, {
      orderId: 'order-1',
      orderNo: 'GD-260902-001',
      summary: '只保留业务摘要',
      deepLink: '/wrong-link',
      totalAmount: '9999.00',
      customerPhone: '13800000000',
    } as never) as unknown as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual([
      'deepLink',
      'orderId',
      'orderNo',
      'summary',
    ]);
    expect(result.deepLink).toBe('/orders#wo=GD-260902-001');
    expect(result).not.toHaveProperty('totalAmount');
    expect(result).not.toHaveProperty('customerPhone');
  });
});
