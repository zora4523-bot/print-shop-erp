import Decimal from 'decimal.js';
import { Prisma, TxDirection } from '../generated/prisma/client';
import type { PostInventoryCountInput } from './auth/schemas';
import { db } from './db';
import {
  DailyDocumentNumberExhaustedError,
  nextDailyDocumentNumber,
} from './daily-document-number';

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

const INVENTORY_COUNT_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 30_000,
} as const;

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

  const existingBeforeReservation = await db.inventoryCount.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existingBeforeReservation) {
    return readInventoryCount(existingBeforeReservation.id);
  }

  let countNo: string;
  try {
    countNo = await nextDailyDocumentNumber('INVENTORY_COUNT', now);
  } catch (error) {
    if (error instanceof DailyDocumentNumberExhaustedError) {
      throw new InventoryCountInvariantError(error.message);
    }
    throw error;
  }

  const materialIds = [...new Set(items.map((item) => item.materialId))].sort();
  const locationIds = [...new Set(items.map((item) => item.locationId))].sort();

  const createdId = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:inventory-count-request:${input.idempotencyKey}`}))`;
      const existing = await tx.inventoryCount.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return existing.id;

      const lockedMaterials = await tx.$queryRaw<
        { id: string; isActive: boolean }[]
      >(Prisma.sql`
        SELECT id, "isActive"
          FROM "Material"
         WHERE id IN (${Prisma.join(materialIds)})
         ORDER BY id
         FOR UPDATE
      `);
      const materialById = new Map(
        lockedMaterials.map((material) => [material.id, material]),
      );
      for (const materialId of materialIds) {
        const material = materialById.get(materialId);
        if (!material) throw new InventoryCountInvariantError('盘点物料不存在');
        if (!material.isActive) {
          throw new InventoryCountInvariantError('盘点物料已停用');
        }
      }

      const locations = await tx.warehouseLocation.findMany({
        where: { id: { in: locationIds } },
        select: {
          id: true,
          warehouseId: true,
          isActive: true,
          warehouse: { select: { isActive: true } },
        },
      });
      const locationById = new Map(
        locations.map((location) => [location.id, location]),
      );
      for (const locationId of locationIds) {
        const location = locationById.get(locationId);
        if (!location) throw new InventoryCountInvariantError('盘点库位不存在');
        if (!location.isActive || !location.warehouse.isActive) {
          throw new InventoryCountInvariantError('盘点库位或所属仓库已停用');
        }
      }

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

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "MaterialLocationStock" (
          id, "materialId", "warehouseId", "locationId", "currentStock", "createdAt", "updatedAt"
        ) VALUES ${Prisma.join(
          items.map((item) => {
            const location = locationById.get(item.locationId)!;
            return Prisma.sql`(
              'mls_' || md5(${item.materialId} || ':' || ${item.locationId}),
              ${item.materialId}, ${location.warehouseId}, ${item.locationId}, 0, NOW(), NOW()
            )`;
          }),
        )}
        ON CONFLICT ("materialId", "locationId") DO NOTHING
      `);

      const lockedStocks = await tx.$queryRaw<
        {
          id: string;
          materialId: string;
          locationId: string;
          currentStock: Prisma.Decimal;
        }[]
      >(Prisma.sql`
        SELECT id, "materialId", "locationId", "currentStock"
          FROM "MaterialLocationStock"
         WHERE ("materialId", "locationId") IN (${Prisma.join(
           items.map(
             (item) => Prisma.sql`(${item.materialId}, ${item.locationId})`,
           ),
         )})
         ORDER BY "materialId", "locationId"
         FOR UPDATE
      `);
      const stockByKey = new Map(
        lockedStocks.map((stock) => [
          `${stock.materialId}:${stock.locationId}`,
          stock,
        ]),
      );
      if (stockByKey.size !== items.length) {
        throw new InventoryCountInvariantError('物料库位库存初始化失败');
      }

      const countRows = items.map((item) => {
        const stock = stockByKey.get(item.key)!;
        const book = new Decimal(stock.currentStock);
        const difference = item.counted.minus(book);
        return {
          ...item,
          book,
          difference,
          warehouseId: locationById.get(item.locationId)!.warehouseId,
        };
      });
      const createdItems = await tx.inventoryCountItem.createManyAndReturn({
        data: countRows.map((item) => ({
          inventoryCountId: inventoryCount.id,
          materialId: item.materialId,
          locationId: item.locationId,
          bookQuantity: item.book.toFixed(2),
          countedQuantity: item.counted.toFixed(2),
          difference: item.difference.toFixed(2),
        })),
        select: { id: true, materialId: true, locationId: true },
      });

      const changedRows = countRows.filter((item) => !item.difference.eq(0));
      if (changedRows.length > 0) {
        const updated = await tx.$executeRaw(Prisma.sql`
          UPDATE "MaterialLocationStock" AS stock
             SET "currentStock" = changes."countedQuantity"::DECIMAL(12,2),
                 "updatedAt" = NOW()
            FROM (VALUES ${Prisma.join(
              changedRows.map(
                (item) =>
                  Prisma.sql`(${item.materialId}, ${item.locationId}, ${item.counted.toFixed(2)})`,
              ),
            )}) AS changes("materialId", "locationId", "countedQuantity")
           WHERE stock."materialId" = changes."materialId"
             AND stock."locationId" = changes."locationId"
        `);
        if (updated !== changedRows.length) {
          throw new InventoryCountInvariantError('盘点库存批量更新不完整');
        }

        const countItemByKey = new Map(
          createdItems.map((item) => [
            `${item.materialId}:${item.locationId}`,
            item.id,
          ]),
        );
        await tx.materialTransaction.createMany({
          data: changedRows.map((item) => ({
            materialId: item.materialId,
            warehouseId: item.warehouseId,
            locationId: item.locationId,
            direction: item.difference.gt(0) ? TxDirection.IN : TxDirection.OUT,
            quantity: item.difference.abs().toFixed(2),
            reasonType: 'INVENTORY_COUNT',
            inventoryCountItemId: countItemByKey.get(item.key)!,
            operatorId: actor.id,
            unitCost: null,
            remark: `库存盘点 ${countNo}`,
            occurredAt: now,
          })),
        });
      }

      return inventoryCount.id;
    },
    INVENTORY_COUNT_TRANSACTION_OPTIONS,
  );

  return readInventoryCount(createdId);
}

async function readInventoryCount(id: string): Promise<InventoryCountSummary> {
  const created = await db.inventoryCount.findUnique({
    where: { id },
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
