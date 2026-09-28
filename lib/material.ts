import { acquireWarehouseStockLock } from '@/lib/warehouse-coordination';
import { isRetiredPaper } from '@/lib/rules/paper-availability';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  MaterialCategory,
  Prisma,
  TxDirection,
  type Material,
  type MaterialLocationStock,
  type MaterialTransaction,
} from '../generated/prisma/client';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
  type SortDirection,
} from './admin/table';
import { db } from './db';
import { resolveBusinessCode } from './business-code';
import { dispatchNotification } from './notification/dispatch';
import { enqueueNotificationInTransaction } from './notification/transactional-outbox';
import type { EnqueueClient } from './background-jobs/repository';
import { sortBySearchRelevance } from './search-ranking';
import { parseCatalogPaperWeight } from './order/catalog-pricing-facts';
import { acquirePriceRuleSnapshotWriteLock } from './price/rule-snapshot-lock';
import { materialStockAlertForCrossing } from './material-stock-alert';
import { paperIdentityMutationError } from './material-paper-identity';

export { MATERIAL_CATEGORY_LABELS } from './material-labels';

export class MaterialInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialInvariantError';
  }
}

export class MaterialUnitChangeError extends MaterialInvariantError {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialUnitChangeError';
  }
}

export type MaterialSummary = Pick<
  Material,
  | 'id'
  | 'code'
  | 'name'
  | 'category'
  | 'specification'
  | 'unit'
  | 'searchPinyin'
  | 'searchPinyinInitials'
  | 'currentStock'
  | 'safetyStock'
  | 'averageCost'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

/** 新建工单纸张选择器的稳定、最小返回结构。 */
export type PaperOrderOption = Pick<
  Material,
  'id' | 'code' | 'name' | 'specification' | 'unit'
>;

/**
 * 外部销售建单使用的纸张事实。`weight` 只从纸张配置解析；无法解析时
 * 保持 null，让上层转人工核价，绝不猜测默认克重。
 */
export type ExternalCreateOrderPaperOption = Pick<
  Material,
  | 'id'
  | 'code'
  | 'name'
  | 'specification'
  | 'unit'
  | 'outOfStock'
  | 'sortOrder'
> & {
  weight: number | null;
};

/** 外部销售建单的烫金色配置；色板和值均由 FOIL 物料提供。 */
export type ExternalCreateOrderFoilOption = Pick<
  Material,
  'id' | 'code' | 'name' | 'displayColor' | 'displayImage' | 'sortOrder'
>;

export type CreateOrderMaterialReadClient = Pick<
  Prisma.TransactionClient,
  'material'
>;

export type MaterialTransactionSummary = Pick<
  MaterialTransaction,
  | 'id'
  | 'materialId'
  | 'warehouseId'
  | 'locationId'
  | 'direction'
  | 'quantity'
  | 'reasonType'
  | 'purchaseReceiptItemId'
  | 'unitCost'
  | 'remark'
  | 'operatorId'
  | 'occurredAt'
  | 'createdAt'
>;

export type MaterialLocationStockSummary = Pick<
  MaterialLocationStock,
  'id' | 'materialId' | 'warehouseId' | 'locationId' | 'currentStock'
> & {
  warehouse: { code: string; name: string };
  location: { code: string; name: string };
};

export const MATERIAL_LIST_SORT_KEYS = [
  'default',
  'code',
  'name',
  'category',
  'currentStock',
  'updatedAt',
] as const;

export type MaterialListSortKey = (typeof MATERIAL_LIST_SORT_KEYS)[number];

const MATERIAL_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  specification: true,
  unit: true,
  searchPinyin: true,
  searchPinyinInitials: true,
  currentStock: true,
  safetyStock: true,
  averageCost: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function materialSearchFilter(
  q?: string | null,
  category?: MaterialCategory,
  excludeCategory?: MaterialCategory,
): Prisma.MaterialWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  const categoryFilter: Prisma.MaterialWhereInput = category
    ? { category }
    : excludeCategory
      ? { category: { not: excludeCategory } }
      : {};
  if (!query) {
    return category || excludeCategory ? categoryFilter : undefined;
  }
  return {
    ...categoryFilter,
    OR: [
      { code: { contains: query, mode: 'insensitive' as const } },
      { name: { contains: query, mode: 'insensitive' as const } },
      { specification: { contains: query, mode: 'insensitive' as const } },
      { unit: { contains: query, mode: 'insensitive' as const } },
      { searchPinyin: { contains: query, mode: 'insensitive' as const } },
      { searchPinyinInitials: { contains: query, mode: 'insensitive' as const } },
    ],
  };
}

