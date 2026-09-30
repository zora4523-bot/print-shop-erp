import Decimal from 'decimal.js';
import { Prisma } from '../../generated/prisma/client';
import { OrderPurpose, OrderStatus, ProductionOperationStatus, ProductionWorkOrderStage } from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';

const ACTIVE_PRODUCTION_STATUSES = [
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
] as const;

// 扫码认领只能落在当前代次待开工/进行中的工序或进度步骤上。寄样单不物化工序，改单后
// 全部承接完成的新代次也没有可认领对象，这两类工单“无人认领”不是停滞（审计 L-13）。
const CLAIMABLE_UNIT_WHERE = {
  status: { in: [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS] },
};

// 新流程（simpleProduction）打包无需扫码：完工登记后工单停在 PACKING、打包工序仍为 PENDING，
// 也不写扫码认领。与 order-state / production-completion 同口径，新流程不把 PACKING 工序
// 算作待认领对象（DECISIONS 2026-09-28）。
function hasClaimableCurrentGeneration(order: {
  purpose: OrderPurpose;
  simpleProduction: boolean;
  workOrderVersion: number;
  productionOperations: ReadonlyArray<{ workOrderVersion: number; operationType: string }>;
  productionProgressSteps: ReadonlyArray<{ workOrderVersion: number }>;
}): boolean {
  const operations = order.simpleProduction
    ? order.productionOperations.filter((unit) => unit.operationType !== 'PACKING')
    : order.productionOperations;
  return order.purpose !== OrderPurpose.SAMPLE_SHIPMENT &&
    [...operations, ...order.productionProgressSteps]
      .some((unit) => unit.workOrderVersion === order.workOrderVersion);
}

export type WorkOrderProgressProjection = {
  orderId: string;
  orderTotal: string;
  foilingProgress: string;
  packingProgress: string;
  foilingOverLimit: boolean;
  packingOverLimit: boolean;
  packingAhead: boolean;
  firstClaimedAt: Date | null;
};

/**
 * Bulk-only projection for admin lists, drawers and exports. It intentionally
 * reads just OrderItem + the two W2 append-only ledgers; old ProductionTask and
 * PACKING/PER_BAG payroll facts are outside this query.
 */
export async function getWorkOrderProgressByOrderIds(
  orderIds: readonly string[],
  client: Pick<
    Prisma.TransactionClient,
    | 'order'
    | 'orderItem'
    | 'productionWorkOrderProgress'
    | 'productionScanClaim'
  > = db,
): Promise<Map<string, WorkOrderProgressProjection>> {
  const uniqueIds = [...new Set(orderIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const [orders, orderTotals, progressTotals, claims] = await Promise.all([
    client.order.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, workOrderVersion: true, scheduledAt: true,
        productionOperations: { where: { carriedWorkOrderProgressQty: { gt: 0 } }, select: { workOrderVersion: true, operationType: true, carriedWorkOrderProgressQty: true } },
      },
    }),
    client.orderItem.groupBy({
      by: ['orderId'],
      where: { orderId: { in: uniqueIds } },
      _sum: { quantity: true },
    }),
    client.productionWorkOrderProgress.groupBy({
      by: ['orderId', 'workOrderVersion', 'stage'],
      where: { orderId: { in: uniqueIds } },
      _sum: { workOrderProgressQuantity: true },
    }),
    client.productionScanClaim.findMany({
      where: { orderId: { in: uniqueIds } },
      select: { orderId: true, workOrderVersion: true, claimedAt: true },
    }),
  ]);

  const totalByOrder = new Map(
    orderTotals.map((row) => [
      row.orderId,
      new Decimal(row._sum.quantity ?? 0),
    ]),
  );
  const currentReleaseByOrder = new Map(
    orders.map((order) => [
      order.id,
      {
        workOrderVersion: order.workOrderVersion,
        scheduledAt: order.scheduledAt,
      },
    ]),
  );
  const claimByOrder = new Map(
    claims
      .filter((claim) => {
        const release = currentReleaseByOrder.get(claim.orderId);
        return (
          release?.scheduledAt != null &&
          release.workOrderVersion === claim.workOrderVersion &&
          claim.claimedAt.getTime() >= release.scheduledAt.getTime()
        );
      })
      .map((claim) => [claim.orderId, claim.claimedAt]),
  );
  const progressByOrder = new Map<
    string,
    { foiling: Decimal; packing: Decimal }
  >();
  for (const order of orders) {
    const totals = { foiling: new Decimal(0), packing: new Decimal(0) };
    for (const operation of order.productionOperations ?? []) {
      if (operation.workOrderVersion !== order.workOrderVersion) continue;
      const key = operation.operationType === 'PACKING' ? 'packing' : 'foiling';
      totals[key] = totals[key].plus(operation.carriedWorkOrderProgressQty.toString());
    }
    progressByOrder.set(order.id, totals);
  }
  for (const row of progressTotals) {
    if (
      row.workOrderVersion !==
      currentReleaseByOrder.get(row.orderId)?.workOrderVersion
    ) {
      continue;
    }
    const totals = progressByOrder.get(row.orderId) ?? {
      foiling: new Decimal(0),
      packing: new Decimal(0),
    };
    const value = new Decimal(
      row._sum.workOrderProgressQuantity?.toString() ?? 0,
    );
    if (row.stage === ProductionWorkOrderStage.FOILING) {
      totals.foiling = totals.foiling.plus(value);
    } else {
      totals.packing = totals.packing.plus(value);
    }
    progressByOrder.set(row.orderId, totals);
  }

  return new Map(
    uniqueIds.map((orderId) => {
      const orderTotal = totalByOrder.get(orderId) ?? new Decimal(0);
      const progress = progressByOrder.get(orderId) ?? {
        foiling: new Decimal(0),
        packing: new Decimal(0),
      };
      return [
        orderId,
        {
          orderId,
          orderTotal: orderTotal.toString(),
          foilingProgress: progress.foiling.toString(),
          packingProgress: progress.packing.toString(),
          // These are corruption guards. Normal writes are hard-rejected before
          // either flag can become true, but the UI must still expose bad data.
          foilingOverLimit: progress.foiling.gt(orderTotal),
          packingOverLimit: progress.packing.gt(orderTotal),
          // Derived live; never persisted as a stale anomaly flag.
          packingAhead: progress.packing.gt(progress.foiling),
          firstClaimedAt: claimByOrder.get(orderId) ?? null,
        },
      ];
    }),
  );
}

