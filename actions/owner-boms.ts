'use server';

import { redirect } from 'next/navigation';
import { appendReceipt } from '@/lib/admin/receipt';
import {
  getFormString,
  getFormStringOr,
  extractPrismaUniqueTargets,
  invalidFromIssues,
  mapInvariantError,
  revalidatePaths,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { createBomSchema } from '@/lib/auth/schemas';
import { BomInvariantError, createBom, setBomActive } from '@/lib/bom';
import type { BomMutationResult } from './owner-boms.types';

const BOM_UNIQUE_VIOLATIONS = [
  { field: 'blankSpecificationKey', targets: [['blankPaperMaterialId', 'blankSpecificationKey'], ['BillOfMaterial_active_blank_target_key']], message: '该纸张规格已有启用 BOM' },
  { field: 'version', targets: [['blankPaperMaterialId', 'blankSpecificationKey', 'version'], ['BillOfMaterial_blank_target_version_key']], message: '该纸张规格已有相同版本号 BOM' },
  {
    field: 'version',
    targets: [['productId', 'version'], ['BillOfMaterial_productId_version_key']],
    message: '该产品已有相同版本号 BOM',
  },
  {
    field: 'version',
    targets: [['categoryNodeId', 'version'], ['BillOfMaterial_categoryNodeId_version_key']],
    message: '该产品分类已有相同版本号 BOM',
  },
  {
    field: 'productId',
    targets: [['productId'], ['BillOfMaterial_active_product_key']],
    message: '该产品已有启用 BOM',
  },
  {
    field: 'categoryNodeId',
    targets: [['categoryNodeId'], ['BillOfMaterial_active_category_key']],
    message: '该产品分类已有启用 BOM',
  },
  {
    field: 'items',
    targets: [['bomId', 'materialId'], ['BillOfMaterialItem_bomId_materialId_key']],
    message: '同一个 BOM 中物料不能重复',
  },
] as const;

function mapBomUniqueViolation(error: unknown): BomMutationResult | null {
  if (typeof error !== 'object' || error === null ||
      !('code' in error) || error.code !== 'P2002') return null;
  const targets = extractPrismaUniqueTargets('meta' in error ? error.meta : undefined);
  // One active BOM is enforced by a partial unique index on the target alone;
  // version uniqueness uses two fields. Matching any one field confuses them.
  const mapping = BOM_UNIQUE_VIOLATIONS.find((candidate) => candidate.targets.some(
    (fields) => fields.length === targets.length && fields.every((field) => targets.includes(field)),
  ));
  return mapping ? { status: 'invalid', fieldErrors: { [mapping.field]: [mapping.message] } } : null;
}

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
    blankPaperMaterialId: getFormStringOr(formData, 'blankPaperMaterialId', ''),
    blankSpecificationKey: getFormStringOr(formData, 'blankSpecificationKey', ''),
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
    const unique = mapBomUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, BomInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateBomPaths(createdId);
  redirect(appendReceipt(`/owner/boms/${createdId}`, { created: '1' }));
}

export async function setBomActiveAction(
  id: string,
  isActive: boolean,
): Promise<BomMutationResult> {
  await requirePermission('bom:manage');

  try {
    await setBomActive(id, isActive);
  } catch (err) {
    const unique = mapBomUniqueViolation(err);
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
    '/orders',
  ]);
}