export async function listMaterials(
  opts: { q?: string | null; category?: MaterialCategory } = {},
): Promise<MaterialSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const rows = await db.material.findMany({
    where: materialSearchFilter(query, opts.category),
    select: MATERIAL_SELECT,
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [row.code, row.name, row.specification, row.unit],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));
}

function materialListOrderBy(
  sort: MaterialListSortKey,
  direction: SortDirection,
): Prisma.MaterialOrderByWithRelationInput[] {
  switch (sort) {
    case 'code':
      return [{ code: direction }, { id: 'asc' }];
    case 'name':
      return [{ name: direction }, { id: 'asc' }];
    case 'category':
      return [{ category: direction }, { name: 'asc' }, { id: 'asc' }];
    case 'currentStock':
      return [{ currentStock: direction }, { id: 'asc' }];
    case 'updatedAt':
      return [{ updatedAt: direction }, { id: 'asc' }];
    default:
      return [
        { isActive: 'desc' },
        { category: 'asc' },
        { name: 'asc' },
        { id: 'asc' },
      ];
  }
}

export async function listMaterialsPage(opts: {
  q?: string | null;
  category?: MaterialCategory;
  excludeCategory?: MaterialCategory;
  page: number;
  pageSize: number;
  sort: MaterialListSortKey;
  direction: SortDirection;
}): Promise<PaginatedResult<MaterialSummary>> {
  const where = materialSearchFilter(
    opts.q,
    opts.category,
    opts.excludeCategory,
  );
  const total = await db.material.count({ where });
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.material.findMany({
    where,
    select: MATERIAL_SELECT,
    orderBy: materialListOrderBy(opts.sort, opts.direction),
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows, total, window);
}

export async function listActivePaperOrderOptions(): Promise<
  PaperOrderOption[]
> {
  const rows = await db.material.findMany({
    where: { category: MaterialCategory.PAPER, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      specification: true,
      unit: true,
    },
    orderBy: [{ name: 'asc' }, { specification: 'asc' }, { id: 'asc' }],
  });
  return rows.filter((row) => !isRetiredPaper(row));
}

function configuredPaperWeight(row: {
  name: string;
  specification: string | null;
}): number | null {
  const parsed =
    parseCatalogPaperWeight(row.specification) ??
    parseCatalogPaperWeight(row.name);
  return parsed !== null && parsed <= 2_000 ? parsed : null;
}

export async function listExternalCreateOrderPaperOptions(
  client: CreateOrderMaterialReadClient = db,
): Promise<ExternalCreateOrderPaperOption[]> {
  const rows = await client.material.findMany({
    where: { category: MaterialCategory.PAPER, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      specification: true,
      unit: true,
      outOfStock: true,
      sortOrder: true,
    },
    orderBy: [
      { sortOrder: 'asc' },
      { name: 'asc' },
      { specification: 'asc' },
      { id: 'asc' },
    ],
  });

  return rows.filter((row) => !isRetiredPaper(row)).map((row) => ({
    ...row,
    weight: configuredPaperWeight(row),
  }));
}

export async function listExternalCreateOrderFoilOptions(
  client: CreateOrderMaterialReadClient = db,
): Promise<ExternalCreateOrderFoilOption[]> {
  return client.material.findMany({
    where: { category: MaterialCategory.FOIL, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      displayColor: true,
      displayImage: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}

export async function getMaterialSummary(
  id: string,
): Promise<MaterialSummary | null> {
  return db.material.findUnique({ where: { id }, select: MATERIAL_SELECT });
}

export async function listMaterialLocationStocks(
  materialId: string,
): Promise<MaterialLocationStockSummary[]> {
  return db.materialLocationStock.findMany({
    where: { materialId },
    select: {
      id: true,
      materialId: true,
      warehouseId: true,
      locationId: true,
      currentStock: true,
      warehouse: { select: { code: true, name: true } },
      location: { select: { code: true, name: true } },
    },
    orderBy: [
      { warehouse: { isDefault: 'desc' } },
      { warehouse: { code: 'asc' } },
      { location: { isDefault: 'desc' } },
      { location: { code: 'asc' } },
    ],
  });
}

export type CreateMaterialData = {
  code: string | null;
  name: string;
  category: MaterialCategory;
  specification: string | null;
  unit: string;
  safetyStock: string | null;
  averageCost: string | null;
};

export type UpdateMaterialData = Omit<CreateMaterialData, 'code'> & {
  code: string;
};

export const MATERIAL_UNIT_IMMUTABLE_MESSAGE =
  '计量单位决定库存与业务数量的含义，物料创建后不能修改；如需使用新单位，请新建物料。';

export async function createMaterial(
  data: CreateMaterialData,
): Promise<MaterialSummary> {
  const code = await resolveBusinessCode('MATERIAL', data.code);
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const identityError = await paperIdentityMutationError(tx, data);
    if (identityError) throw new MaterialInvariantError(identityError);
    return tx.material.create({
      data: {
        code,
        name: data.name,
        category: data.category,
        specification: data.specification,
        unit: data.unit,
        safetyStock: data.safetyStock,
        averageCost: data.averageCost,
        isActive: true,
      },
      select: MATERIAL_SELECT,
    });
  });
}

export async function updateMaterial(
  id: string,
  data: UpdateMaterialData,
): Promise<MaterialSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.material.findUnique({
      where: { id },
      select: MATERIAL_SELECT,
    });
    if (!target) throw new MaterialInvariantError('目标物料不存在');
    if (target.unit !== data.unit) {
      throw new MaterialUnitChangeError(MATERIAL_UNIT_IMMUTABLE_MESSAGE);
    }

    if (
      target.category === MaterialCategory.PAPER &&
      (target.name !== data.name ||
        target.specification !== data.specification ||
        target.category !== data.category) &&
      (await tx.product.count({ where: { paperMaterialId: id } })) > 0
    ) {
      throw new MaterialInvariantError(
        '纸张已用于历史产品，名称、克重或分类不可直接修改；请新增纸张并配置价格',
      );
    }

    const identityError = await paperIdentityMutationError(tx, data, target);
    if (identityError) throw new MaterialInvariantError(identityError);

    return tx.material.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        category: data.category,
        specification: data.specification,
        // Unit is an identity-level quantity contract, not editable metadata.
        // It is deliberately omitted even after the equality check above, so a
        // basic-details update can never write it back or race a quantity fact.
        safetyStock: data.safetyStock,
        averageCost: data.averageCost,
      },
      select: MATERIAL_SELECT,
    });
  });
}