export type StagnantProductionOrder = {
  orderId: string;
  orderNo: string;
  workOrderVersion: number;
  scheduledAt: Date;
  releaseKey: string;
};

/**
 * Read current released orders that have no real first-scan fact. The cutoff
 * is derived from PostgreSQL time, never the web/cron host clock.
 */
export async function scanStagnantProductionOrders(input: {
  thresholdDays: number;
  batchSize: number;
}): Promise<StagnantProductionOrder[]> {
  if (!Number.isInteger(input.thresholdDays) || input.thresholdDays < 1) {
    throw new TypeError('生产停滞阈值必须是正整数天');
  }
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 1000
  ) {
    throw new TypeError('生产停滞扫描批量必须在 1–1000 之间');
  }

  const now = await databaseClockNow(db);
  const cutoff = new Date(
    now.getTime() - input.thresholdDays * 24 * 60 * 60 * 1000,
  );
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      orderNo: string;
      workOrderVersion: number;
      scheduledAt: Date;
    }>
  >`
    SELECT
      orders."id",
      orders."orderNo",
      orders."workOrderVersion",
      orders."scheduledAt"
    FROM "Order" orders
    WHERE orders."status" IN (
      ${OrderStatus.RELEASED}::"OrderStatus",
      ${OrderStatus.FOILING}::"OrderStatus",
      ${OrderStatus.PACKING}::"OrderStatus"
    )
      AND orders."scheduledAt" IS NOT NULL
      AND orders."scheduledAt" <= ${cutoff}
      AND orders."purpose" <> ${OrderPurpose.SAMPLE_SHIPMENT}::"OrderPurpose"
      AND (
        EXISTS (
          SELECT 1
          FROM "ProductionOperation" unit
          WHERE unit."orderId" = orders."id"
            AND unit."workOrderVersion" = orders."workOrderVersion"
            AND unit."status" IN (${ProductionOperationStatus.PENDING}::"ProductionOperationStatus", ${ProductionOperationStatus.IN_PROGRESS}::"ProductionOperationStatus")
            AND NOT (orders."simpleProduction" AND unit."operationType" = ${'PACKING'}::"PieceworkOperationType")
        )
        OR EXISTS (
          SELECT 1
          FROM "ProductionProgressStep" unit
          WHERE unit."orderId" = orders."id"
            AND unit."workOrderVersion" = orders."workOrderVersion"
            AND unit."status" IN (${ProductionOperationStatus.PENDING}::"ProductionOperationStatus", ${ProductionOperationStatus.IN_PROGRESS}::"ProductionOperationStatus")
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "ProductionScanClaim" claim
        WHERE claim."orderId" = orders."id"
          AND claim."workOrderVersion" = orders."workOrderVersion"
          AND claim."claimedAt" >= orders."scheduledAt"
      )
    ORDER BY orders."scheduledAt" ASC, orders."id" ASC
    LIMIT ${input.batchSize}
  `;

  return rows.flatMap((row) =>
    row.scheduledAt
      ? [
          {
            orderId: row.id,
            orderNo: row.orderNo,
            workOrderVersion: row.workOrderVersion,
            scheduledAt: row.scheduledAt,
            releaseKey: `${row.id}:v${row.workOrderVersion}:${row.scheduledAt.toISOString()}`,
          },
        ]
      : [],
  );
}

