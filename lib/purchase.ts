import Decimal from 'decimal.js';
import {
  PartyType,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  type Prisma,
  TxDirection,
} from '../generated/prisma/client';
import {
  paginateItems,
  type PaginatedResult,
  type SortDirection,
} from './admin/table';
import { db } from './db';
import {
  applyMaterialStockMovement,
  MaterialInvariantError,
  type MaterialStockAlert,
} from './material';
import { dispatchNotification } from './notification/dispatch';
import type {
  CreatePurchaseOrderInput,
  CreatePurchaseReceiptInput,
} from './auth/schemas';

export class PurchaseInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseInvariantError';
  }
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  ORDERED: '已下单',
  PARTIALLY_RECEIVED: '部分入库',
  RECEIVED: '已入库',
  CANCELLED: '已取消',
};

export const PURCHASE_RECEIPT_STATUS_LABELS: Record<PurchaseReceiptStatus, string> = {
  POSTED: '已入库',
  CANCELLED: '已取消',
};

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

function compareText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '', 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareDate(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

function sortPurchaseOrdersForList(
  rows: readonly PurchaseOrderSummary[],
  sort: PurchaseOrderListSortKey,
  direction: SortDirection,
): PurchaseOrderSummary[] {
  if (sort === 'default') return [...rows];

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'purchaseNo':
        return compareText(a.purchaseNo, b.purchaseNo);
      case 'supplierName':
        return compareText(a.supplierName, b.supplierName);
      case 'status':
        return compareText(
          PURCHASE_ORDER_STATUS_LABELS[a.status],
          PURCHASE_ORDER_STATUS_LABELS[b.status],
        );
      case 'createdAt':
        return compareDate(a.createdAt, b.createdAt);
      default:
        return 0;
    }
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
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
  const rows = await listPurchaseOrders({ q: opts.q });
  const sorted = sortPurchaseOrdersForList(rows, opts.sort, opts.direction);
  return paginateItems(sorted, opts.page, opts.pageSize);
}

export async function getPurchaseOrderDetail(id: string) {
  return db.purchaseOrder.findUnique({
    where: { id },
    select: PURCHASE_ORDER_DETAIL_SELECT,
  });
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function nextPurchaseNo(
  tx: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    purchaseOrder: {
      findFirst: (
        args: Prisma.PurchaseOrderFindFirstArgs,
      ) => Promise<{ purchaseNo: string } | null>;
    };
  },
  now: Date,
): Promise<string> {
  const prefix = `PO${ymd(now)}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:purchase-no:${prefix}`}))`;
  const last = await tx.purchaseOrder.findFirst({
    where: { purchaseNo: { startsWith: prefix } },
    orderBy: { purchaseNo: 'desc' },
    select: { purchaseNo: true },
  });
  const previous = last?.purchaseNo.slice(prefix.length) ?? '0000';
  const next = Number.parseInt(previous, 10) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function nextReceiptNo(
  tx: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    purchaseReceipt: {
      findFirst: (
        args: Prisma.PurchaseReceiptFindFirstArgs,
      ) => Promise<{ receiptNo: string } | null>;
    };
  },
  now: Date,
): Promise<string> {
  const prefix = `PR${ymd(now)}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:receipt-no:${prefix}`}))`;
  const last = await tx.purchaseReceipt.findFirst({
    where: { receiptNo: { startsWith: prefix } },
    orderBy: { receiptNo: 'desc' },
    select: { receiptNo: true },
  });
  const previous = last?.receiptNo.slice(prefix.length) ?? '0000';
  const next = Number.parseInt(previous, 10) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function parsePositiveDecimal(value: string, label: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new PurchaseInvariantError(`${label}必须大于 0`);
  }
  return decimal;
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
): Promise<PurchaseOrderDetail> {
  const quantity = parsePositiveDecimal(input.quantity, '采购数量');

  const createdId = await db.$transaction(async (tx) => {
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

    const purchaseNo = await nextPurchaseNo(tx, now);
    const created = await tx.purchaseOrder.create({
      data: {
        purchaseNo,
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
  });

  const detail = await getPurchaseOrderDetail(createdId);
  if (!detail) throw new PurchaseInvariantError('采购单创建后读取失败');
  return detail;
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
  const receiptQuantity = parsePositiveDecimal(input.quantity, '入库数量');

  await db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { id: true, status: true },
    });
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

    const receiptNo = await nextReceiptNo(tx, now);
    const receipt = await tx.purchaseReceipt.create({
      data: {
        receiptNo,
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
        unitCost: input.unitCost,
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
      unitCost: input.unitCost,
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

export async function cancelPurchaseReceipt(
  receiptId: string,
  actor: { id: string },
  reason: string | null,
  now: Date = new Date(),
): Promise<PurchaseOrderDetail> {
  let purchaseOrderId: string | null = null;
  // 取消入库是出库方向，可能把库存带破安全线；告警在 tx 提交后统一
  // dispatch（tx 内发会在回滚时留下幽灵消息）。
  const stockAlerts: MaterialStockAlert[] = [];

  await db.$transaction(async (tx) => {
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
    if (receipt.status === PurchaseReceiptStatus.CANCELLED) {
      throw new PurchaseInvariantError('入库单已取消');
    }
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
      if (movement.stockAlert) stockAlerts.push(movement.stockAlert);

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
  });

  if (!purchaseOrderId) throw new PurchaseInvariantError('采购单不存在');
  for (const alert of stockAlerts) {
    await dispatchNotification('STOCK_ALERT', alert);
  }
  const detail = await getPurchaseOrderDetail(purchaseOrderId);
  if (!detail) throw new PurchaseInvariantError('采购单取消入库后读取失败');
  return detail;
}

export async function cancelPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  const detail = await getPurchaseOrderDetail(id);
  if (!detail) throw new PurchaseInvariantError('采购单不存在');
  if (detail.status === PurchaseOrderStatus.CANCELLED) return detail;
  if (detail.items.some((item) => new Decimal(item.receivedQuantity).gt(0))) {
    throw new PurchaseInvariantError('已有入库记录的采购单不能直接取消，请先取消入库单');
  }

  await db.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.CANCELLED },
    select: { id: true },
  });
  const updated = await getPurchaseOrderDetail(id);
  if (!updated) throw new PurchaseInvariantError('采购单取消后读取失败');
  return updated;
}
