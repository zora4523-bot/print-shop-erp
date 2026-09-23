import type { Prisma } from '../../generated/prisma/client';
import { ProductionOperationStatus } from '../../generated/prisma/enums';
import { reportUsesTieredFoilWage } from '../salary/tiered-foil-report';

const UNFINISHED = [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS];

/**
 * 工单升版后，旧代次未结束的工序与无计件进度步骤再也不能报工（代次守卫），会永远停在
 * 待开工/进行中，分档烫金的计件结算也就一直等不到“工序结束”。在同一升版事务里把它们
 * 终止为已取消（代次触发器只禁止改 orderId / workOrderVersion，状态可以改）；其中带
 * 分档烫金报工的工序标记为需人工核定，由管理员在工单提成明细确认后才能结算，
 * 固定费在前后代次之间怎么分不自动改算。调用方须已持有该工单的级联锁。
 */
export async function supersedePreviousProductionGenerationInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  currentWorkOrderVersion: number,
): Promise<{ operationIds: string[]; payrollReviewOperationIds: string[]; progressStepIds: string[] }> {
  const superseded = { orderId, workOrderVersion: { lt: currentWorkOrderVersion }, status: { in: UNFINISHED } };
  const operations = await tx.productionOperation.findMany({
    where: superseded,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      operationType: true,
      reports: { select: { unit: true, priceBook: { select: { rules: { select: { operationType: true, unit: true, smallOrderAmount: true } } } } } },
    },
  });
  const operationIds = operations.map((operation) => operation.id);
  const payrollReviewOperationIds = operations
    .filter((operation) => operation.reports.some((report) => reportUsesTieredFoilWage(operation.operationType, report)))
    .map((operation) => operation.id);
  if (payrollReviewOperationIds.length > 0) {
    await tx.productionOperation.updateMany({ where: { id: { in: payrollReviewOperationIds } }, data: { payrollReviewRequired: true } });
  }
  if (operationIds.length > 0) {
    await tx.productionOperation.updateMany({
      where: { id: { in: operationIds }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
  }
  const progressStepIds = (await tx.productionProgressStep.findMany({ where: superseded, select: { id: true } })).map((step) => step.id);
  if (progressStepIds.length > 0) {
    await tx.productionProgressStep.updateMany({
      where: { id: { in: progressStepIds }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
  }
  return { operationIds, payrollReviewOperationIds, progressStepIds };
}
