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

// ── 账面回声守卫（compare-and-swap）─────────────────────────────────────
// 业主要的语义是「别人在我数东西的时候动过库存就别过账」。本仓库没有「创建
// 盘点单」这一步（页面读账面数 → 录实盘数 → 一次性提交建单+过账），所以钉的
// 不是一个时间戳，而是**录入每一格时页面上显示的账面数**：客户端逐行把它回传
// （items[].bookQuantity），这里在行锁之后和真实余额比对，对不上就不过账那一行。
//
// 为什么不用「快照时间 + 扫流水」：那需要一个全页共用的基线时刻，而分批盘点、
// 搜索、刷新都会让基线和某一行的实际录入时刻分叉——基线推进得比录入晚，守卫就
// 恒等通过；推进得比录入早，几小时前的一次重试又会被判过期。逐行钉住账面数没有
// 这些分叉，也不需要客户端诚实上报时间。
//
// ⚠️ 已知残留缺口：**净额为零的往返**（有人先出 20 再进 20）CAS 检测不到，
//    因为余额回到了原值。要堵这个口需要按 (物料,库位) 扫 MaterialTransaction
//    的逐行时间基线（settle §3b），那需要改表 + 复合索引，单独评审。
//    别把这条当 bug 顺手「修」成时间戳基线。
type SnapshotConflict = {
  /** `${materialId}:${locationId}`，和盘点页表格的行 key 同构 */
  key: string;
  label: string;
  reason: string;
};

// 一次最多点名 3 个库位：提示要能一眼看懂并直接去复盘，而不是把 100 行倒给
// 操作员。全量 key 走 staleKeys 给页面精确定位。
const SNAPSHOT_CONFLICT_SAMPLE = 3;

export class InventoryCountStaleSnapshotError extends InventoryCountInvariantError {
  /** `${materialId}:${locationId}` */
  readonly staleKeys: string[];

  constructor(message: string, staleKeys: string[]) {
    super(message);
    // 继承 InventoryCountInvariantError 是刻意的兜底：只按基类 catch 的调用方
    // 仍然降级成 { status: 'error', message }，不会漏成 500。
    this.name = 'InventoryCountStaleSnapshotError';
    this.staleKeys = staleKeys;
  }
}

function describeConflicts(conflicts: readonly SnapshotConflict[]): string {
  const shown = conflicts.slice(0, SNAPSHOT_CONFLICT_SAMPLE);
  const rest = conflicts.length - shown.length;
  const body = shown.map((c) => `${c.label} ${c.reason}`).join('；');
  return rest > 0 ? `${body}；另有 ${rest} 个库位同样有变动` : body;
}

function staleSnapshotError(
  conflicts: readonly SnapshotConflict[],
): InventoryCountStaleSnapshotError {
  return new InventoryCountStaleSnapshotError(
    `开始盘点后库存已变动，本次未过账，请重新盘点这些库位：${describeConflicts(conflicts)}`,
    conflicts.map((c) => c.key),
  );
}

function conflictLabel(
  material: { code: string; name: string } | undefined,
  location: { name: string; warehouse: { name: string } } | undefined,
  fallback: string,
): string {
  if (!material || !location) return fallback;
  return `${material.name}(${material.code}) ${location.warehouse.name}/${location.name}`;
}

function bookChangedReason(expected: Decimal, actual: Decimal): string {
  return `账面数已从 ${expected.toFixed(2)} 变为 ${actual.toFixed(2)}`;
}

type NormalizedCountItem = PostInventoryCountInput['items'][number] & {
  counted: Decimal;
  expectedBook: Decimal;
  key: string;
};

/**
 * 事务外预检：只为「一行都不剩」这一种情况服务。
 *
 * nextDailyDocumentNumber 走 db.$queryRaw 在事务**之外**先行提交，事务回滚也
 * 收不回来——不预检的话每次全量驳回都白烧一个当日盘点单号（IC 号一天有限）。
 * 这里读的是没加锁的快照，有 TOCTOU：读完到事务里加锁之间还能再变。所以只在
 * 「全部行都已确定失效」时提前失败，任何不确定（库存行还没建）一律放行，权威
 * 复检在事务内的 CAS。
 */