export async function setMaterialActive(
  id: string,
  isActive: boolean,
): Promise<MaterialSummary> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotWriteLock(tx);
    const target = await tx.material.findUnique({
      where: { id },
      select: MATERIAL_SELECT,
    });
    if (!target) throw new MaterialInvariantError('目标物料不存在');
    if (isActive && target.category === MaterialCategory.PAPER && isRetiredPaper(target)) {
      throw new MaterialInvariantError('120g 纸张已停用，请选择其他克重');
    }
    if (target.isActive === isActive) return target;

    return tx.material.update({
      where: { id },
      data: { isActive },
      select: MATERIAL_SELECT,
    });
  });
}

export type CreateMaterialTransactionData = {
  idempotencyKey?: string;
  requestFingerprint?: string;
  materialId: string;
  locationId?: string | null;
  direction: TxDirection;
  quantity: string;
  reasonType: string;
  purchaseReceiptItemId?: string | null;
  stockTransferId?: string | null;
  inventoryCountItemId?: string | null;
  unitCost: string | null;
  remark: string | null;
  operatorId: string;
};

// STOCK_ALERT（SPEC §8.1）payload。跨越检测：仅当本次变动把库存从
// >=安全库存 带到 <安全库存 时才携带——持续低位的后续出库不重复告警，
// 库存回补后再次跌破会重新触发。推送必须由事务外的调用方 dispatch
// （applyMaterialStockMovement 跑在 tx 内，tx 回滚时不能已发消息）。
export type MaterialStockAlert = {
  materialName: string;
  currentStock: string; // toFixed(2)，保尾零与库存 UI / Decimal(12,2) 一致
  safetyStock: string;
};

