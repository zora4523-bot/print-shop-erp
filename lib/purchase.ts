import { acquireWarehouseStockLock } from '@/lib/warehouse-coordination';
import { createWithRequest, type CreationRequest } from '@/lib/form-drafts/creation-request';
import { purchaseCreationFacts } from '@/lib/form-drafts/creation-facts';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import {
  PartyType,
  Prisma,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  TxDirection,
} from '../generated/prisma/client';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
  type SortDirection,
} from './admin/table';
import { db } from './db';
import {
  DailyDocumentNumberExhaustedError,
  nextDailyDocumentNumber,
} from './daily-document-number';
import {
  applyMaterialStockMovement,
  MaterialInvariantError,
  type MaterialStockAlert,
} from './material';
import { dispatchNotification } from './notification/dispatch';
import { enqueueNotificationInTransaction } from './notification/transactional-outbox';
import type { EnqueueClient } from './background-jobs/repository';
import type {
  CreatePurchaseOrderInput,
  CreatePurchaseReceiptInput,
} from './auth/schemas';
import { purchaseReceiptRequestLockKey } from './purchase-locks';

export class PurchaseInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseInvariantError';
  }
}

export const PURCHASE_ORDER_LIST_SORT_KEYS = [
  'default',
  'purchaseNo',
  'supplierName',
  'status',
  'createdAt',
] as const;

export type PurchaseOrderListSortKey =
  (typeof PURCHASE_ORDER_LIST_SORT_KEYS)[number];

const PURCHASE_ORDER_LIST_SELECT = {
  id: true,
  purchaseNo: true,
  supplierCode: true,
  supplierName: true,
  status: true,
  expectedDate: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      quantity: true,
      receivedQuantity: true,
      unitCost: true,
      material: {
        select: {
          code: true,
          name: true,
          unit: true,
        },
      },
    },
  },
} as const;

const PURCHASE_ORDER_DETAIL_SELECT = {
  ...PURCHASE_ORDER_LIST_SELECT,
  supplierPartyId: true,
  remark: true,
  items: {
    select: {
      id: true,
      materialId: true,
      quantity: true,
      receivedQuantity: true,
      unitCost: true,
      remark: true,
      material: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          currentStock: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  receipts: {
    select: {
      id: true,
      receiptNo: true,
      status: true,
      receivedAt: true,
      cancelledAt: true,
      cancelReason: true,
      remark: true,
      items: {
        select: {
          id: true,
          purchaseOrderItemId: true,
          quantity: true,
          unitCost: true,
          material: {
            select: {
              code: true,
              name: true,
              unit: true,
            },
          },
        },
      },
    },
    orderBy: { receivedAt: 'desc' as const },
  },
} as const;

export type PurchaseOrderSummary = Awaited<
  ReturnType<typeof listPurchaseOrders>
>[number];

export type PurchaseOrderDetail = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrderDetail>>
>;

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function purchaseOrderSearchFilter(q?: string | null) {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [
      { purchaseNo: { contains: query, mode: 'insensitive' as const } },
      { supplierCode: { contains: query, mode: 'insensitive' as const } },
      { supplierName: { contains: query, mode: 'insensitive' as const } },
      {
        items: {
          some: {
            material: {
              OR: [
                { code: { contains: query, mode: 'insensitive' as const } },
                { name: { contains: query, mode: 'insensitive' as const } },
              ],
            },
          },
        },
      },
    ],
  };
}

function purchaseOrderListOrderBy(
  sort: PurchaseOrderListSortKey,
  direction: SortDirection,
): Prisma.PurchaseOrderOrderByWithRelationInput[] {
  switch (sort) {
    case 'purchaseNo':
      return [{ purchaseNo: direction }, { id: 'asc' }];
    case 'supplierName':
      return [{ supplierName: direction }, { id: 'asc' }];
    case 'status':
      return [{ status: direction }, { purchaseNo: 'desc' }, { id: 'asc' }];
    case 'createdAt':
      return [{ createdAt: direction }, { id: 'asc' }];
    default:
      return [{ createdAt: 'desc' }, { purchaseNo: 'desc' }, { id: 'asc' }];
  }
}

export async function listPurchaseOrders(opts: {
  q?: string | null;
} = {}) {
  return db.purchaseOrder.findMany({
    where: purchaseOrderSearchFilter(opts.q),
    select: PURCHASE_ORDER_LIST_SELECT,
    orderBy: [{ createdAt: 'desc' }, { purchaseNo: 'desc' }],
  });
}

export async function listPurchaseOrdersPage(opts: {
  q?: string | null;
  page: number;
  pageSize: number;
  sort: PurchaseOrderListSortKey;
  direction: SortDirection;
}): Promise<PaginatedResult<PurchaseOrderSummary>> {
  const where = purchaseOrderSearchFilter(opts.q);
  const total = await db.purchaseOrder.count({ where });
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.purchaseOrder.findMany({
    where,
    select: PURCHASE_ORDER_LIST_SELECT,
    orderBy: purchaseOrderListOrderBy(opts.sort, opts.direction),
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows, total, window);
}

export async function getPurchaseOrderDetail(id: string) {
  return db.purchaseOrder.findUnique({
    where: { id },
    select: PURCHASE_ORDER_DETAIL_SELECT,
  });
}

function parsePositiveDecimal(value: string, label: string): Decimal {
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new PurchaseInvariantError(`${label}格式不合法`);
  }
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new PurchaseInvariantError(`${label}必须大于 0`);
  }
  return decimal;
}

