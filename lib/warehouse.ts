import {
  Prisma,
  type WarehouseLocation,
} from '../generated/prisma/client';
import { db } from './db';
import type {
  CreateWarehouseInput,
  CreateWarehouseLocationInput,
} from './auth/schemas';

export class WarehouseInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarehouseInvariantError';
  }
}

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

export async function createWarehouse(
  data: CreateWarehouseInput,
): Promise<WarehouseSummary> {
  return db.warehouse.create({
    data: {
      code: data.code,
      name: data.name,
      isDefault: false,
      isActive: true,
    },
    select: WAREHOUSE_SELECT,
  });
}

export async function createWarehouseLocation(
  data: CreateWarehouseLocationInput,
): Promise<WarehouseLocationSummary> {
  const warehouse = await db.warehouse.findUnique({
    where: { id: data.warehouseId },
    select: { id: true, isActive: true },
  });
  if (!warehouse) throw new WarehouseInvariantError('仓库不存在');
  if (!warehouse.isActive) throw new WarehouseInvariantError('仓库已停用');

  return db.warehouseLocation.create({
    data: {
      warehouseId: data.warehouseId,
      code: data.code,
      name: data.name,
      isDefault: false,
      isActive: true,
    },
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
  });
}
