import type { Prisma } from '../../generated/prisma/client';
import { ProductionOperationStatus } from '../../generated/prisma/enums';
import { reportUsesTieredFoilWage } from '../salary/tiered-foil-report';

const UNFINISHED = [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS];

export type PreviousProductionGenerationSupersede = {
  operationIds: string[];
  payrollReviewOperationIds: string[];
  progressStepIds: string[];
};

/**
 * 只读：列出 workOrderVersion 低于当前版本、仍为待开工/进行中的旧代次工序与无计件进度步骤，
 * 以及其中带分档烫金报工、须转人工核定的工序。升版事务与历史清理脚本的 dry-run 共用这一口径。
 */
export async function planPreviousProductionGenerationSupersedeInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  currentWorkOrderVersion: number,
): Promise<PreviousProductionGenerationSupersede> {
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
  const progressSteps = await tx.productionProgressStep.findMany({ where: superseded, select: { id: true } });
  return {
    operationIds: operations.map((operation) => operation.id),
    payrollReviewOperationIds: operations
      .filter((operation) => operation.reports.some((report) => reportUsesTieredFoilWage(operation.operationType, report)))
      .map((operation) => operation.id),
    progressStepIds: progressSteps.map((step) => step.id),
  };
}

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
): Promise<PreviousProductionGenerationSupersede> {
  const plan = await planPreviousProductionGenerationSupersedeInTx(tx, orderId, currentWorkOrderVersion);
  if (plan.payrollReviewOperationIds.length > 0) {
    await tx.productionOperation.updateMany({ where: { id: { in: plan.payrollReviewOperationIds } }, data: { payrollReviewRequired: true } });
  }
  if (plan.operationIds.length > 0) {
    await tx.productionOperation.updateMany({
      where: { id: { in: plan.operationIds }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
  }
  if (plan.progressStepIds.length > 0) {
    await tx.productionProgressStep.updateMany({
      where: { id: { in: plan.progressStepIds }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
  }
  return plan;
}
