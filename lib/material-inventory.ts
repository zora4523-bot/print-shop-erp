import Decimal from 'decimal.js';
import {
  Prisma,
  type MaterialCategory,
} from '../generated/prisma/client';
import { db } from './db';
import { todayShanghai } from './dashboard/shanghai-clock';
import { sortBySearchRelevance } from './search-ranking';

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  specification: string | null;
  unit: string;
  searchPinyin: string | null;
  searchPinyinInitials: string | null;
  currentStock: unknown;
  safetyStock: unknown | null;
  averageCost: unknown | null;
  isActive: boolean;
};

type MovementSummaryRow = {
  materialId: string;
  transactionCount: number | bigint;
  totalIn: unknown;
  totalOut: unknown;
  netQuantity: unknown;
};

type DailyMovementSummaryRow = MovementSummaryRow & {
  shanghaiDate: Date | string;
};

export type MaterialInventoryRow = {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  specification: string | null;
  unit: string;
  searchPinyin: string | null;
  searchPinyinInitials: string | null;
  isActive: boolean;
  currentStock: string;
  safetyStock: string | null;
  averageCost: string | null;
  stockValue: string | null;
  isBelowSafetyStock: boolean;
  transactionCount: number;
  totalIn: string;
  totalOut: string;
  netQuantity: string;
  todayTransactionCount: number;
  todayIn: string;
  todayOut: string;
  todayNetQuantity: string;
};

export type MaterialInventoryDashboard = {
  date: string;
  rows: MaterialInventoryRow[];
  lowStockRows: MaterialInventoryRow[];
  totals: {
    materialCount: number;
    activeMaterialCount: number;
    lowStockCount: number;
    stockValue: string;
    todayIn: string;
    todayOut: string;
  };
};

function decimal(v: unknown): Decimal {
  return new Decimal((v ?? 0) as Decimal.Value);
}

function fixed(v: unknown, digits = 2): string {
  return decimal(v).toFixed(digits);
}

function count(v: number | bigint | undefined): number {
  if (v == null) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

function byMaterialId<T extends { materialId: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.materialId, row]));
}

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function materialSearchFilter(q?: string | null): Prisma.MaterialWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [
      { code: { contains: query, mode: 'insensitive' } },
      { name: { contains: query, mode: 'insensitive' } },
      { specification: { contains: query, mode: 'insensitive' } },
      { unit: { contains: query, mode: 'insensitive' } },
      { searchPinyin: { contains: query, mode: 'insensitive' } },
      { searchPinyinInitials: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export async function getMaterialInventoryDashboard(
  now: Date = new Date(),
  opts: { q?: string | null } = {},
): Promise<MaterialInventoryDashboard> {
  const date = todayShanghai(now);
  const where = materialSearchFilter(opts.q);
  const [materials, movementRows, todayRows] = await Promise.all([
    db.material.findMany({
      where,
      select: {
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
      },
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    }) as Promise<MaterialRow[]>,
    db.$queryRaw<MovementSummaryRow[]>`
      SELECT
        material_id AS "materialId",
        transaction_count AS "transactionCount",
        total_in AS "totalIn",
        total_out AS "totalOut",
        net_quantity AS "netQuantity"
      FROM material_inventory_movement_summary
    `,
    db.$queryRaw<DailyMovementSummaryRow[]>`
      SELECT
        material_id AS "materialId",
        shanghai_date AS "shanghaiDate",
        transaction_count AS "transactionCount",
        total_in AS "totalIn",
        total_out AS "totalOut",
        net_quantity AS "netQuantity"
      FROM material_inventory_daily_summary
      WHERE shanghai_date = ${date}::date
    `,
  ]);

  const movementByMaterial = byMaterialId(movementRows);
  const todayByMaterial = byMaterialId(todayRows);
  let stockValueTotal = new Decimal(0);
  let todayInTotal = new Decimal(0);
  let todayOutTotal = new Decimal(0);

  const rows = materials.map((material) => {
    const movement = movementByMaterial.get(material.id);
    const today = todayByMaterial.get(material.id);
    const currentStock = decimal(material.currentStock);
    const safetyStock =
      material.safetyStock == null ? null : decimal(material.safetyStock);
    const averageCost =
      material.averageCost == null ? null : decimal(material.averageCost);
    const stockValue = averageCost == null ? null : currentStock.times(averageCost);
    const todayIn = decimal(today?.totalIn);
    const todayOut = decimal(today?.totalOut);

    if (stockValue) stockValueTotal = stockValueTotal.plus(stockValue);
    todayInTotal = todayInTotal.plus(todayIn);
    todayOutTotal = todayOutTotal.plus(todayOut);

    return {
      id: material.id,
      code: material.code,
      name: material.name,
      category: material.category,
      specification: material.specification,
      unit: material.unit,
      searchPinyin: material.searchPinyin,
      searchPinyinInitials: material.searchPinyinInitials,
      isActive: material.isActive,
      currentStock: currentStock.toFixed(2),
      safetyStock: safetyStock?.toFixed(2) ?? null,
      averageCost: averageCost?.toFixed(4) ?? null,
      stockValue: stockValue?.toFixed(2) ?? null,
      isBelowSafetyStock: safetyStock != null && currentStock.lte(safetyStock),
      transactionCount: count(movement?.transactionCount),
      totalIn: fixed(movement?.totalIn),
      totalOut: fixed(movement?.totalOut),
      netQuantity: fixed(movement?.netQuantity),
      todayTransactionCount: count(today?.transactionCount),
      todayIn: todayIn.toFixed(2),
      todayOut: todayOut.toFixed(2),
      todayNetQuantity: fixed(today?.netQuantity),
    };
  });
  const rankedRows = sortBySearchRelevance(rows, where ? opts.q : null, (row) => ({
    fields: [row.code, row.name, row.specification, row.unit],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));

  const lowStockRows = rankedRows.filter((row) => row.isBelowSafetyStock);

  return {
    date,
    rows: rankedRows,
    lowStockRows,
    totals: {
      materialCount: rankedRows.length,
      activeMaterialCount: rankedRows.filter((row) => row.isActive).length,
      lowStockCount: lowStockRows.length,
      stockValue: stockValueTotal.toFixed(2),
      todayIn: todayInTotal.toFixed(2),
      todayOut: todayOutTotal.toFixed(2),
    },
  };
}
