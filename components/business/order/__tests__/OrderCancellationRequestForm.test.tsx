import { describe, expect, it, vi } from 'vitest';

vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: vi.fn(),
}));

import { buildOrderCancellationRequestPayload } from '../OrderCancellationRequestForm';

describe('OrderCancellationRequestForm', () => {
  it('提交取消原因时绑定当前业务版本和纸质工单版本', () => {
    expect(
      buildOrderCancellationRequestPayload({
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        reason: '客户确认不再生产',
      }),
    ).toEqual({
      orderId: 'order-1',
      expectedRevision: 4,
      expectedWorkOrderVersion: 2,
      type: 'CANCEL',
      reason: '客户确认不再生产',
      items: [],
    });
  });
});
