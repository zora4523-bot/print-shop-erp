import { db } from '../db';

/**
 * Read model for normal order detail pages. Production operations are
 * order-level lanes, while sources preserve which item or packaging group
 * contributed the quantity. No worker assignment or capacity fact is read.
 */
export async function listOrderProductionOperations(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { workOrderVersion: true },
  });
  if (!order) return [];
  return db.productionOperation.findMany({
    where: { orderId, workOrderVersion: order.workOrderVersion },
    select: {
      id: true,
      operationType: true,
      unit: true,
      status: true,
      payrollPassCount: true,
      payrollRevision: true,
      plannedQty: true,
      carriedCompletedQty: true,
      sources: {
        select: {
          orderItem: { select: { sequence: true, frontFoilColors: true, backFoilColors: true } },
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
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { workOrderVersion: true },
  });
  if (!order) return [];
  return db.productionProgressStep.findMany({
    where: { orderId, workOrderVersion: order.workOrderVersion },
    select: {
      id: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
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
