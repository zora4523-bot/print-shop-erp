import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
  NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE,
  backgroundJobRequiresOwnerResolution,
  isTerminalNotificationFailure,
} from '../terminal-policy';

describe('background job terminal policy', () => {
  it.each([
    'NotificationChannelTestDeliveryError',
    'TestChannelError',
    'UnexpectedSenderError',
  ])('never automatically retries a channel test after %s', (lastErrorCode) => {
    expect(
      isTerminalNotificationFailure({
        type: 'NOTIFICATION_CHANNEL_TEST',
        lastErrorCode,
      }),
    ).toBe(true);
  });

  it('reserves UNKNOWN notification jobs for audited owner resolution', () => {
    expect(
      backgroundJobRequiresOwnerResolution({
        type: 'NOTIFICATION',
        lastErrorCode: NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
      }),
    ).toBe(true);
    expect(
      backgroundJobRequiresOwnerResolution({
        type: 'CDR_BUNDLE',
        lastErrorCode: NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
      }),
    ).toBe(false);
  });

  it('terminates UNKNOWN and stale replay failures without treating ordinary transport failures as terminal', () => {
    for (const lastErrorCode of [
      NOTIFICATION_DELIVERY_UNKNOWN_ERROR_CODE,
      NOTIFICATION_REPLAY_TERMINAL_ERROR_CODE,
    ]) {
      expect(
        isTerminalNotificationFailure({
          type: 'NOTIFICATION',
          lastErrorCode,
        }),
      ).toBe(true);
    }
    expect(
      isTerminalNotificationFailure({
        type: 'NOTIFICATION',
        lastErrorCode: 'NotificationDeliveryFailedError',
      }),
    ).toBe(false);
  });
});
