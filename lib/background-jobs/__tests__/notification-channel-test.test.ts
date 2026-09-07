import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testChannelMock } = vi.hoisted(() => ({ testChannelMock: vi.fn() }));

vi.mock('@/lib/notification/test-channel', () => ({
  testChannel: testChannelMock,
}));

import {
  handleNotificationChannelTestJob,
  InvalidNotificationChannelTestPayloadError,
  NotificationChannelTestDeliveryError,
} from '../notification-channel-test';

const job = {
  id: 'job-1',
  type: 'NOTIFICATION_CHANNEL_TEST',
  queue: 'LIGHT',
  dedupeKey: 'notification-channel-test:channel-1:request-1',
  payload: { channelId: 'channel-1' },
  attempts: 1,
  maxAttempts: 1,
  workerId: 'worker-1',
  claimedAt: new Date('2026-09-03T00:00:00Z'),
} as const;

beforeEach(() => testChannelMock.mockReset());

describe('notification channel test background job', () => {
  it('runs through the worker-only transport path', async () => {
    testChannelMock.mockResolvedValue({ ok: true, mock: false });
    await expect(handleNotificationChannelTestJob(job)).resolves.toEqual({
      delivered: true,
      mock: false,
    });
    expect(testChannelMock).toHaveBeenCalledExactlyOnceWith('channel-1', {
      runInWorker: true,
    });
  });

  it('rejects malformed payload before calling the transport', async () => {
    await expect(
      handleNotificationChannelTestJob({ ...job, payload: {} }),
    ).rejects.toBeInstanceOf(InvalidNotificationChannelTestPayloadError);
    expect(testChannelMock).not.toHaveBeenCalled();
  });

  it('fails a one-attempt job when the provider does not confirm delivery', async () => {
    testChannelMock.mockResolvedValue({
      ok: false,
      mock: false,
      errorMessage: 'redacted provider failure',
    });
    await expect(handleNotificationChannelTestJob(job)).rejects.toBeInstanceOf(
      NotificationChannelTestDeliveryError,
    );
  });
});
