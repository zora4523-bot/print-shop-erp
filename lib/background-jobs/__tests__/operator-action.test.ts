import { describe, expect, it } from 'vitest';
import { BackgroundJobStatus } from '../../../generated/prisma/enums';
import { backgroundJobOperatorAction } from '../operator-action';

describe('backgroundJobOperatorAction', () => {
  it('sends a dead export back to the order list instead of offering an invalid retry', () => {
    expect(
      backgroundJobOperatorAction({
        type: 'ORDER_EXPORT',
        status: BackgroundJobStatus.DEAD,
      }),
    ).toBe('REQUEST_NEW_EXPORT');
  });

  it('sends an ambiguous notification to the audited log workflow instead of offering a no-op retry', () => {
    expect(
      backgroundJobOperatorAction({
        type: 'NOTIFICATION',
        status: BackgroundJobStatus.DEAD,
        lastErrorCode: 'NotificationDeliveryUnknownError',
      }),
    ).toBe('RESOLVE_NOTIFICATION');
  });

  it('still offers retry for a definitively retryable notification failure', () => {
    expect(
      backgroundJobOperatorAction({
        type: 'NOTIFICATION',
        status: BackgroundJobStatus.DEAD,
        lastErrorCode: 'NotificationDeliveryFailedError',
      }),
    ).toBe('RETRY');
  });

  it.each([
    [BackgroundJobStatus.DEAD, 'NOTIFICATION', 'RETRY'],
    [BackgroundJobStatus.PENDING, 'ORDER_EXPORT', 'CANCEL'],
    [BackgroundJobStatus.RUNNING, 'ORDER_EXPORT', 'NONE'],
    [BackgroundJobStatus.SUCCEEDED, 'ORDER_EXPORT', 'NONE'],
    [BackgroundJobStatus.CANCELLED, 'ORDER_EXPORT', 'NONE'],
  ] as const)('maps %s %s to %s', (status, type, expected) => {
    expect(backgroundJobOperatorAction({ type, status })).toBe(expected);
  });
});
