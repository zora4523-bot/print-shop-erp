import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  type WarehouseLocation,
} from '../generated/prisma/client';
import Decimal from 'decimal.js';
import { db } from './db';
import { resolveBusinessCode } from './business-code';
import { shanghaiDayBoundary, todayShanghai } from './dashboard/shanghai-clock';
import type {
  CreateWarehouseInput,
  CreateWarehouseLocationInput,
} from './auth/schemas';

import { acquireWarehouseConfigurationLock, requireWarehouseActor, WarehouseInvariantError } from '@/lib/warehouse-coordination';
export { WarehouseInvariantError } from '@/lib/warehouse-coordination';

export type WarehouseLocationSummary = Pick<
  WarehouseLocation,
  | 'id'
  | 'warehouseId'
  | 'code'
  | 'name'
  | 'isDefault'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

export type WarehouseLocationOption = {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  code: string;
  name: string;
  isDefault: boolean;
};

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  locations: {
    select: {
      id: true,
      warehouseId: true,
      code: true,
      name: true,
      isDefault: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
  },
} satisfies Prisma.WarehouseSelect;

export type WarehouseSummary = Prisma.WarehouseGetPayload<{
  select: typeof WAREHOUSE_SELECT;
}>;

export async function listWarehouses(): Promise<WarehouseSummary[]> {
  return db.warehouse.findMany({
    select: WAREHOUSE_SELECT,
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
  });
}

export async function listActiveWarehouseLocationOptions(): Promise<
  WarehouseLocationOption[]
> {
  const rows = await db.warehouseLocation.findMany({
    where: {
      isActive: true,
      warehouse: { isActive: true },
    },
    select: {
      id: true,
      warehouseId: true,
      code: true,
      name: true,
      isDefault: true,
      warehouse: {
        select: {
          code: true,
          name: true,
          isDefault: true,
        },
      },
    },
    orderBy: [
      { warehouse: { isDefault: 'desc' } },
      { warehouse: { code: 'asc' } },
      { isDefault: 'desc' },
      { code: 'asc' },
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
    code: row.code,
    name: row.name,
    isDefault: row.warehouse.isDefault && row.isDefault,
  }));
}

export type WarehouseDashboard = Awaited<
  ReturnType<typeof getWarehouseDashboard>
>;

/**
 * Operational warehouse view. Quantities stay separated by material/unit;
 * unlike units are deliberately never added into a misleading grand total.
 */
export async function getWarehouseDashboard(now: Date = new Date()) {
  const { start: todayStart, end: todayEnd } = shanghaiDayBoundary(
    todayShanghai(now),
  );
  const pendingStatuses = [
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
  ];

  const [
    warehouses,
    materials,
    locations,
    locationStocks,
    pendingItems,
    recentTransactions,
    todayReceiptCount,
    integrityRows,
  ] = await Promise.all([
    listWarehouses(),
    db.material.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, unit: true },
      orderBy: { code: 'asc' },
    }),
    listActiveWarehouseLocationOptions(),
    db.materialLocationStock.findMany({
      select: {
        materialId: true,
        locationId: true,
        currentStock: true,
        material: { select: { code: true, name: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
        location: { select: { code: true, name: true } },
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { location: { code: 'asc' } },
        { material: { code: 'asc' } },
      ],
    }),
    db.purchaseOrderItem.findMany({
      where: { purchaseOrder: { status: { in: pendingStatuses } } },
      select: {
        id: true,
        quantity: true,
        receivedQuantity: true,
        material: { select: { code: true, name: true, unit: true } },
        purchaseOrder: {
          select: {
            id: true,
            purchaseNo: true,
            supplierName: true,
            status: true,
            expectedDate: true,
          },
        },
      },
      orderBy: [
        { purchaseOrder: { expectedDate: { sort: 'asc', nulls: 'last' } } },
        { purchaseOrder: { purchaseNo: 'asc' } },
      ],
    }),
    db.materialTransaction.findMany({
      select: {
        id: true,
        direction: true,
        quantity: true,
        reasonType: true,
        remark: true,
        occurredAt: true,
        material: { select: { code: true, name: true, unit: true } },
        warehouse: { select: { code: true, name: true } },
        location: { select: { code: true, name: true } },
        operator: { select: { displayName: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 30,
    }),
    db.purchaseReceipt.count({
      where: {
        status: PurchaseReceiptStatus.POSTED,
        receivedAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    db.$queryRaw<{ mismatchCount: bigint }[]>`
      SELECT COUNT(*)::bigint AS "mismatchCount"
        FROM "Material" m
        LEFT JOIN (
          SELECT "materialId", COALESCE(SUM("currentStock"), 0) AS total
            FROM "MaterialLocationStock"
           GROUP BY "materialId"
        ) s ON s."materialId" = m.id
       WHERE m."currentStock" <> COALESCE(s.total, 0)
    `,
  ]);

  const allPendingReceipts = pendingItems
    .map((item) => ({
      ...item,
      orderedQuantity: String(item.quantity),
      receivedQuantity: String(item.receivedQuantity),
      remainingQuantity: new Decimal(item.quantity)
        .minus(item.receivedQuantity)
        .toFixed(2),
    }))
    .filter((item) => new Decimal(item.remainingQuantity).gt(0));

  return {
    metrics: {
      warehouseCount: warehouses.filter((warehouse) => warehouse.isActive).length,
      activeLocationCount: locations.length,
      stockPositionCount: locationStocks.filter((stock) =>
        new Decimal(stock.currentStock).gt(0),
      ).length,
      pendingReceiptLineCount: allPendingReceipts.length,
      todayReceiptCount,
      integrityMismatchCount: Number(integrityRows[0]?.mismatchCount ?? 0),
    },
    warehouses,
    materials,
    locations,
    locationStocks: locationStocks.map((stock) => ({
      ...stock,
      currentStock: String(stock.currentStock),
    })),
    pendingReceipts: allPendingReceipts.slice(0, 30),
    recentTransactions: recentTransactions.map((transaction) => ({
      ...transaction,
      quantity: String(transaction.quantity),
    })),
  };
}

export async function createWarehouse(
  data: CreateWarehouseInput,
  actorId: string,
): Promise<WarehouseSummary> {
  return db.$transaction(async (tx) => {
    await acquireWarehouseConfigurationLock(tx);
    await requireWarehouseActor(tx, actorId);
    const code = await resolveBusinessCode('WAREHOUSE', data.code, tx);
    return tx.warehouse.create({
      data: { code, name: data.name, isDefault: false, isActive: true },
      select: WAREHOUSE_SELECT,
    });
  });
}

export async function createWarehouseLocation(
  data: CreateWarehouseLocationInput,
  actorId: string,
): Promise<WarehouseLocationSummary> {
  return db.$transaction(async (tx) => {
    await acquireWarehouseConfigurationLock(tx);
    await requireWarehouseActor(tx, actorId);
    const warehouse = await tx.warehouse.findUnique({
      where: { id: data.warehouseId }, select: { id: true, isActive: true },
    });
    if (!warehouse) throw new WarehouseInvariantError('仓库不存在');
    if (!warehouse.isActive) throw new WarehouseInvariantError('仓库已停用');
    const code = await resolveBusinessCode('LOCATION', data.code, tx);
    return tx.warehouseLocation.create({
      data: { warehouseId: data.warehouseId, code, name: data.name, isDefault: false, isActive: true },
      select: { id: true, warehouseId: true, code: true, name: true, isDefault: true, isActive: true, createdAt: true, updatedAt: true },
    });
  });
}
