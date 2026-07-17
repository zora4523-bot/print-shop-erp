import Decimal from 'decimal.js';
import { TxDirection, type Prisma } from '../generated/prisma/client';
import type { PostInventoryCountInput } from './auth/schemas';
import { db } from './db';
import { applyMaterialStockMovement, MaterialInvariantError } from './material';

export class InventoryCountInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryCountInvariantError';
  }
}

const INVENTORY_COUNT_SELECT = {
  id: true,
  countNo: true,
  countedAt: true,
  remark: true,
  countedBy: { select: { displayName: true } },
  items: {
    select: {
      id: true,
      bookQuantity: true,
      countedQuantity: true,
      difference: true,
      material: { select: { code: true, name: true, unit: true } },
      location: {
        select: {
          code: true,
          name: true,
          warehouse: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: [{ material: { code: 'asc' as const } }, { location: { code: 'asc' as const } }],
  },
} satisfies Prisma.InventoryCountSelect;

export type InventoryCountSummary = Prisma.InventoryCountGetPayload<{
  select: typeof INVENTORY_COUNT_SELECT;
}>;

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function nextCountNo(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const prefix = `IC${ymd(now)}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:inventory-count-no:${prefix}`}))`;
  const last = await tx.inventoryCount.findFirst({
    where: { countNo: { startsWith: prefix } },
    orderBy: { countNo: 'desc' },
    select: { countNo: true },
  });
  const previous = last?.countNo.slice(prefix.length) ?? '0000';
  return `${prefix}${String(Number.parseInt(previous, 10) + 1).padStart(4, '0')}`;
}

export async function postInventoryCount(
  input: PostInventoryCountInput,
  actor: { id: string },
  now: Date = new Date(),
): Promise<InventoryCountSummary> {
  const uniqueKeys = new Set<string>();
  const items = input.items
    .map((item) => ({
      ...item,
      counted: new Decimal(item.countedQuantity),
      key: `${item.materialId}:${item.locationId}`,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const item of items) {
    if (uniqueKeys.has(item.key)) {
      throw new InventoryCountInvariantError('同一物料和库位不能重复盘点');
    }
    uniqueKeys.add(item.key);
    if (!item.counted.isFinite() || item.counted.lt(0)) {
      throw new InventoryCountInvariantError('实盘数量不能为负数');
    }
  }

  const createdId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:inventory-count-request:${input.idempotencyKey}`}))`;
    const existing = await tx.inventoryCount.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return existing.id;

    const countNo = await nextCountNo(tx, now);
    const inventoryCount = await tx.inventoryCount.create({
      data: {
        countNo,
        idempotencyKey: input.idempotencyKey,
        countedById: actor.id,
        countedAt: now,
        remark: input.remark,
      },
      select: { id: true },
    });

    for (const item of items) {
      const [material, location] = await Promise.all([
        tx.material.findUnique({
          where: { id: item.materialId },
          select: { id: true, isActive: true },
        }),
        tx.warehouseLocation.findUnique({
          where: { id: item.locationId },
          select: {
            id: true,
            warehouseId: true,
            isActive: true,
            warehouse: { select: { isActive: true } },
          },
        }),
      ]);
      if (!material) throw new InventoryCountInvariantError('盘点物料不存在');
      if (!material.isActive) throw new InventoryCountInvariantError('盘点物料已停用');
      if (!location) throw new InventoryCountInvariantError('盘点库位不存在');
      if (!location.isActive || !location.warehouse.isActive) {
        throw new InventoryCountInvariantError('盘点库位或所属仓库已停用');
      }

      await tx.$queryRaw`
        SELECT id
          FROM "Material"
         WHERE id = ${item.materialId}
         FOR UPDATE
      `;
      await tx.$executeRaw`
        INSERT INTO "MaterialLocationStock" (
          id, "materialId", "warehouseId", "locationId", "currentStock", "createdAt", "updatedAt"
        ) VALUES (
          'mls_' || md5(${item.materialId} || ':' || ${item.locationId}),
          ${item.materialId},
          ${location.warehouseId},
          ${item.locationId},
          0,
          NOW(),
          NOW()
        )
        ON CONFLICT ("materialId", "locationId") DO NOTHING
      `;
      const lockedStocks = await tx.$queryRaw<{ currentStock: unknown }[]>`
        SELECT "currentStock"
          FROM "MaterialLocationStock"
         WHERE "materialId" = ${item.materialId}
           AND "locationId" = ${item.locationId}
         FOR UPDATE
      `;
      const book = new Decimal(String(lockedStocks[0]?.currentStock ?? 0));
      const difference = item.counted.minus(book);
      const countItem = await tx.inventoryCountItem.create({
        data: {
          inventoryCountId: inventoryCount.id,
          materialId: item.materialId,
          locationId: item.locationId,
          bookQuantity: book.toFixed(2),
          countedQuantity: item.counted.toFixed(2),
          difference: difference.toFixed(2),
        },
        select: { id: true },
      });

      if (difference.eq(0)) continue;
      try {
        await applyMaterialStockMovement(tx, {
          materialId: item.materialId,
          locationId: item.locationId,
          direction: difference.gt(0) ? TxDirection.IN : TxDirection.OUT,
          quantity: difference.abs().toFixed(2),
          reasonType: 'INVENTORY_COUNT',
          inventoryCountItemId: countItem.id,
          operatorId: actor.id,
          unitCost: null,
          remark: `库存盘点 ${countNo}`,
        });
      } catch (error) {
        if (error instanceof MaterialInvariantError) {
          throw new InventoryCountInvariantError(error.message);
        }
        throw error;
      }
    }
    return inventoryCount.id;
  });

  const created = await db.inventoryCount.findUnique({
    where: { id: createdId },
    select: INVENTORY_COUNT_SELECT,
  });
  if (!created) throw new InventoryCountInvariantError('盘点单创建后读取失败');
  return created;
}

export async function listRecentInventoryCounts(
  limit = 10,
): Promise<InventoryCountSummary[]> {
  return db.inventoryCount.findMany({
    select: INVENTORY_COUNT_SELECT,
    orderBy: [{ countedAt: 'desc' }, { countNo: 'desc' }],
    take: Math.min(Math.max(limit, 1), 50),
  });
}
