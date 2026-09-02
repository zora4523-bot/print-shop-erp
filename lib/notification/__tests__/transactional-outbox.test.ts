import { beforeEach, describe, expect, it, vi } from 'vitest';

const { modeMock, enqueueMock } = vi.hoisted(() => ({
  modeMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock('../../background-jobs/mode', () => ({
  backgroundJobsMode: modeMock,
}));
vi.mock('../../background-jobs/notification', () => ({
  enqueueNotificationJob: enqueueMock,
}));

import { enqueueNotificationInTransaction } from '../transactional-outbox';
import type { EnqueueClient } from '../../background-jobs/repository';

const payload = {
  orderId: 'order-1',
  orderNo: 'O-1',
  workOrderVersion: 1,
  customerRef: null,
};
const tx = { backgroundJob: {}, $queryRaw: vi.fn() } as unknown as EnqueueClient;

beforeEach(() => {
  modeMock.mockReset();
  enqueueMock.mockReset().mockResolvedValue({
    jobId: 'job-1',
    created: true,
    requeued: false,
  });
});

describe('enqueueNotificationInTransaction', () => {
  it('passes the owning transaction to the durable ledger', async () => {
    modeMock.mockReturnValue('durable');

    await expect(
      enqueueNotificationInTransaction(
        tx,
        'ORDER_COMPLETED',
        payload,
        { dedupeKey: 'notification:ORDER_COMPLETED:order-1' },
      ),
    ).resolves.toBe(true);
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(
      'ORDER_COMPLETED',
      payload,
      { dedupeKey: 'notification:ORDER_COMPLETED:order-1' },
      tx,
    );
  });

  it('propagates enqueue failure so the surrounding business transaction rolls back', async () => {
    modeMock.mockReturnValue('durable');
    enqueueMock.mockRejectedValue(new Error('database write failed'));

    await expect(
      enqueueNotificationInTransaction(
        tx,
        'ORDER_COMPLETED',
        payload,
      ),
    ).rejects.toThrow('database write failed');
  });

  it('leaves inline dev/test delivery for the post-commit dispatcher', async () => {
    modeMock.mockReturnValue('inline');
    await expect(
      enqueueNotificationInTransaction(tx, 'ORDER_COMPLETED', payload),
    ).resolves.toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
