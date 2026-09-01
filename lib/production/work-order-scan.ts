import {
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { getReporterOperationTypeOrNull } from './operation-portal';

export type WorkerWorkOrderScanTarget = {
  orderId: string;
  workOrderVersion: number;
  defaultTaskId: string;
  requestedTaskAllowed: boolean;
};

/**
 * Resolve a printed work-order QR for a worker without falling back to legacy
 * ProductionTask ownership. Visibility comes from the worker's fixed paid
 * lane plus shared no-pay progress, and every candidate must belong to the
 * order's current workOrderVersion.
 */
export async function resolveWorkerWorkOrderScan(
  orderNo: string,
  actor: { id: string; role: Role },
  requestedTaskId?: string,
): Promise<WorkerWorkOrderScanTarget | null> {
  const operationType = await getReporterOperationTypeOrNull(actor);
  const order = await db.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      workOrderVersion: true,
      productionOperations: {
        where: {
          operationType: operationType ?? { in: [] },
          status: { not: ProductionOperationStatus.CANCELLED },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, workOrderVersion: true },
      },
      productionProgressSteps: {
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, workOrderVersion: true },
      },
    },
  });
  if (!order) return null;

  const currentTaskIds = [
    ...order.productionOperations,
    ...order.productionProgressSteps,
  ]
    .filter((task) => task.workOrderVersion === order.workOrderVersion)
    .map((task) => task.id);
  const defaultTaskId = currentTaskIds[0];
  if (!defaultTaskId) return null;

  return {
    orderId: order.id,
    workOrderVersion: order.workOrderVersion,
    defaultTaskId,
    requestedTaskAllowed:
      requestedTaskId === undefined ||
      currentTaskIds.includes(requestedTaskId),
  };
}
