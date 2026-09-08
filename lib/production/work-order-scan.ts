import {
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { getReporterOperationTypeOrNull } from './operation-portal';

export type WorkerWorkOrderScanTarget = {
  orderId: string;
  workOrderVersion: number;
  /** Only a single unfinished task may bypass the task picker. */
  defaultTaskId: string | null;
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
        select: { id: true, workOrderVersion: true, status: true },
      },
      productionProgressSteps: {
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, workOrderVersion: true, status: true },
      },
    },
  });
  if (!order) return null;

  const currentTasks = [
    ...order.productionOperations,
    ...order.productionProgressSteps,
  ]
    .filter((task) => task.workOrderVersion === order.workOrderVersion);
  if (currentTasks.length === 0) return null;
  const unfinishedTasks = currentTasks.filter(
    (task) => task.status === ProductionOperationStatus.PENDING ||
      task.status === ProductionOperationStatus.IN_PROGRESS,
  );

  return {
    orderId: order.id,
    workOrderVersion: order.workOrderVersion,
    defaultTaskId: unfinishedTasks.length === 1 ? unfinishedTasks[0]!.id : null,
    requestedTaskAllowed:
      requestedTaskId === undefined ||
      currentTasks.some((task) => task.id === requestedTaskId),
  };
}
