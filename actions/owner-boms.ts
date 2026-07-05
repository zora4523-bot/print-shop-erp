'use server';

import { redirect } from 'next/navigation';
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
import { createBomSchema } from '@/lib/auth/schemas';
import { BomInvariantError, createBom, setBomActive } from '@/lib/bom';
import type { BomMutationResult } from './owner-boms.types';

const BOM_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'version',
    targets: ['productId', 'version', 'BillOfMaterial_productId_version_key'],
    message: '该产品已有相同版本号 BOM',
  },
  {
    field: 'version',
    targets: [
      'categoryNodeId',
      'version',
      'BillOfMaterial_categoryNodeId_version_key',
    ],
    message: '该产品分类已有相同版本号 BOM',
  },
  {
    field: 'productId',
    targets: ['BillOfMaterial_active_product_key'],
    message: '该产品已有启用 BOM',
  },
  {
    field: 'categoryNodeId',
    targets: ['BillOfMaterial_active_category_key'],
    message: '该产品分类已有启用 BOM',
  },
  {
    field: 'items',
    targets: ['bomId', 'materialId', 'BillOfMaterialItem_bomId_materialId_key'],
    message: '同一个 BOM 中物料不能重复',
  },
];

function normalizeBomFormInput(formData: FormData) {
  const itemCount = Number.parseInt(getFormStringOr(formData, 'itemCount', '0'), 10);
  const items = Array.from({ length: Number.isFinite(itemCount) ? itemCount : 0 })
    .map((_, index) => ({
      materialId: getFormStringOr(formData, `items.${index}.materialId`, ''),
      quantity: getFormStringOr(formData, `items.${index}.quantity`, ''),
      remark: getFormStringOr(formData, `items.${index}.remark`, ''),
    }))
    .filter((item) => item.materialId || item.quantity || item.remark);

  return {
    targetType: getFormString(formData, 'targetType'),
    productId: getFormStringOr(formData, 'productId', ''),
    categoryNodeId: getFormStringOr(formData, 'categoryNodeId', ''),
    name: getFormString(formData, 'name'),
    version: getFormString(formData, 'version'),
    baseQuantity: getFormString(formData, 'baseQuantity'),
    items,
  };
}

export async function createBomAction(
  _prev: BomMutationResult | null,
  formData: FormData,
): Promise<BomMutationResult> {
  await requirePermission('bom:manage');

  const parsed = createBomSchema.safeParse(normalizeBomFormInput(formData));
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  let createdId: string;
  try {
    const created = await createBom(parsed.data);
    createdId = created.id;
  } catch (err) {
    const unique = mapPrismaUniqueViolation(err, BOM_UNIQUE_VIOLATIONS);
    if (unique) return unique;
    const invariant = mapInvariantError(err, BomInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateBomPaths(createdId);
  redirect(`/owner/boms/${createdId}`);
}

export async function setBomActiveAction(
  id: string,
  isActive: boolean,
): Promise<BomMutationResult> {
  await requirePermission('bom:manage');

  try {
    await setBomActive(id, isActive);
  } catch (err) {
    const unique = mapPrismaUniqueViolation(err, BOM_UNIQUE_VIOLATIONS);
    if (unique) return unique;
    const invariant = mapInvariantError(err, BomInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateBomPaths(id);
  return {
    status: 'success',
    message: isActive ? 'BOM 已启用' : 'BOM 已停用',
  };
}

function revalidateBomPaths(id: string) {
  revalidatePaths([
    '/owner/boms',
    `/owner/boms/${id}`,
    '/owner/products',
    '/orders',
  ]);
}
