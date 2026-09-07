import Decimal from 'decimal.js';
import { buildQrSvg } from './qr';
import { db } from '../db';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/enums';
import { getOrderScopeFilter } from '../auth/order-scope';
import { signDesignReadUrl } from '../oss/read-url';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
  PrintPackagingGroup,
  PrintProductionStep,
  PrintShipment,
  PrintTask,
} from './print-types';

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包',
};

function partialPassCount(
  sources: Array<{
    orderItem: null | {
      frontFoilColors: string[];
      backFoilColors: string[];
    };
  }>,
): number {
  const counts = new Set(
    sources
      .map((source) =>
        source.orderItem
          ? source.orderItem.frontFoilColors.length +
            source.orderItem.backFoilColors.length
          : 0,
      )
      .filter((count) => count > 0),
  );
  return counts.size === 1 ? [...counts][0]! : 1;
}

type PrintOperationRow = {
  id: string;
  workOrderVersion: number;
  operationType: PieceworkOperationType;
  status: ProductionOperationStatus;
  plannedQty: { toString(): string };
  carriedCompletedQty?: { toString(): string };
  sources: Array<{
    orderItem: null | {
      sequence: number;
      name: string;
      frontFoilColors: string[];
      backFoilColors: string[];
    };
  }>;
  reports: Array<{
    reportedCompletedQty: { toString(): string };
    defectQty: { toString(): string };
    reportedAt: Date;
  }>;
};

type PrintProgressStepRow = {
  id: string;
  workOrderVersion: number;
  craftName: string;
  status: ProductionOperationStatus;
  plannedQty: { toString(): string };
  carriedCompletedQty?: { toString(): string };
  orderItem: { sequence: number; name: string };
  reports: Array<{
    completedQty: { toString(): string };
    defectQty: { toString(): string };
    reportedAt: Date;
  }>;
};

function productionTaskQrUrl(
  base: string,
  orderNo: string,
  workOrderVersion: number,
  taskId: string,
): string {
  return `${base}/wo/${encodeURIComponent(orderNo)}?v=${workOrderVersion}&task=${encodeURIComponent(taskId)}`;
}

async function buildCurrentProductionSteps(input: {
  base: string;
  orderNo: string;
  workOrderVersion: number;
  operations: PrintOperationRow[];
  progressSteps: PrintProgressStepRow[];
}): Promise<PrintProductionStep[]> {
  const currentOperations = input.operations.filter(
    (operation) => operation.workOrderVersion === input.workOrderVersion,
  );
  const currentProgressSteps = input.progressSteps.filter(
    (step) => step.workOrderVersion === input.workOrderVersion,
  );
  return Promise.all([
    ...currentOperations.map(async (operation): Promise<PrintProductionStep> => {
      const singleItem =
        operation.sources.length === 1
          ? operation.sources[0]?.orderItem ?? null
          : null;
      const passCount =
        operation.operationType === PieceworkOperationType.PARTIAL
          ? partialPassCount(operation.sources)
          : 1;
      const completedQty = operation.reports.reduce(
        (total, report) => total.plus(report.reportedCompletedQty.toString()),
        new Decimal(operation.carriedCompletedQty?.toString() ?? 0),
      );
      const defectQty = operation.reports.reduce(
        (total, report) => total.plus(report.defectQty.toString()),
        new Decimal(0),
      );
      const latestReport = operation.reports.at(-1);
      return {
        id: operation.id,
        source: 'OPERATION',
        itemSequence: singleItem?.sequence ?? null,
        itemName: singleItem?.name ?? null,
        craftName: OPERATION_LABELS[operation.operationType],
        plannedQty: new Decimal(operation.plannedQty.toString())
          .div(passCount)
          .toNumber(),
        completedQty: completedQty.toNumber(),
        defectQty: defectQty.toNumber(),
        completedAt:
          operation.status === ProductionOperationStatus.COMPLETED
            ? latestReport?.reportedAt ?? null
            : null,
        taskQrSvg: await buildQrSvg(
          productionTaskQrUrl(
            input.base,
            input.orderNo,
            input.workOrderVersion,
            operation.id,
          ),
          55,
          { errorCorrectionLevel: 'Q' },
        ),
      };
    }),
    ...currentProgressSteps.map(
      async (step): Promise<PrintProductionStep> => {
        const completedQty = step.reports.reduce(
          (total, report) => total.plus(report.completedQty.toString()),
          new Decimal(step.carriedCompletedQty?.toString() ?? 0),
        );
        const defectQty = step.reports.reduce(
          (total, report) => total.plus(report.defectQty.toString()),
          new Decimal(0),
        );
        const latestReport = step.reports.at(-1);
        return {
          id: step.id,
          source: 'PROGRESS',
          itemSequence: step.orderItem.sequence,
          itemName: step.orderItem.name,
          craftName: step.craftName,
          plannedQty: new Decimal(step.plannedQty.toString()).toNumber(),
          completedQty: completedQty.toNumber(),
          defectQty: defectQty.toNumber(),
          completedAt:
            step.status === ProductionOperationStatus.COMPLETED
              ? latestReport?.reportedAt ?? null
              : null,
          taskQrSvg: await buildQrSvg(
            productionTaskQrUrl(
              input.base,
              input.orderNo,
              input.workOrderVersion,
              step.id,
            ),
            55,
            { errorCorrectionLevel: 'Q' },
          ),
        };
      },
    ),
  ]);
}

