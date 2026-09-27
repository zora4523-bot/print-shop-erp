import { DesignFileType } from '../../generated/prisma/enums';
import { getWorkerTaskScopeFilter } from '../auth/task-scope';
import { db } from '../db';

/**
 * Historical ProductionTask rows remain readable for old salary links and
 * audit trails. This module intentionally exports no mutation, assignment,
 * claim, scheduling or pricing function.
 */
export async function getLegacyProductionTaskDetail(
  taskId: string,
  actor: Parameters<typeof getWorkerTaskScopeFilter>[0],
) {
  return db.productionTask.findFirst({
    where: { id: taskId, ...getWorkerTaskScopeFilter(actor) },
    select: {
      id: true,
      status: true,
      workerType: true,
      machineType: true,
      plannedQty: true,
      boardCount: true,
      pressCount: true,
      completedQty: true,
      defectQty: true,
      reworkQty: true,
      pieceworkAmount: true,
      startedAt: true,
      completedAt: true,
      orderItem: {
        select: {
          id: true,
          name: true,
          sequence: true,
          quantity: true,
          specification: true,
          paperType: true,
          foilColors: true,
          remark: true,
          isDoubleSided: true,
          isDoubleColor: true,
          designs: {
            where: { fileType: DesignFileType.IMAGE },
            orderBy: { uploadedAt: 'asc' },
            select: { id: true, fileName: true, fileUrl: true },
          },
          order: {
            select: {
              id: true,
              orderNo: true,
              customName: true,
              isUrgent: true,
              status: true,
              submitter: { select: { displayName: true } },
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
  });
}
