'use server';

import { redirect } from 'next/navigation';
import { TxDirection } from '../generated/prisma/enums';
import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  mapPrismaUniqueViolation,
  revalidatePaths,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createMaterialSchema,
  materialStockTransactionSchema,
  updateMaterialSchema,
} from '@/lib/auth/schemas';
import {
  createMaterial,
  createMaterialTransaction,
  MaterialInvariantError,
  setMaterialActive,
  updateMaterial,
} from '@/lib/material';
import type { MaterialMutationResult } from './owner-materials.types';

const MATERIAL_CODE_UNIQUE_SYNONYMS: readonly string[] = [
  'code',
  'Material_code_key',
];
const MATERIAL_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: MATERIAL_CODE_UNIQUE_SYNONYMS,
    message: '该物料编码已被占用',
  },
];

function mapUniqueViolation(err: unknown): MaterialMutationResult | null {
  return mapPrismaUniqueViolation(err, MATERIAL_UNIQUE_VIOLATIONS);
}

function normalizeMaterialFormInput(formData: FormData) {
  return {
    code: getFormString(formData, 'code'),
    name: getFormString(formData, 'name'),
    category: getFormString(formData, 'category'),
    specification: getFormStringOr(formData, 'specification', ''),
    unit: getFormString(formData, 'unit'),
    safetyStock: getFormStringOr(formData, 'safetyStock', ''),
    averageCost: getFormStringOr(formData, 'averageCost', ''),
  };
}

function routeBase(formData: FormData): '/owner/materials' | '/foreman/materials' {
  return getFormString(formData, 'routeBase') === '/foreman/materials'
    ? '/foreman/materials'
    : '/owner/materials';
}

export async function createMaterialAction(
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');

  const parsed = createMaterialSchema.safeParse(
    normalizeMaterialFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  let createdId: string;
  try {
    const created = await createMaterial(parsed.data);
    createdId = created.id;
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, MaterialInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateMaterialPaths(createdId);
  redirect(`${routeBase(formData)}/${createdId}`);
}

export async function updateMaterialAction(
  id: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');

  const parsed = updateMaterialSchema.safeParse(
    normalizeMaterialFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  try {
    await updateMaterial(id, parsed.data);
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, MaterialInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateMaterialPaths(id);
  return { status: 'success' };
}

export async function setMaterialActiveAction(
  id: string,
  isActive: boolean,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');

  try {
    await setMaterialActive(id, isActive);
  } catch (err) {
    const invariant = mapInvariantError(err, MaterialInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateMaterialPaths(id);
  return { status: 'success' };
}

export async function createMaterialTransactionAction(
  materialId: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  const actor = await requirePermission('material:manage');
  const parsed = materialStockTransactionSchema.safeParse({
    materialId,
    locationId: getFormStringOr(formData, 'locationId', ''),
    direction: getFormString(formData, 'direction'),
    quantity: getFormString(formData, 'quantity'),
    reasonType: getFormString(formData, 'reasonType'),
    unitCost: getFormStringOr(formData, 'unitCost', ''),
    remark: getFormStringOr(formData, 'remark', ''),
  });
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  try {
    await createMaterialTransaction({
      ...parsed.data,
      direction: parsed.data.direction === 'IN' ? TxDirection.IN : TxDirection.OUT,
      locationId: parsed.data.locationId,
      operatorId: actor.id,
    });
  } catch (err) {
    const invariant = mapInvariantError(err, MaterialInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateMaterialPaths(materialId);
  return { status: 'success', message: '库存已更新' };
}

function revalidateMaterialPaths(id: string) {
  revalidatePaths([
    '/owner/materials',
    `/owner/materials/${id}`,
    '/foreman/materials',
    `/foreman/materials/${id}`,
  ]);
}
