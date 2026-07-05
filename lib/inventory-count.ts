import { MaterialCategory } from '../generated/prisma/client';
import { db } from './db';

export type InventoryCountLocationRow = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  locationCode: string;
  locationName: string;
  currentStock: string;
};

export type InventoryCountMaterialRow = {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  specification: string | null;
  unit: string;
  currentStock: string;
  safetyStock: string | null;
  isActive: boolean;
  locations: InventoryCountLocationRow[];
};

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function inventoryCountSearchFilter(q?: string | null) {
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

export async function listInventoryCountMaterials(
  opts: { q?: string | null; limit?: number } = {},
): Promise<InventoryCountMaterialRow[]> {
  const query = normalizeSearchQuery(opts.q);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await db.material.findMany({
    where: inventoryCountSearchFilter(query),
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      specification: true,
      unit: true,
      currentStock: true,
      safetyStock: true,
      isActive: true,
      locationStocks: {
        select: {
          id: true,
          currentStock: true,
          warehouse: {
            select: {
              code: true,
              name: true,
              isDefault: true,
            },
          },
          location: {
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
          { location: { isDefault: 'desc' } },
          { location: { code: 'asc' } },
        ],
      },
    },
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    specification: row.specification,
    unit: row.unit,
    currentStock: String(row.currentStock),
    safetyStock: row.safetyStock === null ? null : String(row.safetyStock),
    isActive: row.isActive,
    locations: row.locationStocks.map((stock) => ({
      id: stock.id,
      warehouseCode: stock.warehouse.code,
      warehouseName: stock.warehouse.name,
      locationCode: stock.location.code,
      locationName: stock.location.name,
      currentStock: String(stock.currentStock),
    })),
  }));
}
