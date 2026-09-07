import Decimal from 'decimal.js';
import {
  DesignFileType,
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  ProductionWorkOrderStage,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  OperationReportingError,
} from './operation-reporting';
import { operationTypeForReporterAccount } from './reporter-operation-lane';

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
  workOrderStage: ProductionWorkOrderStage;
  workOrderTotalQty: string;
  workOrderProgressQty: string;
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

export type ReporterProgressListItem = {
  id: string;
  orderId: string;
  orderNo: string;
  customName: string | null;
  isUrgent: boolean;
  promisedDate: Date | null;
  craftCode: string;
  craftName: string;
  status: ProductionOperationStatus;
  plannedQty: string;
  completedQty: string;
  defectQty: string;
  reworkQty: string;
  orderItemSequence: number;
  orderItemName: string;
};

export type ReporterProgressDetail = ReporterProgressListItem & {
  packageRequirement: string | null;
  orderRemark: string | null;
  item: {
    id: string;
    sequence: number;
    name: string;
    specification: string | null;
    paperType: string | null;
    quantity: number;
    remark: string | null;
    designs: Array<{
      id: string;
      fileName: string;
      fileUrl: string;
    }>;
  };
};

async function assertActiveProgressReporter(actor: {
  id: string;
  role: Role;
}): Promise<void> {
  const account = await db.user.findUnique({
    where: { id: actor.id },
    select: { id: true, role: true, isActive: true },
  });
  if (
    !account ||
    actor.role !== Role.WORKER ||
    account.role !== actor.role ||
    !account.isActive
  ) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '报工账号无效或已停用',
    );
  }
}

function progressTotals(
  reports: Array<{
    completedQty: { toString(): string };
    defectQty: { toString(): string };
    reworkQty: { toString(): string };
  }>,
  carriedCompletedQty?: { toString(): string },
) {
  return {
    completedQty: reports
      .reduce(
        (total, report) => total.plus(report.completedQty.toString()),
        new Decimal(carriedCompletedQty?.toString() ?? 0),
      )
      .toString(),
    defectQty: reports
      .reduce(
        (total, report) => total.plus(report.defectQty.toString()),
        new Decimal(0),
      )
      .toString(),
    reworkQty: reports
      .reduce(
        (total, report) => total.plus(report.reworkQty.toString()),
        new Decimal(0),
      )
      .toString(),
  };
}

export async function getReporterOperationTypeOrNull(actor: {
  id: string;
  role: Role;
}): Promise<PieceworkOperationType | null> {
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
  if (!account || account.role !== actor.role || !account.isActive) {
    throw new OperationReportingError(
      'ACCOUNT_NOT_AUTHORIZED',
      '报工账号无效或已变更岗位',
    );
  }
  const operationType = operationTypeForReporterAccount(account);
  return operationType;
}

