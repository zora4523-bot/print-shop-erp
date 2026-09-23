import {
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { getProgressCraftIdsForReporter, getReporterOperationTypeOrNull } from './operation-portal';

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
 * order's current workOrderVersion. Direct jumps (the single unfinished task
 * and an explicit ?task=) only target the reporter's own lanes: other-lane
 * progress would 404 on the task page.
 */
export async function resolveWorkerWorkOrderScan(
  orderNo: string,
  actor: { id: string; role: Role },
  requestedTaskId?: string,
): Promise<WorkerWorkOrderScanTarget | null> {
  const operationType = await getReporterOperationTypeOrNull(actor);
  const progressCraftIds = new Set(await getProgressCraftIdsForReporter(actor));
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
        select: { id: true, workOrderVersion: true, status: true, craftId: true },
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
  const ownLaneTasks = [
    ...order.productionOperations,
    ...order.productionProgressSteps.filter((step) => progressCraftIds.has(step.craftId)),
  ].filter((task) => task.workOrderVersion === order.workOrderVersion);
  const unfinishedTasks = ownLaneTasks.filter(
    (task) => task.status === ProductionOperationStatus.PENDING ||
      task.status === ProductionOperationStatus.IN_PROGRESS,
  );

  return {
    orderId: order.id,
    workOrderVersion: order.workOrderVersion,
    defaultTaskId: unfinishedTasks.length === 1 ? unfinishedTasks[0]!.id : null,
    requestedTaskAllowed:
      requestedTaskId === undefined ||
      ownLaneTasks.some((task) => task.id === requestedTaskId),
  };
}
