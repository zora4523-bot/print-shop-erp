import Decimal from 'decimal.js';
import {
  MaterialCategory,
  TxDirection,
  type Material,
  type MaterialLocationStock,
  type MaterialTransaction,
} from '../generated/prisma/client';
import {
  paginateItems,
  type PaginatedResult,
  type SortDirection,
} from './admin/table';
import { db } from './db';
import { MATERIAL_CATEGORY_LABELS } from './material-labels';
import { dispatchNotification } from './notification/dispatch';
import { sortBySearchRelevance } from './search-ranking';

export { MATERIAL_CATEGORY_LABELS } from './material-labels';

export class MaterialInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialInvariantError';
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

function materialSearchFilter(q?: string | null) {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
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
  opts: { q?: string | null } = {},
): Promise<MaterialSummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const rows = await db.material.findMany({
    where: materialSearchFilter(query),
    select: MATERIAL_SELECT,
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [row.code, row.name, row.specification, row.unit],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '', 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareDecimalLike(a: unknown, b: unknown): number {
  return new Decimal(String(a ?? 0)).cmp(new Decimal(String(b ?? 0)));
}

function compareDate(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

function sortMaterialsForList(
  rows: readonly MaterialSummary[],
  sort: MaterialListSortKey,
  direction: SortDirection,
): MaterialSummary[] {
  if (sort === 'default') return [...rows];

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'code':
        return compareText(a.code, b.code);
      case 'name':
        return compareText(a.name, b.name);
      case 'category':
        return compareText(MATERIAL_CATEGORY_LABELS[a.category], MATERIAL_CATEGORY_LABELS[b.category]);
      case 'currentStock':
        return compareDecimalLike(a.currentStock, b.currentStock);
      case 'updatedAt':
        return compareDate(a.updatedAt, b.updatedAt);
      default:
        return 0;
    }
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export async function listMaterialsPage(opts: {
  q?: string | null;
  page: number;
  pageSize: number;
  sort: MaterialListSortKey;
  direction: SortDirection;
}): Promise<PaginatedResult<MaterialSummary>> {
  const rows = await listMaterials({ q: opts.q });
  const sorted = sortMaterialsForList(rows, opts.sort, opts.direction);
  return paginateItems(sorted, opts.page, opts.pageSize);
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
  code: string;
  name: string;
  category: MaterialCategory;
  specification: string | null;
  unit: string;
  safetyStock: string | null;
  averageCost: string | null;
};

export type UpdateMaterialData = CreateMaterialData;

export async function createMaterial(
  data: CreateMaterialData,
): Promise<MaterialSummary> {
  return db.material.create({
    data: {
      code: data.code,
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
}

export async function updateMaterial(
  id: string,
  data: UpdateMaterialData,
): Promise<MaterialSummary> {
  const target = await getMaterialSummary(id);
  if (!target) throw new MaterialInvariantError('目标物料不存在');

  return db.material.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      category: data.category,
      specification: data.specification,
      unit: data.unit,
      safetyStock: data.safetyStock,
      averageCost: data.averageCost,
    },
    select: MATERIAL_SELECT,
  });
}

export async function setMaterialActive(
  id: string,
  isActive: boolean,
): Promise<MaterialSummary> {
  const target = await getMaterialSummary(id);
  if (!target) throw new MaterialInvariantError('目标物料不存在');
  if (target.isActive === isActive) return target;

  return db.material.update({
    where: { id },
    data: { isActive },
    select: MATERIAL_SELECT,
  });
}

export type CreateMaterialTransactionData = {
  materialId: string;
  locationId?: string | null;
  direction: TxDirection;
  quantity: string;
  reasonType: string;
  purchaseReceiptItemId?: string | null;
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

  const [material, , transaction] = await Promise.all([
    txClient.material.update({
      where: { id: data.materialId },
      data: { currentStock: next.toFixed(2) },
      select: MATERIAL_SELECT,
    }),
    txClient.materialLocationStock.update({
      where: { id: lockedLocation[0]!.id },
      data: { currentStock: nextLocation.toFixed(2) },
      select: { id: true },
    }),
    txClient.materialTransaction.create({
      data: {
        materialId: data.materialId,
        warehouseId: location.warehouseId,
        locationId: location.locationId,
        direction: data.direction,
        quantity: quantity.toFixed(2),
        reasonType: data.reasonType,
        purchaseReceiptItemId: data.purchaseReceiptItemId,
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

  const safety =
    material.safetyStock == null ? null : new Decimal(material.safetyStock);
  const stockAlert =
    safety && current.gte(safety) && next.lt(safety)
      ? {
          materialName: material.name,
          currentStock: next.toFixed(2),
          safetyStock: safety.toFixed(2),
        }
      : null;

  return { material, transaction, stockAlert };
}

export async function createMaterialTransaction(
  data: CreateMaterialTransactionData,
): Promise<MaterialStockMovementResult> {
  const result = await db.$transaction(async (tx) => {
    return applyMaterialStockMovement(tx, data);
  });
  if (result.stockAlert) {
    await dispatchNotification('STOCK_ALERT', result.stockAlert);
  }
  return result;
}