async function findAllStaleBeforeReservation(
  items: readonly NormalizedCountItem[],
): Promise<SnapshotConflict[]> {
  const stocks = await db.materialLocationStock.findMany({
    where: {
      OR: items.map(({ materialId, locationId }) => ({
        materialId,
        locationId,
      })),
    },
    select: { materialId: true, locationId: true, currentStock: true },
  });
  const stockByKey = new Map(
    stocks.map((stock) => [
      `${stock.materialId}:${stock.locationId}`,
      new Decimal(stock.currentStock),
    ]),
  );
  const stale = items.filter((item) => {
    const book = stockByKey.get(item.key);
    // 查不到 = 库存行还没建（事务里 INSERT ... ON CONFLICT DO NOTHING 会补成
    // 0）。预检对这种行不下结论。
    if (!book) return false;
    return !book.eq(item.expectedBook);
  });
  if (stale.length === 0 || stale.length !== items.length) return [];

  // 只有全量失效这条路才查名字：Material / WarehouseLocation 是字典表，
  // happy path 不为它们多跑一次查询。
  const [materials, locations] = await Promise.all([
    db.material.findMany({
      where: { id: { in: [...new Set(stale.map((item) => item.materialId))] } },
      select: { id: true, code: true, name: true },
    }),
    db.warehouseLocation.findMany({
      where: { id: { in: [...new Set(stale.map((item) => item.locationId))] } },
      select: { id: true, name: true, warehouse: { select: { name: true } } },
    }),
  ]);
  const materialById = new Map(materials.map((row) => [row.id, row]));
  const locationById = new Map(locations.map((row) => [row.id, row]));
  return stale.map((item) => ({
    key: item.key,
    label: conflictLabel(
      materialById.get(item.materialId),
      locationById.get(item.locationId),
      item.key,
    ),
    reason: bookChangedReason(
      item.expectedBook,
      stockByKey.get(item.key) ?? new Decimal(0),
    ),
  }));
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

export type InventoryCountPostResult = {
  count: InventoryCountSummary;
  /**
   * 账面数已变动、被剔除**未过账**的行（`${materialId}:${locationId}`）。
   * 一行冲突不再整单驳回：99 行合格数据陪葬会让忙碌库位永远盘不完。
   */
  staleKeys: string[];
  /** 冲突行的可读说明，拼进给操作员看的提示 */
  staleMessage: string | null;
};

const INVENTORY_COUNT_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 30_000,
} as const;

export async function postInventoryCount(
  input: PostInventoryCountInput,
  actor: { id: string },
  now: Date = new Date(),
): Promise<InventoryCountPostResult> {
  const uniqueKeys = new Set<string>();
  const items: NormalizedCountItem[] = input.items
    .map((item) => ({
      ...item,
      counted: new Decimal(item.countedQuantity),
      // 页面显示给操作员看的账面数，CAS 守卫的比对基准
      expectedBook: new Decimal(item.bookQuantity),
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
    if (!item.expectedBook.isFinite() || item.expectedBook.lt(0)) {
      throw new InventoryCountInvariantError(
        '账面数快照非法，请刷新页面后重新盘点',
      );
    }
  }

  const existingBeforeReservation = await db.inventoryCount.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existingBeforeReservation) {
    return {
      count: await readInventoryCount(existingBeforeReservation.id),
      staleKeys: [],
      staleMessage: null,
    };
  }

  // ★ 顺序铁律：CAS 守卫必须排在上面这个幂等早返回、以及事务内 advisory lock
  //   之后的第二个早返回之后。否则会自噬——第一次过账把余额改成了实盘数，
  //   重放同一个 idempotencyKey 时回传的账面数当然对不上了。走到这里说明这是
  //   一次全新的提交。
  const staleBeforeReservation = await findAllStaleBeforeReservation(items);
  if (staleBeforeReservation.length > 0) {
    throw staleSnapshotError(staleBeforeReservation);
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

  const posted = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:inventory-count-request:${input.idempotencyKey}`}))`;
      const existing = await tx.inventoryCount.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, conflicts: [] as SnapshotConflict[] };

      // code/name 是给冲突提示用的（「白卡纸(M-001) 默认仓库/A货架 账面数已从
      // 5.00 变为 8.00」）。搭在这条已有的 FOR UPDATE 上，happy path 零新增查询。
      const lockedMaterials = await tx.$queryRaw<
        { id: string; code: string; name: string; isActive: boolean }[]
      >(Prisma.sql`
        SELECT id, code, name, "isActive"
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
          // name / warehouse.name 同上：冲突提示要指名道姓
          name: true,
          isActive: true,
          warehouse: { select: { name: true, isActive: true } },
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

      // ── 账面回声（CAS）─────────────────────────────────────────────
      // 位置很重要：跑在 MaterialLocationStock 的 FOR UPDATE 之后。持锁意味着
      // 这些 (物料,库位) 已经静止——唯一的库存写入口
      // lib/material.ts:applyMaterialStockMovement 也是先锁 Material 再锁
      // MaterialLocationStock，锁序一致不会死锁——所以比对结果是稳定的。
      // 冲突行**剔除后继续过账余下的**（部分过账）：一行冲突整单驳回会让忙碌
      // 库位永远盘不完，99 行合格数据陪葬且没有 override。
      const conflicts: SnapshotConflict[] = [];
      const acceptedItems = items.filter((item) => {
        const book = new Decimal(stockByKey.get(item.key)!.currentStock);
        if (book.eq(item.expectedBook)) return true;
        conflicts.push({
          key: item.key,
          label: conflictLabel(
            materialById.get(item.materialId),
            locationById.get(item.locationId),
            item.key,
          ),
          reason: bookChangedReason(item.expectedBook, book),
        });
        return false;
      });
      if (acceptedItems.length === 0) {
        // 一条都没剩：这张单没有意义，整体回滚（连同刚建的 InventoryCount 行）。
        throw staleSnapshotError(conflicts);
      }

      const countRows = acceptedItems.map((item) => {
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

      return { id: inventoryCount.id, conflicts };
    },
    INVENTORY_COUNT_TRANSACTION_OPTIONS,
  );

  return {
    count: await readInventoryCount(posted.id),
    staleKeys: posted.conflicts.map((conflict) => conflict.key),
    staleMessage:
      posted.conflicts.length > 0 ? describeConflicts(posted.conflicts) : null,
  };
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