const PURCHASE_RECEIPT_QUANTITY_MAX = new Decimal('9999999999.99');
const PURCHASE_RECEIPT_UNIT_COST_MAX = new Decimal('999999.9999');

function normalizePurchaseReceiptQuantity(value: string): Decimal {
  const quantity = parsePositiveDecimal(value, '入库数量');
  if (quantity.decimalPlaces() > 2 || quantity.gt(PURCHASE_RECEIPT_QUANTITY_MAX)) {
    throw new PurchaseInvariantError('入库数量超出可保存范围');
  }
  return quantity;
}

function normalizePurchaseReceiptUnitCost(value: string | null): string | null {
  if (value === null) return null;
  let unitCost: Decimal;
  try {
    unitCost = new Decimal(value);
  } catch {
    throw new PurchaseInvariantError('入库单价格式不合法');
  }
  if (
    !unitCost.isFinite() ||
    unitCost.isNegative() ||
    unitCost.decimalPlaces() > 4 ||
    unitCost.gt(PURCHASE_RECEIPT_UNIT_COST_MAX)
  ) {
    throw new PurchaseInvariantError('入库单价超出可保存范围');
  }
  return unitCost.toFixed(4);
}

type PurchaseReceiptRequestFacts = {
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  locationId: string | null;
  quantity: string;
  unitCost: string | null;
  remark: string | null;
  receivedById: string;
};

const PURCHASE_RECEIPT_REPLAY_SELECT = {
  purchaseOrderId: true,
  receivedById: true,
  remark: true,
  requestFingerprint: true,
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      purchaseOrderItemId: true,
      quantity: true,
      unitCost: true,
      materialTransactions: {
        where: {
          direction: TxDirection.IN,
          reasonType: 'PURCHASE_RECEIPT',
        },
        orderBy: { createdAt: 'asc' as const },
        take: 1,
        select: { locationId: true },
      },
    },
  },
} as const;

type StoredPurchaseReceiptRequest = {
  purchaseOrderId: string;
  receivedById: string;
  remark: string | null;
  requestFingerprint: string | null;
  items: Array<{
    purchaseOrderItemId: string;
    quantity: Decimal.Value;
    unitCost: Decimal.Value | null;
    materialTransactions: Array<{ locationId: string | null }>;
  }>;
};

function purchaseReceiptRequestFingerprint(
  facts: PurchaseReceiptRequestFacts,
): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