export type ProductionAlertFactBatch = {
  progress: Array<{
    id: string;
    orderId: string;
    orderNo: string;
    operationType: 'FOILING' | 'PACKING';
    completedQty: string;
    reportedAt: Date;
  }>;
  releasedOrders: Array<{
    orderId: string;
    orderNo: string;
    releaseKey: string;
    releasedAt: Date;
  }>;
  claims: Array<{
    id: string;
    orderId: string;
    reporterId: string;
    idempotencyKey: string;
    claimedAt: Date;
  }>;
  nextCursor: ProductionAlertPageCursor | null;
};

export type ProductionAlertPageCursor = {
  scheduledAt: Date;
  orderId: string;
};

/**
 * Keyset page for the W2 notification runner. The runner follows nextCursor
 * to exhaustion in one durable run, so old deduped orders cannot permanently
 * occupy a fixed `take` window and starve later active orders.
 */
export async function loadProductionAlertFacts(input: {
  orderLimit: number;
  cursor?: ProductionAlertPageCursor;
}): Promise<ProductionAlertFactBatch> {
  if (
    !Number.isInteger(input.orderLimit) ||
    input.orderLimit < 1 ||
    input.orderLimit > 1000
  ) {
    throw new TypeError('生产提醒扫描批量必须在 1–1000 之间');
  }
  if (
    input.cursor &&
    (!input.cursor.orderId ||
      !Number.isFinite(input.cursor.scheduledAt.getTime()))
  ) {
    throw new TypeError('生产提醒扫描游标不合法');
  }
  const orderPage = await db.order.findMany({
    where: {
      status: { in: [...ACTIVE_PRODUCTION_STATUSES] },
      scheduledAt: { not: null },
      ...(input.cursor
        ? {
            OR: [
              { scheduledAt: { gt: input.cursor.scheduledAt } },
              {
                scheduledAt: input.cursor.scheduledAt,
                id: { gt: input.cursor.orderId },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      orderNo: true,
      workOrderVersion: true,
      scheduledAt: true,
      purpose: true,
      simpleProduction: true,
      productionOperations: { where: CLAIMABLE_UNIT_WHERE, select: { workOrderVersion: true, operationType: true } },
      productionProgressSteps: { where: CLAIMABLE_UNIT_WHERE, select: { workOrderVersion: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: input.orderLimit + 1,
  });
  const hasNextPage = orderPage.length > input.orderLimit;
  const orders = orderPage.slice(0, input.orderLimit);
  const lastOrder = orders.at(-1);
  const nextCursor =
    hasNextPage && lastOrder?.scheduledAt
      ? { scheduledAt: lastOrder.scheduledAt, orderId: lastOrder.id }
      : null;
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length === 0) {
    return { progress: [], releasedOrders: [], claims: [], nextCursor: null };
  }

  const [progressRows, claims] = await Promise.all([
    db.productionWorkOrderProgress.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        workOrderVersion: true,
        stage: true,
        workOrderProgressQuantity: true,
        reportedAt: true,
        order: { select: { orderNo: true } },
      },
      orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
    }),
    db.productionScanClaim.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        reporterId: true,
        idempotencyKey: true,
        workOrderVersion: true,
        claimedAt: true,
      },
    }),
  ]);
  const releaseByOrderId = new Map(
    orders.map((order) => [
      order.id,
      {
        workOrderVersion: order.workOrderVersion,
        scheduledAt: order.scheduledAt,
      },
    ]),
  );

  return {
    progress: progressRows
      .filter(
        (row) =>
          row.workOrderVersion ===
          releaseByOrderId.get(row.orderId)?.workOrderVersion,
      )
      .map((row) => ({
        id: row.id,
        orderId: row.orderId,
        orderNo: row.order.orderNo,
        operationType: row.stage,
        completedQty: row.workOrderProgressQuantity.toString(),
        reportedAt: row.reportedAt,
      })),
    releasedOrders: orders.flatMap((order) =>
      order.scheduledAt && hasClaimableCurrentGeneration(order)
        ? [
            {
              orderId: order.id,
              orderNo: order.orderNo,
              releaseKey: `${order.id}:v${order.workOrderVersion}:${order.scheduledAt.toISOString()}`,
              releasedAt: order.scheduledAt,
            },
          ]
        : [],
    ),
    claims: claims
      .filter((claim) => {
        const order = releaseByOrderId.get(claim.orderId);
        return (
          order?.scheduledAt != null &&
          claim.workOrderVersion === order.workOrderVersion &&
          claim.claimedAt.getTime() >= order.scheduledAt.getTime()
        );
      })
      .map((claim) => ({
        id: claim.id,
        orderId: claim.orderId,
        reporterId: claim.reporterId,
        idempotencyKey: claim.idempotencyKey,
        claimedAt: claim.claimedAt,
      })),
    nextCursor,
  };
}
