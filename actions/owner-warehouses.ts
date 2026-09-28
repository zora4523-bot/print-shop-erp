'use server';

import { revalidatePath } from 'next/cache';
import {
  getFormString,
  invalidFromIssues,
  mapInvariantError,
  mapPrismaUniqueViolation,
  revalidatePaths,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createWarehouseLocationSchema,
  createWarehouseSchema,
} from '@/lib/auth/schemas';
import {
  createWarehouse,
  createWarehouseLocation,
  WarehouseInvariantError,
} from '@/lib/warehouse';
import { maintainWarehouse, warehouseMaintenanceSchema } from '@/lib/warehouse-maintenance';
import type { WarehouseMutationResult } from './owner-warehouses.types';

const WAREHOUSE_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: ['code', 'Warehouse_code_key'],
    message: '该仓库编码已被占用',
  },
];

const LOCATION_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: [
      'warehouseId',
      'code',
      'WarehouseLocation_warehouseId_code_key',
    ],
    message: '该仓库下已有相同库位编码',
  },
];

export async function createWarehouseAction(
  _prev: WarehouseMutationResult | null,
  formData: FormData,
): Promise<WarehouseMutationResult> {
  const actor = await requirePermission('warehouse:manage');

  const parsed = createWarehouseSchema.safeParse({
    code: getFormString(formData, 'code'),
    name: getFormString(formData, 'name'),
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    await createWarehouse(parsed.data, actor.id);
  } catch (err) {
    const unique = mapPrismaUniqueViolation(err, WAREHOUSE_UNIQUE_VIOLATIONS);
    if (unique) return unique;
    const invariant = mapInvariantError(err, WarehouseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateWarehousePaths();
  return { status: 'success', message: '仓库已创建' };
}

export async function createWarehouseLocationAction(
  _prev: WarehouseMutationResult | null,
  formData: FormData,
): Promise<WarehouseMutationResult> {
  const actor = await requirePermission('warehouse:manage');

  const parsed = createWarehouseLocationSchema.safeParse({
    warehouseId: getFormString(formData, 'warehouseId'),
    code: getFormString(formData, 'code'),
    name: getFormString(formData, 'name'),
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    await createWarehouseLocation(parsed.data, actor.id);
  } catch (err) {
    const unique = mapPrismaUniqueViolation(err, LOCATION_UNIQUE_VIOLATIONS);
    if (unique) return unique;
    const invariant = mapInvariantError(err, WarehouseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateWarehousePaths();
  return { status: 'success', message: '库位已创建' };
}

function revalidateWarehousePaths() {
  revalidatePaths([
    '/owner/warehouses',
    '/owner/materials',
    '/owner/rules/papers',
    '/foreman/materials',
    '/owner/purchases',
    '/owner/materials/count',
    '/foreman/materials/count',
  ]);
  revalidatePath('/owner/materials/[id]', 'page');
  revalidatePath('/owner/rules/papers/[id]', 'page');
  revalidatePath('/foreman/materials/[id]', 'page');
  revalidatePath('/owner/purchases/[id]', 'page');
}

export async function maintainWarehouseAction(
  _prev: WarehouseMutationResult | null,
  formData: FormData,
): Promise<WarehouseMutationResult> {
  const actor = await requirePermission('warehouse:manage');
  const parsed = warehouseMaintenanceSchema.safeParse({
    kind: getFormString(formData, 'kind'), id: getFormString(formData, 'id'),
    expectedUpdatedAt: getFormString(formData, 'expectedUpdatedAt'),
    operation: getFormString(formData, 'operation'),
    name: getFormString(formData, 'name') ?? undefined,
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);
  try { await maintainWarehouse(parsed.data, actor.id); }
  catch (error) {
    const invariant = mapInvariantError(error, WarehouseInvariantError);
    if (invariant) return invariant;
    throw error;
  }
  revalidateWarehousePaths();
  return { status: 'success', message: parsed.data.operation === 'rename' ? '名称已修改' : parsed.data.operation === 'restore' ? '已恢复使用' : '已停用' };
}