function assertPurchaseReceiptReplayMatches(
  stored: StoredPurchaseReceiptRequest,
  requested: PurchaseReceiptRequestFacts,
  fingerprint: string,
): void {
  if (stored.purchaseOrderId !== requested.purchaseOrderId) {
    throw new PurchaseInvariantError('入库请求标识已被其他采购单使用');
  }
  if (stored.requestFingerprint !== null) {
    if (stored.requestFingerprint !== fingerprint) {
      throw new PurchaseInvariantError(
        '入库请求标识与原请求内容不一致，请刷新后重试',
      );
    }
    return;
  }

  // Rows created before request fingerprints were introduced retain enough
  // relational evidence for a compatibility comparison. A historical null
  // location meant "the then-current default location"; that original input
  // bit was not persisted, so null can only be compared to the recorded IN
  // movement rather than reconstructed from today's default configuration.
  const item = stored.items.length === 1 ? stored.items[0] : null;
  const movement = item?.materialTransactions[0] ?? null;
  const sameLocation =
    requested.locationId === null
      ? movement?.locationId != null
      : movement?.locationId === requested.locationId;
  const sameUnitCost =
    item !== null &&
    ((item.unitCost === null && requested.unitCost === null) ||
      (item.unitCost !== null &&
        requested.unitCost !== null &&
        new Decimal(item.unitCost).eq(requested.unitCost)));
  if (
    stored.receivedById !== requested.receivedById ||
    stored.remark !== requested.remark ||
    item?.purchaseOrderItemId !== requested.purchaseOrderItemId ||
    !new Decimal(item?.quantity ?? Number.NaN).eq(requested.quantity) ||
    !sameUnitCost ||
    !sameLocation
  ) {
    throw new PurchaseInvariantError(
      '入库请求标识与原请求内容不一致，请刷新后重试',
    );
  }
}

