import Decimal from 'decimal.js';
import { buildQrSvg } from './qr';
import type { Prisma } from '../../generated/prisma/client';
import { db } from '../db';
import {
  PieceworkOperationType,
  OrderChangeRequestStatus,
  ProductionOperationStatus,
  Role,
} from '../../generated/prisma/enums';
import { ORDER_EXTERNAL_SALES_SELECT, orderExternalSalesName } from './external-sales-name';
import { getOrderPrintScope } from './print-access';
import { productionOperationPassCount } from '../production/operation-quantity';
import { signDesignReadUrl } from '../oss/read-url';
import type {
  PrintDesign,
  PrintOrder,
  PrintOrderItem,
  PrintPackagingGroup,
  PrintProductionStep,
  PrintShipment,
} from './print-types';

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包',
};

type PrintOperationRow = {
  unit?: import('@/generated/prisma/enums').PieceworkRateUnit;
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
    packagingGroup?: null | {
      sequence: number;
      name: string | null;
      lines: Array<{ orderItem: { sequence: number } }>;
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

function buildCurrentProductionSteps(input: {
  workOrderVersion: number;
  operations: PrintOperationRow[];
  progressSteps: PrintProgressStepRow[];
}): PrintProductionStep[] {
  const currentOperations = input.operations.filter(
    (operation) => operation.workOrderVersion === input.workOrderVersion &&
      operation.status !== ProductionOperationStatus.CANCELLED,
  );
  const currentProgressSteps = input.progressSteps.filter(
    (step) => step.workOrderVersion === input.workOrderVersion &&
      step.status !== ProductionOperationStatus.CANCELLED,
  );
  return [
    ...currentOperations.map((operation): PrintProductionStep => {
      const singleItem =
        operation.sources.length === 1
          ? operation.sources[0]?.orderItem ?? null
          : null;
      const passCount = productionOperationPassCount(
        operation.operationType,
        operation.sources,
      );
      const completedQty = operation.reports.reduce(
        (total, report) => total.plus(report.reportedCompletedQty.toString()),
        new Decimal(operation.carriedCompletedQty?.toString() ?? 0),
      );
      const defectQty = operation.reports.reduce(
        (total, report) => total.plus(report.defectQty.toString()),
        new Decimal(0),
      );
      const latestReport = operation.reports.at(-1);
      const scopes = operation.sources.flatMap((source) => {
        if (source.packagingGroup) {
          const group = source.packagingGroup;
          const items = [...new Set(group.lines.map((line) => line.orderItem.sequence))];
          return [
            `包装组 ${group.sequence}${group.name ? ` · ${group.name}` : ''}${items.length ? ` · 图 ${items.join('、')}` : ''}`,
          ];
        }
        return [];
      });
      if (!singleItem) {
        // One operation can cover all 50 styles. Repeating every full name in
        // a single table row can exceed A4; figure references keep the scope
        // complete while names remain on the item sheet and scan detail.
        const itemSequences = [...new Set(operation.sources.flatMap((source) =>
          !source.packagingGroup && source.orderItem
            ? [source.orderItem.sequence]
            : [],
        ))].sort((left, right) => left - right);
        if (itemSequences.length > 0) scopes.push(`图 ${itemSequences.join('、')}`);
      }
      return {
        id: operation.id,
        source: 'OPERATION',
        itemSequence: singleItem?.sequence ?? null,
        itemName: singleItem?.name ?? null,
        scopeLabel: [...new Set(scopes)].join('；') || null,
        quantityUnit: operation.unit === 'PER_BOX' ? '盒' : operation.operationType === PieceworkOperationType.PACKING ? '袋' : '个',
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
      };
    }),
    ...currentProgressSteps.map(
      (step): PrintProductionStep => {
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
          quantityUnit: '个',
          craftName: step.craftName,
          plannedQty: new Decimal(step.plannedQty.toString()).toNumber(),
          completedQty: completedQty.toNumber(),
          defectQty: defectQty.toNumber(),
          completedAt:
            step.status === ProductionOperationStatus.COMPLETED
              ? latestReport?.reportedAt ?? null
              : null,
        };
      },
    ),
  ];
}

// Loads the narrow shape the production print layout needs. SALES uses the
// customer-facing list drawer and must not receive a production sheet (it
// contains internal production details). ADMIN sees everything, and WORKER sees only
// current-version orders in its reporting lane or with public progress.
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
  // 打印记录在持有工单锁的事务里重新读取打印内容，须传同一事务客户端，不另占连接。
  client: Pick<Prisma.TransactionClient, 'user' | 'order' | 'craft'> = db,
): Promise<PrintOrder | null> {
  const where = await getOrderPrintScope(id, user, client);
  if (!where) return null;

  const order = await client.order.findFirst({
    where,
    include: {
      submitter: ORDER_EXTERNAL_SALES_SELECT.submitter,
      sourceOrder: { select: { orderNo: true, ...ORDER_EXTERNAL_SALES_SELECT.sourceOrder.select } },
      changeRequests: {
        where: { status: OrderChangeRequestStatus.PENDING },
        take: 1,
        select: { id: true },
      },
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
      productionJobs: { orderBy: { createdAt: 'asc' }, select: { id: true, workOrderVersion: true, operationId: true, progressStepId: true, label: true, workerName: true, plannedQty: true, completedQty: true, completedAt: true, status: true } },
      productionOperations: {
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          workOrderVersion: true,
          operationType: true,
          unit: true,
          status: true,
          plannedQty: true,
          carriedCompletedQty: true,
          sources: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              packagingGroup: {
                select: {
                  sequence: true,
                  name: true,
                  lines: {
                    orderBy: { orderItem: { sequence: 'asc' } },
                    select: { orderItem: { select: { sequence: true } } },
                  },
                },
              },
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
    const rows = await client.craft.findMany({
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

  const productionSteps: PrintProductionStep[] = order.simpleProduction ? order.productionJobs.filter(job => job.workOrderVersion === order.workOrderVersion && job.status !== 'CANCELLED').map(job => ({ id: job.id, source: job.operationId ? 'OPERATION' : 'PROGRESS', craftName: job.label, scopeLabel: `生产师傅：${job.workerName}${job.status === 'CARRIED' ? ' · 沿用已产，无新增生产' : ''}`, plannedQty: Number(job.plannedQty), completedQty: Number(job.completedQty ?? 0), defectQty: 0, completedAt: job.completedAt, quantityUnit: '个' })) : buildCurrentProductionSteps({
    workOrderVersion: order.workOrderVersion,
    operations: order.productionOperations,
    progressSteps: order.productionProgressSteps,
  });

  const printItems: PrintOrderItem[] = order.items.map((item) => ({
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
          d.fileType === 'IMAGE'
            ? signDesignReadUrl(d.fileUrl.startsWith('/') && !d.fileUrl.startsWith('//')
              ? new URL(d.fileUrl, `${base}/`).href : d.fileUrl)
            : d.fileUrl,
      }),
    ),
  }));

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
    status: order.status,
    simpleProduction: order.simpleProduction,
    hasPendingChange: order.changeRequests.length > 0,
    customName: order.customName,
    kind: order.kind,
    sourceOrderNo: order.sourceOrder?.orderNo ?? null,
    isUrgent: order.isUrgent,
    isSfCollect: order.isSfCollect,
    promisedDate: order.promisedDate,
    externalSalesName: orderExternalSalesName(order),
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
