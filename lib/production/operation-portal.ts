import Decimal from 'decimal.js';
import {
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  OperationReportingError,
  operationTypeForReporterAccount,
} from './operation-reporting';

export type ReporterOperationListItem = {
  id: string;
  orderId: string;
  orderNo: string;
  customName: string | null;
  isUrgent: boolean;
  operationType: PieceworkOperationType;
  unit: string;
  status: ProductionOperationStatus;
  plannedCompletedQty: string;
  completedQty: string;
  defectQty: string;
  reworkQty: string;
  passCount: number;
  sourceCount: number;
};

/**
 * Replacement portal feed. Visibility is the account's fixed operation lane,
 * not a ProductionTask.workerId assignment, candidate score, or machine load.
 */
export async function listProductionOperationsForReporter(
  actor: { id: string; role: Role },
): Promise<ReporterOperationListItem[]> {
  const account = await db.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      role: true,
      isActive: true,
      workerType: true,
      machineType: true,
    },
  });
  if (!account || account.role !== actor.role) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '报工账号无效或已变更岗位',
    );
  }
  const operationType = operationTypeForReporterAccount(account);
  if (!operationType) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '当前账号没有可报工的固定工序岗位',
    );
  }

  const operations = await db.productionOperation.findMany({
    where: {
      operationType,
      status: {
        in: [
          ProductionOperationStatus.PENDING,
          ProductionOperationStatus.IN_PROGRESS,
        ],
      },
      order: {
        status: { in: [OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION] },
      },
    },
    select: {
      id: true,
      orderId: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      createdAt: true,
      order: {
        select: { orderNo: true, customName: true, isUrgent: true },
      },
      sources: {
        select: {
          orderItem: {
            select: { frontFoilColors: true, backFoilColors: true },
          },
        },
      },
      reports: {
        select: {
          reportedCompletedQty: true,
          defectQty: true,
          reworkQty: true,
        },
      },
    },
    orderBy: [
      { order: { isUrgent: 'desc' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  return operations.map((operation) => {
    const passCounts = new Set(
      operation.sources
        .map((source) =>
          source.orderItem
            ? source.orderItem.frontFoilColors.length +
              source.orderItem.backFoilColors.length
            : 0,
        )
        .filter((count) => count > 0),
    );
    const passCount =
      operation.operationType === PieceworkOperationType.PARTIAL &&
      passCounts.size === 1
        ? [...passCounts][0]!
        : 1;
    const completedQty = operation.reports.reduce(
      (total, report) => total.plus(report.reportedCompletedQty),
      new Decimal(0),
    );
    const defectQty = operation.reports.reduce(
      (total, report) => total.plus(report.defectQty),
      new Decimal(0),
    );
    const reworkQty = operation.reports.reduce(
      (total, report) => total.plus(report.reworkQty),
      new Decimal(0),
    );
    return {
      id: operation.id,
      orderId: operation.orderId,
      orderNo: operation.order.orderNo,
      customName: operation.order.customName,
      isUrgent: operation.order.isUrgent,
      operationType: operation.operationType,
      unit: operation.unit,
      status: operation.status,
      plannedCompletedQty: new Decimal(operation.plannedQty.toString())
        .div(passCount)
        .toString(),
      completedQty: completedQty.toString(),
      defectQty: defectQty.toString(),
      reworkQty: reworkQty.toString(),
      passCount,
      sourceCount: operation.sources.length,
    };
  });
}
