import { Prisma } from '../../generated/prisma/client';
import { FACTORY_CONFIRMATION_PENDING_STATUSES } from './factory-confirmation-preflight';

export type PendingFactoryBacklogCandidate = {
  count: number;
  threshold: number;
  representativeOrder: {
    id: string;
    orderNo: string;
  };
};

export type PendingFactoryBacklogRepository = {
  readSnapshot(threshold: number): Promise<{
    count: number;
    representativeOrder: { id: string; orderNo: string } | null;
  }>;
};

export function pendingFactoryBacklogWhere(): Prisma.OrderWhereInput {
  return {
    status: { in: [...FACTORY_CONFIRMATION_PENDING_STATUSES] },
  };
}

const databaseRepository: PendingFactoryBacklogRepository = {
  readSnapshot: async (threshold) => {
    const { db } = await import('../db');
    return db.$transaction(
      async (tx) => {
        const count = await tx.order.count({
          where: pendingFactoryBacklogWhere(),
        });
        if (count < threshold) {
          return { count, representativeOrder: null };
        }
        const representativeOrder = await tx.order.findFirst({
          where: pendingFactoryBacklogWhere(),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, orderNo: true },
        });
        return { count, representativeOrder };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  },
};

/**
 * Returns one aggregate alert anchored to the oldest pending work order.
 * The anchor gives the message a useful `#wo` deep link without exposing a
 * customer, amount, or an unbounded list of order numbers.
 */
export async function scanPendingFactoryBacklog(
  threshold: number,
  repository: PendingFactoryBacklogRepository = databaseRepository,
): Promise<PendingFactoryBacklogCandidate | null> {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new TypeError('pending factory backlog threshold must be a positive integer');
  }

  const { count, representativeOrder } =
    await repository.readSnapshot(threshold);
  if (count < threshold) return null;
  if (!representativeOrder) return null;

  return { count, threshold, representativeOrder };
}