// Loads the narrow shape the production print layout needs. SALES uses the
// customer-facing list drawer and must not receive a production sheet (it
// contains task, worker and internal process details). CUSTOMER_SERVICE can
// print its own submissions, ADMIN sees everything, and WORKER sees only
// assigned orders that have left the SUBMITTED scheduling-draft state.
// Returns null when the actor can't see the order — the page
// maps that to notFound() so there's no "this order exists but you
// can't print it" disclosure.
export async function getOrderForPrint(
  id: string,
  user: { id: string; role: Role },
  // 二维码内容的绝对 URL base（调用方用 derivePublicBaseUrl 推导）。
  // 码里存 URL 而不是裸 id：师傅用微信"扫一扫"直接打开报工页
  // （未登录先登录再回跳），不需要专用扫码器。
  baseUrl: string,
): Promise<PrintOrder | null> {
  if (user.role === Role.SALES) return null;

  const order = await db.order.findFirst({
    where: {
      id,
      ...getOrderScopeFilter(user),
    },
    include: {
      customerParty: { select: { name: true } },
      sourceOrder: { select: { orderNo: true } },
      packagingGroups: {
        orderBy: { sequence: 'asc' },
        include: {
          lines: {
            orderBy: { orderItem: { sequence: 'asc' } },
            include: {
              orderItem: { select: { sequence: true } },
            },
          },
        },
      },
      shipments: {
        orderBy: { sequence: 'asc' },
        include: {
          lines: {
            orderBy: { orderItem: { sequence: 'asc' } },
            include: {
              orderItem: { select: { sequence: true, name: true } },
            },
          },
        },
      },
      productionOperations: {
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          workOrderVersion: true,
          operationType: true,
          status: true,
          plannedQty: true,
          carriedCompletedQty: true,
          sources: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              orderItem: {
                select: {
                  sequence: true,
                  name: true,
                  frontFoilColors: true,
                  backFoilColors: true,
                },
              },
            },
          },
          reports: {
            orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
            select: {
              reportedCompletedQty: true,
              defectQty: true,
              reportedAt: true,
            },
          },
        },
      },
      productionProgressSteps: {
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          workOrderVersion: true,
          craftName: true,
          status: true,
          plannedQty: true,
          carriedCompletedQty: true,
          orderItem: { select: { sequence: true, name: true } },
          reports: {
            orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
            select: {
              completedQty: true,
              defectQty: true,
              reportedAt: true,
            },
          },
        },
      },
      items: {
        orderBy: { sequence: 'asc' },
        include: {
          designs: {
            orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
          },
          tasks: {
            where: { status: { not: TaskStatus.CANCELLED } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: {
              craft: { select: { name: true } },
              worker: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  // OrderItem.crafts is an array of Craft IDs (schema uses a String[]
  // rather than a join table). Collect the distinct IDs across the whole
  // order and resolve them in a single query instead of one-per-item.
  const craftIds = new Set<string>();
  for (const item of order.items) {
    for (const cid of item.crafts) craftIds.add(cid);
  }
  const craftNameById = new Map<string, string>();
  if (craftIds.size > 0) {
    const rows = await db.craft.findMany({
      where: { id: { in: [...craftIds] } },
      select: { id: true, name: true },
    });
    for (const row of rows) craftNameById.set(row.id, row.name);
  }

  const base = baseUrl.replace(/\/+$/, '');
  const orderQrSvg = await buildQrSvg(
    `${base}/wo/${encodeURIComponent(order.orderNo)}?v=${order.workOrderVersion}`,
    95,
    { errorCorrectionLevel: 'Q' },
  );

  const productionSteps = await buildCurrentProductionSteps({
    base,
    orderNo: order.orderNo,
    workOrderVersion: order.workOrderVersion,
    operations: order.productionOperations,
    progressSteps: order.productionProgressSteps,
  });

  const printItems: PrintOrderItem[] = await Promise.all(
    order.items.map(async (item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      pricingRoute: item.pricingRoute,
      artworkVersion: item.artworkVersion,
      specification: item.specification,
      paperType: item.paperType,
      paperWeightGsm: item.paperWeightGsm,
      quantity: item.quantity,
      frontFoilColors: item.frontFoilColors,
      backFoilColors: item.backFoilColors,
      foilColors: item.foilColors,
      foilTechnique: item.foilTechnique,
      hasLocalFoil: item.hasLocalFoil,
      lamination: item.lamination,
      printColors: item.printColors,
      printColorsKnown: item.printColorsKnown,
      isDoubleSided: item.isDoubleSided,
      isDoubleColor: item.isDoubleColor,
      // Drop unresolvable IDs silently rather than rendering a raw cuid
      // into the printed sheet — if a craft was deleted, the workshop
      // shouldn't see garbage on paper.
      craftNames: item.crafts
        .map((cid) => craftNameById.get(cid))
        .filter((n): n is string => typeof n === 'string'),
      remark: item.remark,
      designs: item.designs.map(
        (d): PrintDesign => ({
          id: d.id,
          fileType: d.fileType,
          // bucket 私有：IMAGE 渲染前换成 30min 预签 GET（浏览器打印和
          // Puppeteer PDF 都在窗口内完成）。CDR 不签——打印视图按 SPEC
          // §E.2.1 过滤掉 CDR，不该在 HTML 里留可用下载 URL。
          fileUrl:
            d.fileType === 'IMAGE' ? signDesignReadUrl(d.fileUrl) : d.fileUrl,
        }),
      ),
      tasks:
        productionSteps.length > 0
          ? []
          : await Promise.all(
              item.tasks.map(
                async (t): Promise<PrintTask> => ({
                  id: t.id,
                  craftName: t.craft.name,
                  workerDisplayName: t.worker?.displayName ?? null,
                  plannedQty: t.plannedQty,
                  completedQty: t.completedQty,
                  defectQty: t.defectQty,
                  completedAt: t.completedAt,
                  taskQrSvg: await buildQrSvg(
                    `${base}/worker/tasks/${encodeURIComponent(t.id)}`,
                    55,
                    { errorCorrectionLevel: 'Q' },
                  ),
                }),
              ),
            ),
    })),
  );
  const printPackagingGroups: PrintPackagingGroup[] =
    order.packagingGroups.map((group) => ({
      id: group.id,
      sequence: group.sequence,
      name: group.name,
      mode: group.mode,
      actualBagCount: group.actualBagCount,
      lines: group.lines.map((line) => ({
        orderItemId: line.orderItemId,
        orderItemSequence: line.orderItem.sequence,
        unitsPerBag: line.unitsPerBag,
      })),
    }));
  const printShipments: PrintShipment[] = order.shipments.map((shipment) => ({
    id: shipment.id,
    sequence: shipment.sequence,
    receiverName: shipment.receiverName,
    receiverPhone: shipment.receiverPhone,
    receiverAddress: shipment.receiverAddress,
    expressCode: shipment.expressCode,
    carrierCode: shipment.carrierCode,
    trackingNo: shipment.trackingNo,
    lines: shipment.lines.map((line) => ({
      orderItemSequence: line.orderItem.sequence,
      orderItemName: line.orderItem.name,
      quantity: line.quantity,
    })),
  }));

  return {
    id: order.id,
    orderNo: order.orderNo,
    workOrderVersion: order.workOrderVersion,
    customName: order.customName,
    kind: order.kind,
    sourceOrderNo: order.sourceOrder?.orderNo ?? null,
    isUrgent: order.isUrgent,
    isSfCollect: order.isSfCollect,
    promisedDate: order.promisedDate,
    customerName:
      order.customerParty?.name?.trim() || order.customerRef?.trim() || null,
    customerRef: order.customerRef,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    receiverAddress: order.receiverAddress,
    expressCode: order.expressCode,
    packageRequirement: order.packageRequirement,
    remark: order.remark,
    submittedAt: order.submittedAt,
    createdAt: order.createdAt,
    items: printItems,
    productionSteps,
    packagingGroups: printPackagingGroups,
    shipments: printShipments,
    orderQrSvg,
  };
}