export type MaterialStockMovementResult = {
  material: MaterialSummary;
  transaction: MaterialTransactionSummary;
  stockAlert: MaterialStockAlert | null;
};

type StockTxClient = {
  $queryRaw: <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>;
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  warehouseLocation: {
    findUnique: (args: unknown) => Promise<{
      id: string;
      warehouseId: string;
      isActive: boolean;
      warehouse: { id: string; isActive: boolean };
    } | null>;
    findFirst: (args: unknown) => Promise<{
      id: string;
      warehouseId: string;
      isActive: boolean;
      warehouse: { id: string; isActive: boolean };
    } | null>;
  };
  material: {
    update: (args: unknown) => Promise<MaterialSummary>;
  };
  materialLocationStock: {
    update: (args: unknown) => Promise<unknown>;
  };
  materialTransaction: {
    create: (args: unknown) => Promise<MaterialTransactionSummary>;
  };
};

type ResolvedStockLocation = {
  warehouseId: string;
  locationId: string;
};

async function resolveStockLocation(
  tx: StockTxClient,
  locationId?: string | null,
): Promise<ResolvedStockLocation> {
  const select = {
    id: true,
    warehouseId: true,
    isActive: true,
    warehouse: { select: { id: true, isActive: true } },
  };
  const location = locationId
    ? await tx.warehouseLocation.findUnique({
        where: { id: locationId },
        select,
      })
    : await tx.warehouseLocation.findFirst({
        where: {
          isActive: true,
          isDefault: true,
          warehouse: { isActive: true, isDefault: true },
        },
        select,
        orderBy: { createdAt: 'asc' },
      });

  if (!location) {
    throw new MaterialInvariantError(
      locationId ? '库位不存在' : '默认仓库库位不存在',
    );
  }
  if (!location.isActive || !location.warehouse.isActive) {
    throw new MaterialInvariantError('库位或所属仓库已停用');
  }
  return { warehouseId: location.warehouseId, locationId: location.id };
}

export async function applyMaterialStockMovement(
  tx: unknown,
  data: CreateMaterialTransactionData,
): Promise<MaterialStockMovementResult> {
  const txClient = tx as StockTxClient;
  const quantity = new Decimal(data.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new MaterialInvariantError('出入库数量必须大于 0');
  }

  const location = await resolveStockLocation(txClient, data.locationId);

  const locked = await txClient.$queryRaw<
    { id: string; currentStock: Decimal.Value }[]
  >`SELECT id, "currentStock" AS "currentStock" FROM "Material" WHERE id = ${data.materialId} FOR UPDATE`;

  if (locked.length === 0) {
    throw new MaterialInvariantError('目标物料不存在');
  }

  await txClient.$executeRaw`
    INSERT INTO "MaterialLocationStock" (
      id, "materialId", "warehouseId", "locationId", "currentStock", "createdAt", "updatedAt"
    ) VALUES (
      'mls_' || md5(${data.materialId} || ':' || ${location.locationId}),
      ${data.materialId},
      ${location.warehouseId},
      ${location.locationId},
      0,
      NOW(),
      NOW()
    )
    ON CONFLICT ("materialId", "locationId") DO NOTHING
  `;

  const lockedLocation = await txClient.$queryRaw<
    { id: string; currentStock: Decimal.Value }[]
  >`SELECT id, "currentStock" AS "currentStock"
      FROM "MaterialLocationStock"
     WHERE "materialId" = ${data.materialId}
       AND "locationId" = ${location.locationId}
     FOR UPDATE`;

  if (lockedLocation.length === 0) {
    throw new MaterialInvariantError('物料库位库存初始化失败');
  }

  const current = new Decimal(locked[0]!.currentStock);
  const locationCurrent = new Decimal(lockedLocation[0]!.currentStock);
  const next =
    data.direction === TxDirection.IN
      ? current.plus(quantity)
      : current.minus(quantity);
  const nextLocation =
    data.direction === TxDirection.IN
      ? locationCurrent.plus(quantity)
      : locationCurrent.minus(quantity);

  if (next.lt(0) || nextLocation.lt(0)) {
    throw new MaterialInvariantError('库存不足，不能出库到负数');
  }

  // Location stock is authoritative. Its database trigger synchronizes the
  // Material.currentStock summary before the guarded summary update below.
  // Keeping these writes sequential prevents the summary guard from observing
  // the old location balance under real PostgreSQL scheduling.
  await txClient.materialLocationStock.update({
    where: { id: lockedLocation[0]!.id },
    data: { currentStock: nextLocation.toFixed(2) },
    select: { id: true },
  });

  const [material, transaction] = await Promise.all([
    txClient.material.update({
      where: { id: data.materialId },
      data: { currentStock: next.toFixed(2) },
      select: MATERIAL_SELECT,
    }),
    txClient.materialTransaction.create({
      data: {
        idempotencyKey: data.idempotencyKey,
        requestFingerprint: data.requestFingerprint,
        materialId: data.materialId,
        warehouseId: location.warehouseId,
        locationId: location.locationId,
        direction: data.direction,
        quantity: quantity.toFixed(2),
        reasonType: data.reasonType,
        purchaseReceiptItemId: data.purchaseReceiptItemId,
        stockTransferId: data.stockTransferId,
        inventoryCountItemId: data.inventoryCountItemId,
        unitCost: data.unitCost,
        remark: data.remark,
        operatorId: data.operatorId,
      },
      select: {
        id: true,
        materialId: true,
        warehouseId: true,
        locationId: true,
        direction: true,
        quantity: true,
        reasonType: true,
        purchaseReceiptItemId: true,
        unitCost: true,
        remark: true,
        operatorId: true,
        occurredAt: true,
        createdAt: true,
      },
    }),
  ]);

  const stockAlert = materialStockAlertForCrossing({
    materialName: material.name,
    before: current,
    after: next,
    safetyStock: material.safetyStock,
  });

  return { material, transaction, stockAlert };
}