function parseOptionalDate(value: string | null): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000+08:00`);
}

async function applyPurchaseStockMovement(
  tx: unknown,
  data: Parameters<typeof applyMaterialStockMovement>[1],
) {
  try {
    return await applyMaterialStockMovement(tx, data);
  } catch (err) {
    if (err instanceof MaterialInvariantError) {
      throw new PurchaseInvariantError(err.message);
    }
    throw err;
  }
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
  now: Date = new Date(),
  request?: CreationRequest,
): Promise<PurchaseOrderDetail & { creationReplayed?: boolean }> {
  const quantity = parsePositiveDecimal(input.quantity, '采购数量');
  // Legacy callers reserve before the transaction. Draft-aware creation reserves
  // inside its request transaction after authorization; retries reuse the receipt.
  const reservedNo = request ? null : await reservePurchaseDocumentNumber('PURCHASE_ORDER', now);

  const result = await db.$transaction(async (tx) => {
    const create = async () => {
      const [supplier, material] = await Promise.all([
        tx.party.findUnique({
          where: { id: input.supplierPartyId },
          select: { id: true, type: true, isActive: true, code: true, name: true },
        }),
        tx.material.findUnique({
          where: { id: input.materialId },
          select: { id: true, isActive: true },
        }),
      ]);
      if (!supplier) throw new PurchaseInvariantError('供应商不存在');
      if (!supplier.isActive) throw new PurchaseInvariantError('供应商已停用');
      if (supplier.type === PartyType.CUSTOMER) {
        throw new PurchaseInvariantError('客户不能作为采购供应商');
      }
      if (!material) throw new PurchaseInvariantError('物料不存在');
      if (!material.isActive) throw new PurchaseInvariantError('物料已停用');

      const created = await tx.purchaseOrder.create({
        data: {
          purchaseNo: reservedNo ?? await reservePurchaseDocumentNumber('PURCHASE_ORDER', now, tx),
          supplierPartyId: supplier.id,
          supplierCode: supplier.code,
          supplierName: supplier.name,
          expectedDate: parseOptionalDate(input.expectedDate),
          remark: input.remark,
          items: {
            create: [
              {
                materialId: input.materialId,
                quantity: quantity.toFixed(2),
                unitCost: input.unitCost,
              },
            ],
          },
        },
        select: { id: true },
      });
      return created.id;
    };
    return request ? createWithRequest(tx, 'purchase-new', request, purchaseCreationFacts(input), create) : { entityId: await create(), replayed: false };
  });

  const detail = await getPurchaseOrderDetail(result.entityId);
  if (!detail) throw new PurchaseInvariantError('采购单创建后读取失败');
  return request ? { ...detail, creationReplayed: result.replayed } : detail;
}

function statusAfterReceivedQuantities(
  items: readonly { quantity: Decimal.Value; receivedQuantity: Decimal.Value }[],
): PurchaseOrderStatus {
  const received = items.map((item) => new Decimal(item.receivedQuantity));
  if (received.every((qty) => qty.lte(0))) return PurchaseOrderStatus.ORDERED;
  const allDone = items.every((item) =>
    new Decimal(item.receivedQuantity).gte(new Decimal(item.quantity)),
  );
  return allDone
    ? PurchaseOrderStatus.RECEIVED
    : PurchaseOrderStatus.PARTIALLY_RECEIVED;
}

export async function createPurchaseReceipt(
  purchaseOrderId: string,
  input: CreatePurchaseReceiptInput,
  actor: { id: string },
  now: Date = new Date(),
): Promise<PurchaseOrderDetail> {
  const receiptQuantity = normalizePurchaseReceiptQuantity(input.quantity);
  const normalizedUnitCost = normalizePurchaseReceiptUnitCost(input.unitCost);
  const requestFacts: PurchaseReceiptRequestFacts = {
    purchaseOrderId,
    purchaseOrderItemId: input.purchaseOrderItemId,
    locationId: input.locationId,
    quantity: receiptQuantity.toFixed(2),
    unitCost: normalizedUnitCost,
    remark: input.remark,
    receivedById: actor.id,
  };
  const requestFingerprint = purchaseReceiptRequestFingerprint(requestFacts);

  const existingBeforeReservation = await db.purchaseReceipt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: PURCHASE_RECEIPT_REPLAY_SELECT,
  });
  if (existingBeforeReservation) {
    assertPurchaseReceiptReplayMatches(
      existingBeforeReservation,
      requestFacts,
      requestFingerprint,
    );
    const existingDetail = await getPurchaseOrderDetail(purchaseOrderId);
    if (!existingDetail) throw new PurchaseInvariantError('采购单不存在');
    return existingDetail;
  }

  // 入库单号在幂等快查后、锁事务前独立预留；后续校验失败，或
  // 并发重放在事务内命中 existingRequest，都会留下空隙。入库编号明确允许不连续。
  const receiptNo = await reservePurchaseDocumentNumber('PURCHASE_RECEIPT', now);

  await db.$transaction(async (tx) => {
    await acquireWarehouseStockLock(tx);
    // The request-key lock must precede the purchase-order row lock. Two
    // concurrent requests can reuse one key across different purchase orders;
    // serializing by the key makes the loser compare facts and fail with a
    // domain error instead of leaking a unique-index exception.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${purchaseReceiptRequestLockKey(
      input.idempotencyKey,
    )}))`;

    const existingRequest = await tx.purchaseReceipt.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: PURCHASE_RECEIPT_REPLAY_SELECT,
    });
    if (existingRequest) {
      assertPurchaseReceiptReplayMatches(
        existingRequest,
        requestFacts,
        requestFingerprint,
      );
      return;
    }

    const lockedOrders = await tx.$queryRaw<
      { id: string; status: PurchaseOrderStatus }[]
    >`SELECT id, status
        FROM "PurchaseOrder"
       WHERE id = ${purchaseOrderId}
       FOR UPDATE`;
    const order = lockedOrders[0];
    if (!order) throw new PurchaseInvariantError('采购单不存在');
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new PurchaseInvariantError('已取消采购单不能入库');
    }

    const lockedItems = await tx.$queryRaw<
      {
        id: string;
        materialId: string;
        quantity: Decimal.Value;
        receivedQuantity: Decimal.Value;
      }[]
    >`SELECT id, "materialId", quantity, "receivedQuantity"
       FROM "PurchaseOrderItem"
      WHERE id = ${input.purchaseOrderItemId}
        AND "purchaseOrderId" = ${purchaseOrderId}
      FOR UPDATE`;
    const item = lockedItems[0];
    if (!item) throw new PurchaseInvariantError('采购明细不存在');

    const ordered = new Decimal(item.quantity);
    const received = new Decimal(item.receivedQuantity);
    const remaining = ordered.minus(received);
    if (remaining.lte(0)) throw new PurchaseInvariantError('该明细已全部入库');
    if (receiptQuantity.gt(remaining)) {
      throw new PurchaseInvariantError(`入库数量不能超过剩余 ${remaining.toFixed(2)}`);
    }

    const receipt = await tx.purchaseReceipt.create({
      data: {
        receiptNo,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        purchaseOrderId,
        receivedById: actor.id,
        receivedAt: now,
        remark: input.remark,
      },
      select: { id: true },
    });
    const receiptItem = await tx.purchaseReceiptItem.create({
      data: {
        receiptId: receipt.id,
        purchaseOrderItemId: item.id,
        materialId: item.materialId,
        quantity: receiptQuantity.toFixed(2),
        unitCost: normalizedUnitCost,
      },
      select: { id: true },
    });

    await applyPurchaseStockMovement(tx, {
      materialId: item.materialId,
      locationId: input.locationId,
      direction: TxDirection.IN,
      quantity: receiptQuantity.toFixed(2),
      reasonType: 'PURCHASE_RECEIPT',
      operatorId: actor.id,
      unitCost: normalizedUnitCost,
      remark: `采购入库 ${receiptNo}`,
      purchaseReceiptItemId: receiptItem.id,
    });
    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { receivedQuantity: received.plus(receiptQuantity).toFixed(2) },
      select: { id: true },
    });

    const nextItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: { quantity: true, receivedQuantity: true },
    });
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: statusAfterReceivedQuantities(nextItems) },
      select: { id: true },
    });
  });

  const detail = await getPurchaseOrderDetail(purchaseOrderId);
  if (!detail) throw new PurchaseInvariantError('采购单入库后读取失败');
  return detail;
}

