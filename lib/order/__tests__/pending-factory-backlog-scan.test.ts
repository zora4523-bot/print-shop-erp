import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import {
  pendingFactoryBacklogWhere,
  scanPendingFactoryBacklog,
  type PendingFactoryBacklogRepository,
} from '../pending-factory-backlog-scan';

function repository(
  count: number,
  oldest: { id: string; orderNo: string } | null = {
    id: 'order-oldest',
    orderNo: 'GD-260902-001',
  },
): PendingFactoryBacklogRepository {
  return {
    readSnapshot: vi.fn().mockResolvedValue({
      count,
      representativeOrder: oldest,
    }),
  };
}

describe('scanPendingFactoryBacklog', () => {
  it('scans canonical and legacy awaiting-confirmation rows only', () => {
    expect(pendingFactoryBacklogWhere()).toEqual({
      status: {
        in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED],
      },
    });
  });

  it('returns no candidate before the configured threshold is reached', async () => {
    const repo = repository(4);

    await expect(scanPendingFactoryBacklog(5, repo)).resolves.toBeNull();
    expect(repo.readSnapshot).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('anchors the aggregate at the oldest pending work order', async () => {
    const repo = repository(7);

    await expect(scanPendingFactoryBacklog(5, repo)).resolves.toEqual({
      count: 7,
      threshold: 5,
      representativeOrder: {
        id: 'order-oldest',
        orderNo: 'GD-260902-001',
      },
    });
  });

  it('fails closed when the consistent snapshot has no anchor', async () => {
    await expect(
      scanPendingFactoryBacklog(5, repository(5, null)),
    ).resolves.toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid threshold: %s', async (value) => {
    await expect(scanPendingFactoryBacklog(value, repository(5))).rejects.toThrow(
      /positive integer/,
    );
  });
});
