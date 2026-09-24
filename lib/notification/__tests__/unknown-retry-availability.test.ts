import { describe, expect, it } from 'vitest';
import { unknownNotificationRetryUnavailableReason } from '../unknown-retry-availability';

describe('unknownNotificationRetryUnavailableReason', () => {
  it('allows resend for a durable delivery of a current event', () => {
    expect(
      unknownNotificationRetryUnavailableReason({
        deliveryKey: 'notification:ORDER_SUBMITTED:o-1',
        eventType: 'ORDER_SUBMITTED',
      }),
    ).toBeNull();
  });

  it('blocks resend when there is no durable background job', () => {
    expect(
      unknownNotificationRetryUnavailableReason({
        deliveryKey: null,
        eventType: 'ORDER_SUBMITTED',
      }),
    ).toBe('该消息缺少重发记录，无法自动重发');
  });

  it.each(['CS_PERIOD_ENDING', 'CS_PERIOD_SETTLED'])(
    'blocks resend for the retired event %s',
    (eventType) => {
      expect(
        unknownNotificationRetryUnavailableReason({
          deliveryKey: `notification:${eventType}:p-1`,
          eventType,
        }),
      ).toBe('该通知事件已停用，只能确认已送达或忽略');
    },
  );
});