async function reservePurchaseDocumentNumber(
  kind: 'PURCHASE_ORDER' | 'PURCHASE_RECEIPT',
  now: Date,
  client?: Prisma.TransactionClient,
): Promise<string> {
  try {
    return await (client ? nextDailyDocumentNumber(kind, now, client) : nextDailyDocumentNumber(kind, now));
  } catch (error) {
    if (error instanceof DailyDocumentNumberExhaustedError) {
      throw new PurchaseInvariantError(error.message);
    }
    throw error;
  }
}

export async function cancelPurchaseReceipt(
  receiptId: string,
  actor: { id: string },
  reason: string | null,
  now: Date = new Date(),
): Promise<PurchaseOrderDetail> {
  let purchaseOrderId: string | null = null;
  // 取消入库是出库方向，可能把库存带破安全线。生产 durable
  // 模式在同一 tx 写作业账本；inline dev/test 才在 commit 后 dispatch。
  const stockAlerts: Array<{
    payload: MaterialStockAlert;
    deliveryKey: string;
  }> = [];
  let notificationsQueued = false;

  await db.$transaction(async (tx) => {
    await acquireWarehouseStockLock(tx);
    const receiptPointer = await tx.purchaseReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, purchaseOrderId: true },
    });
    if (!receiptPointer) throw new PurchaseInvariantError('入库单不存在');

    const lockedOrders = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
        FROM "PurchaseOrder"
       WHERE id = ${receiptPointer.purchaseOrderId}
       FOR UPDATE
    `;
    if (lockedOrders.length === 0) {
      throw new PurchaseInvariantError('采购单不存在');
    }

    const lockedReceipts = await tx.$queryRaw<
      { id: string; status: PurchaseReceiptStatus }[]
    >`SELECT id, status
        FROM "PurchaseReceipt"
       WHERE id = ${receiptId}
         AND "purchaseOrderId" = ${receiptPointer.purchaseOrderId}
       FOR UPDATE`;
    const lockedReceipt = lockedReceipts[0];
    if (!lockedReceipt) throw new PurchaseInvariantError('入库单不存在');
    if (lockedReceipt.status === PurchaseReceiptStatus.CANCELLED) {
      throw new PurchaseInvariantError('入库单已取消');
    }

    const receipt = await tx.purchaseReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        purchaseOrderId: true,
        receiptNo: true,
        status: true,
        items: {
          select: {
            id: true,
            purchaseOrderItemId: true,
            materialId: true,
            quantity: true,
            unitCost: true,
            materialTransactions: {
              where: {
                direction: TxDirection.IN,
                reasonType: 'PURCHASE_RECEIPT',
              },
              select: {
                locationId: true,
              },
              take: 1,
            },
          },
        },
      },
    });
    if (!receipt) throw new PurchaseInvariantError('入库单不存在');
    purchaseOrderId = receipt.purchaseOrderId;

    stockAlerts.length = 0; // 事务重跑时不残留上一轮的告警

    for (const item of receipt.items) {
      const quantity = new Decimal(item.quantity);
      const movement = await applyPurchaseStockMovement(tx, {
        materialId: item.materialId,
        locationId: item.materialTransactions[0]?.locationId ?? null,
        direction: TxDirection.OUT,
        quantity: quantity.toFixed(2),
        reasonType: 'PURCHASE_RECEIPT_CANCEL',
        operatorId: actor.id,
        unitCost: item.unitCost ? String(item.unitCost) : null,
        remark: `取消采购入库 ${receipt.receiptNo}${reason ? `：${reason}` : ''}`,
        purchaseReceiptItemId: item.id,
      });
      if (movement.stockAlert) {
        stockAlerts.push({
          payload: movement.stockAlert,
          deliveryKey: `notification:STOCK_ALERT:${movement.transaction.id}`,
        });
      }

      const lockedItems = await tx.$queryRaw<
        { id: string; quantity: Decimal.Value; receivedQuantity: Decimal.Value }[]
      >`SELECT id, quantity, "receivedQuantity"
         FROM "PurchaseOrderItem"
        WHERE id = ${item.purchaseOrderItemId}
        FOR UPDATE`;
      const purchaseItem = lockedItems[0];
      if (!purchaseItem) throw new PurchaseInvariantError('采购明细不存在');
      const nextReceived = new Decimal(purchaseItem.receivedQuantity).minus(quantity);
      if (nextReceived.lt(0)) {
        throw new PurchaseInvariantError('入库取消数量超过采购明细已入库数量');
      }
      await tx.purchaseOrderItem.update({
        where: { id: purchaseItem.id },
        data: { receivedQuantity: nextReceived.toFixed(2) },
        select: { id: true },
      });
    }

    await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: {
        status: PurchaseReceiptStatus.CANCELLED,
        cancelledAt: now,
        cancelReason: reason,
      },
      select: { id: true },
    });

    const nextItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: receipt.purchaseOrderId },
      select: { quantity: true, receivedQuantity: true },
    });
    await tx.purchaseOrder.update({
      where: { id: receipt.purchaseOrderId },
      data: { status: statusAfterReceivedQuantities(nextItems) },
      select: { id: true },
    });

    const queueResults: boolean[] = [];
    for (const alert of stockAlerts) {
      queueResults.push(
        await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'STOCK_ALERT',
          alert.payload,
          { dedupeKey: alert.deliveryKey },
        ),
      );
    }
    notificationsQueued = queueResults.length > 0 && queueResults.every(Boolean);
  });

  if (!purchaseOrderId) throw new PurchaseInvariantError('采购单不存在');
  for (const alert of stockAlerts) {
    if (notificationsQueued) break;
    await dispatchNotification('STOCK_ALERT', alert.payload, {
      dedupeKey: alert.deliveryKey,
    });
  }
  const detail = await getPurchaseOrderDetail(purchaseOrderId);
  if (!detail) throw new PurchaseInvariantError('采购单取消入库后读取失败');
  return detail;
}

export async function cancelPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  await db.$transaction(async (tx) => {
    const lockedOrders = await tx.$queryRaw<
      { id: string; status: PurchaseOrderStatus }[]
    >`SELECT id, status
        FROM "PurchaseOrder"
       WHERE id = ${id}
       FOR UPDATE`;
    const order = lockedOrders[0];
    if (!order) throw new PurchaseInvariantError('采购单不存在');
    if (order.status === PurchaseOrderStatus.CANCELLED) return;

    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: id },
      select: { receivedQuantity: true },
    });
    if (items.some((item) => new Decimal(item.receivedQuantity).gt(0))) {
      throw new PurchaseInvariantError(
        '已有入库记录的采购单不能直接取消，请先取消入库单',
      );
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
      select: { id: true },
    });
  });

  const updated = await getPurchaseOrderDetail(id);
  if (!updated) throw new PurchaseInvariantError('采购单取消后读取失败');
  return updated;
}