export async function getReporterOperationType(actor: {
  id: string;
  role: Role;
}) {
  const operationType = await getReporterOperationTypeOrNull(actor);
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

function workOrderProgressForOperation(
  operationType: PieceworkOperationType,
  order: {
    workOrderVersion?: number;
    items?: Array<{ quantity: number }>;
    productionOperations?: Array<{ workOrderVersion: number; operationType: PieceworkOperationType; carriedWorkOrderProgressQty: { toString(): string } }>;
    productionWorkOrderProgress?: Array<{
      workOrderVersion: number;
      stage: ProductionWorkOrderStage;
      workOrderProgressQuantity: { toString(): string };
    }>;
  },
) {
  const stage =
    operationType === PieceworkOperationType.PACKING
      ? ProductionWorkOrderStage.PACKING
      : ProductionWorkOrderStage.FOILING;
  const orderTotal = (order.items ?? []).reduce(
    (total, item) => total.plus(item.quantity),
    new Decimal(0),
  );
  const completed = (order.productionWorkOrderProgress ?? [])
    .filter(
      (row) =>
        row.stage === stage &&
        row.workOrderVersion === order.workOrderVersion,
    )
    .reduce(
      (total, row) => total.plus(row.workOrderProgressQuantity.toString()),
      new Decimal(0),
    );
  const carried = (order.productionOperations ?? []).filter((row) => row.workOrderVersion === order.workOrderVersion && (row.operationType === PieceworkOperationType.PACKING) === (stage === ProductionWorkOrderStage.PACKING)).reduce((sum, row) => sum.plus(row.carriedWorkOrderProgressQty.toString()), new Decimal(0));
  return { stage, orderTotal, completed: completed.plus(carried) };
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
        status: {
          in: [
            OrderStatus.RELEASED,
            OrderStatus.FOILING,
            OrderStatus.PACKING,
            OrderStatus.SCHEDULING,
            OrderStatus.IN_PRODUCTION,
          ],
        },
      },
    },
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      createdAt: true,
      order: {
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
          workOrderVersion: true,
          items: { select: { quantity: true } },
          productionOperations: { where: { carriedWorkOrderProgressQty: { gt: 0 } }, select: { workOrderVersion: true, operationType: true, carriedWorkOrderProgressQty: true } },
          productionWorkOrderProgress: {
            select: {
              workOrderVersion: true,
              stage: true,
              workOrderProgressQuantity: true,
            },
          },
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

  return operations
    .filter(
      (operation) =>
        operation.workOrderVersion === operation.order.workOrderVersion,
    )
    .map((operation) => {
    const passCount = passCountForSources(
      operation.operationType,
      operation.sources,
    );
    const completedQty = operation.reports.reduce(
      (total, report) => total.plus(report.reportedCompletedQty),
      new Decimal(operation.carriedCompletedQty?.toString() ?? 0),
    );
    const defectQty = operation.reports.reduce(
      (total, report) => total.plus(report.defectQty),
      new Decimal(0),
    );
    const reworkQty = operation.reports.reduce(
      (total, report) => total.plus(report.reworkQty),
      new Decimal(0),
    );
    const workOrderProgress = workOrderProgressForOperation(
      operation.operationType,
      operation.order,
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
      workOrderStage: workOrderProgress.stage,
      workOrderTotalQty: workOrderProgress.orderTotal.toString(),
      workOrderProgressQty: workOrderProgress.completed.toString(),
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
      workOrderVersion: true,
      operationType: true,
      unit: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      order: {
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
          workOrderVersion: true,
          packageRequirement: true,
          remark: true,
          items: { select: { quantity: true } },
          productionOperations: { where: { carriedWorkOrderProgressQty: { gt: 0 } }, select: { workOrderVersion: true, operationType: true, carriedWorkOrderProgressQty: true } },
          productionWorkOrderProgress: {
            select: {
              workOrderVersion: true,
              stage: true,
              workOrderProgressQuantity: true,
            },
          },
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
  if (
    !operation ||
    operation.workOrderVersion !== operation.order.workOrderVersion
  ) {
    return null;
  }

  const passCount = passCountForSources(
    operation.operationType,
    operation.sources,
  );
  const completedQty = operation.reports.reduce(
    (total, report) => total.plus(report.reportedCompletedQty),
    new Decimal(operation.carriedCompletedQty?.toString() ?? 0),
  );
  const defectQty = operation.reports.reduce(
    (total, report) => total.plus(report.defectQty),
    new Decimal(0),
  );
  const reworkQty = operation.reports.reduce(
    (total, report) => total.plus(report.reworkQty),
    new Decimal(0),
  );
  const workOrderProgress = workOrderProgressForOperation(
    operation.operationType,
    operation.order,
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
    workOrderStage: workOrderProgress.stage,
    workOrderTotalQty: workOrderProgress.orderTotal.toString(),
    workOrderProgressQty: workOrderProgress.completed.toString(),
    packageRequirement: operation.order.packageRequirement,
    orderRemark: operation.order.remark,
    sources: operation.sources.map((source) => ({
      sourceQty: source.sourceQty.toString(),
      item: source.orderItem,
      packagingGroup: source.packagingGroup,
    })),
  };
}

/** All active workers see active no-pay progress; there is no assignment. */
export async function listProductionProgressForReporter(
  actor: { id: string; role: Role },
): Promise<ReporterProgressListItem[]> {
  await assertActiveProgressReporter(actor);
  const steps = await db.productionProgressStep.findMany({
    where: {
      status: {
        in: [
          ProductionOperationStatus.PENDING,
          ProductionOperationStatus.IN_PROGRESS,
        ],
      },
      order: {
        status: {
          in: [
            OrderStatus.RELEASED,
            OrderStatus.FOILING,
            OrderStatus.PACKING,
            OrderStatus.SCHEDULING,
            OrderStatus.IN_PRODUCTION,
          ],
        },
      },
    },
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      createdAt: true,
      order: {
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
          workOrderVersion: true,
        },
      },
      orderItem: { select: { sequence: true, name: true } },
      reports: {
        select: { completedQty: true, defectQty: true, reworkQty: true },
      },
    },
    orderBy: [
      { order: { isUrgent: 'desc' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  return steps
    .filter((step) => step.workOrderVersion === step.order.workOrderVersion)
    .map((step) => ({
    id: step.id,
    orderId: step.orderId,
    orderNo: step.order.orderNo,
    customName: step.order.customName,
    isUrgent: step.order.isUrgent,
    promisedDate: step.order.promisedDate,
    craftCode: step.craftCode,
    craftName: step.craftName,
    status: step.status,
    plannedQty: step.plannedQty.toString(),
    ...progressTotals(step.reports, step.carriedCompletedQty),
    orderItemSequence: step.orderItem.sequence,
    orderItemName: step.orderItem.name,
  }));
}

/** Detail has no worker, capability or machine predicate by design. */
export async function getProductionProgressForReporter(
  progressStepId: string,
  actor: { id: string; role: Role },
): Promise<ReporterProgressDetail | null> {
  await assertActiveProgressReporter(actor);
  const step = await db.productionProgressStep.findFirst({
    where: { id: progressStepId },
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      craftCode: true,
      craftName: true,
      status: true,
      plannedQty: true,
      carriedCompletedQty: true,
      order: {
        select: {
          orderNo: true,
          customName: true,
          isUrgent: true,
          promisedDate: true,
          workOrderVersion: true,
          packageRequirement: true,
          remark: true,
        },
      },
      orderItem: {
        select: {
          id: true,
          sequence: true,
          name: true,
          specification: true,
          paperType: true,
          quantity: true,
          remark: true,
          designs: {
            where: { fileType: DesignFileType.IMAGE },
            orderBy: { uploadedAt: 'asc' },
            select: { id: true, fileName: true, fileUrl: true },
          },
        },
      },
      reports: {
        select: { completedQty: true, defectQty: true, reworkQty: true },
      },
    },
  });
  if (!step || step.workOrderVersion !== step.order.workOrderVersion) {
    return null;
  }

  return {
    id: step.id,
    orderId: step.orderId,
    orderNo: step.order.orderNo,
    customName: step.order.customName,
    isUrgent: step.order.isUrgent,
    promisedDate: step.order.promisedDate,
    craftCode: step.craftCode,
    craftName: step.craftName,
    status: step.status,
    plannedQty: step.plannedQty.toString(),
    ...progressTotals(step.reports, step.carriedCompletedQty),
    orderItemSequence: step.orderItem.sequence,
    orderItemName: step.orderItem.name,
    packageRequirement: step.order.packageRequirement,
    orderRemark: step.order.remark,
    item: step.orderItem,
  };
}
