import Decimal from 'decimal.js';
import {
  DesignFileType,
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
  promisedDate: Date | null;
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

export type ReporterOperationDetail = ReporterOperationListItem & {
  packageRequirement: string | null;
  orderRemark: string | null;
  sources: Array<{
    sourceQty: string;
    item: null | {
      id: string;
      sequence: number;
      name: string;
      specification: string | null;
      paperType: string | null;
      quantity: number;
      frontFoilColors: string[];
      backFoilColors: string[];
      remark: string | null;
      designs: Array<{
        id: string;
        fileName: string;
        fileUrl: string;
      }>;
    };
    packagingGroup: null | {
      id: string;
      sequence: number;
      name: string | null;
      actualBagCount: number;
    };
  }>;
};

export async function getReporterOperationType(actor: {
  id: string;
  role: Role;
}) {
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
  return operationType;
}

function passCountForSources(
  operationType: PieceworkOperationType,
  sources: Array<{
    orderItem: null | {
      frontFoilColors: string[];
      backFoilColors: string[];
    };
  }>,
): number {
  if (operationType !== PieceworkOperationType.PARTIAL) return 1;
  const passCounts = new Set(
    sources
      .map((source) =>
        source.orderItem
          ? source.orderItem.frontFoilColors.length +
            source.orderItem.backFoilColors.length
          : 0,
      )
      .filter((count) => count > 0),
  );
  return passCounts.size === 1 ? [...passCounts][0]! : 1;
}

/**
 * Replacement portal feed. Visibility is the account's fixed operation lane,
 * not a ProductionTask.workerId assignment, candidate score, or machine load.
 */
export async function listProductionOperationsForReporter(
  actor: { id: string; role: Role },
): Promise<ReporterOperationListItem[]> {
  const operationType = await getReporterOperationType(actor);

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
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
        },
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
    const passCount = passCountForSources(
      operation.operationType,
      operation.sources,
    );
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
      promisedDate: operation.order.promisedDate,
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

/**
 * Detail visibility follows the same fixed operation lane as the queue. There
 * is deliberately no worker id, assignment, candidate or machine-load filter.
 */
export async function getProductionOperationForReporter(
  operationId: string,
  actor: { id: string; role: Role },
): Promise<ReporterOperationDetail | null> {
  const operationType = await getReporterOperationType(actor);
  const operation = await db.productionOperation.findFirst({
    where: { id: operationId, operationType },
    select: {
      id: true,
      orderId: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      order: {
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
          packageRequirement: true,
          remark: true,
        },
      },
      sources: {
        orderBy: { createdAt: 'asc' },
        select: {
          sourceQty: true,
          orderItem: {
            select: {
              id: true,
              sequence: true,
              name: true,
              specification: true,
              paperType: true,
              quantity: true,
              frontFoilColors: true,
              backFoilColors: true,
              remark: true,
              designs: {
                where: { fileType: DesignFileType.IMAGE },
                orderBy: { uploadedAt: 'asc' },
                select: { id: true, fileName: true, fileUrl: true },
              },
            },
          },
          packagingGroup: {
            select: {
              id: true,
              sequence: true,
              name: true,
              actualBagCount: true,
            },
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
  });
  if (!operation) return null;

  const passCount = passCountForSources(
    operation.operationType,
    operation.sources,
  );
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
    promisedDate: operation.order.promisedDate,
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
    packageRequirement: operation.order.packageRequirement,
    orderRemark: operation.order.remark,
    sources: operation.sources.map((source) => ({
      sourceQty: source.sourceQty.toString(),
      item: source.orderItem,
      packagingGroup: source.packagingGroup,
    })),
  };
}