function manualMaterialRequestFingerprint(data: CreateMaterialTransactionData): string {
  return createHash('sha256').update(JSON.stringify({
    materialId: data.materialId,
    locationId: data.locationId ?? null,
    direction: data.direction,
    quantity: new Decimal(data.quantity).toFixed(2),
    reasonType: data.reasonType,
    unitCost: data.unitCost == null ? null : new Decimal(data.unitCost).toFixed(4),
    remark: data.remark,
    operatorId: data.operatorId,
    purchaseReceiptItemId: data.purchaseReceiptItemId ?? null,
    stockTransferId: data.stockTransferId ?? null,
    inventoryCountItemId: data.inventoryCountItemId ?? null,
  })).digest('hex');
}

export async function createMaterialTransaction(
  data: CreateMaterialTransactionData & { idempotencyKey: string },
): Promise<MaterialStockMovementResult> {
  const idempotencyKey = data.idempotencyKey?.trim();
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new MaterialInvariantError('出入库请求无效，请刷新页面后重试');
  }
  const requestFingerprint = manualMaterialRequestFingerprint(data);
  let notificationQueued = false;
  const result = await db.$transaction(async (tx) => {
    await acquireWarehouseStockLock(tx);
    // Lock the request before the material, so concurrent delivery of one
    // command can only observe and return the first committed ledger entry.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:manual-stock:${idempotencyKey}`}))`;
    const existing = await tx.materialTransaction.findUnique({
      where: { idempotencyKey },
      include: { material: { select: MATERIAL_SELECT } },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new MaterialInvariantError('出入库请求与原记录不一致，请刷新页面后重新核对');
      }
      return { material: existing.material, transaction: existing, stockAlert: null };
    }
    const movement = await applyMaterialStockMovement(tx, { ...data, idempotencyKey, requestFingerprint });
    if (movement.stockAlert) {
      notificationQueued = await enqueueNotificationInTransaction(
        tx as unknown as EnqueueClient,
        'STOCK_ALERT',
        movement.stockAlert,
        {
          dedupeKey: `notification:STOCK_ALERT:${movement.transaction.id}`,
        },
      );
    }
    return movement;
  });
  if (result.stockAlert && !notificationQueued) {
    await dispatchNotification('STOCK_ALERT', result.stockAlert, {
      dedupeKey: `notification:STOCK_ALERT:${result.transaction.id}`,
    });
  }
  return result;
}
