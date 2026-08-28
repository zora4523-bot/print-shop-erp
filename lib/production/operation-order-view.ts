import { db } from '../db';

/**
 * Read model for normal order detail pages. Production operations are
 * order-level lanes, while sources preserve which item or packaging group
 * contributed the quantity. No worker assignment or capacity fact is read.
 */
export async function listOrderProductionOperations(orderId: string) {
  return db.productionOperation.findMany({
    where: { orderId },
    select: {
      id: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      sources: {
        select: {
          orderItemId: true,
          packagingGroupId: true,
          sourceQty: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ operationType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** Read-only no-pay progress for admin and normal order detail pages. */
export async function listOrderProductionProgressSteps(orderId: string) {
  return db.productionProgressStep.findMany({
    where: { orderId },
    select: {
      id: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
      orderItemId: true,
      orderItem: { select: { sequence: true, name: true } },
      reports: {
        select: {
          completedQty: true,
          defectQty: true,
          reworkQty: true,
        },
        orderBy: { reportedAt: 'asc' },
      },
    },
    orderBy: [
      { orderItem: { sequence: 'asc' } },
      { craftCode: 'asc' },
      { id: 'asc' },
    ],
  });
}
