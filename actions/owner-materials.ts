'use server';

import { redirect } from 'next/navigation';
import { MaterialCategory, TxDirection } from '../generated/prisma/enums';
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
  getMaterialSummary,
  MaterialInvariantError,
  MaterialUnitChangeError,
  setMaterialActive,
  updateMaterial,
} from '@/lib/material';
import type { MaterialMutationResult } from './owner-materials.types';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

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
  {
    field: 'name',
    targets: ['Material_active_paper_name_unique'],
    message: '已存在同名的启用纸张，请使用唯一名称或先停用旧记录',
  },
];

function mapUniqueViolation(err: unknown): MaterialMutationResult | null {
  return mapPrismaUniqueViolation(err, MATERIAL_UNIQUE_VIOLATIONS);
}

function normalizeMaterialFormInput(
  formData: FormData,
  fixedCategory?: MaterialCategory,
) {
  return {
    code: getFormString(formData, 'code'),
    name: getFormString(formData, 'name'),
    category: fixedCategory ?? getFormString(formData, 'category'),
    specification: getFormStringOr(formData, 'specification', ''),
    unit: getFormString(formData, 'unit'),
    safetyStock: getFormStringOr(formData, 'safetyStock', ''),
    averageCost: getFormStringOr(formData, 'averageCost', ''),
  };
}

function requestedRouteBase(
  formData: FormData,
): '/owner/materials' | '/foreman/materials' | '/owner/rules/papers' {
  const requested = getFormString(formData, 'routeBase');
  if (requested === '/foreman/materials') return '/foreman/materials';
  if (requested === RULE_CENTER_HREFS.papers) return RULE_CENTER_HREFS.papers;
  return '/owner/materials';
}

export async function createMaterialAction(
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return createMaterialWithScope(formData, {
    redirectBase: requestedRouteBase(formData),
  });
}

export async function createPaperAction(
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return createMaterialWithScope(formData, {
    fixedCategory: MaterialCategory.PAPER,
    redirectBase: RULE_CENTER_HREFS.papers,
  });
}

export async function createNonPaperMaterialAction(
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return createMaterialWithScope(formData, {
    excludedCategory: MaterialCategory.PAPER,
    redirectBase: '/owner/materials',
  });
}

async function createMaterialWithScope(
  formData: FormData,
  scope: {
    fixedCategory?: MaterialCategory;
    excludedCategory?: MaterialCategory;
    redirectBase: '/owner/materials' | '/foreman/materials' | '/owner/rules/papers';
  },
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');

  const parsed = createMaterialSchema.safeParse(
    normalizeMaterialFormInput(formData, scope.fixedCategory),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }
  if (
    scope.excludedCategory &&
    parsed.data.category === scope.excludedCategory
  ) {
    return {
      status: 'invalid',
      fieldErrors: {
        category: ['纸张请在规则配置中心统一维护'],
      },
    };
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
  redirect(`${scope.redirectBase}/${createdId}`);
}

export async function updateMaterialAction(
  id: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return updateMaterialWithScope(id, formData);
}

export async function updatePaperAction(
  id: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return updateMaterialWithScope(id, formData, MaterialCategory.PAPER);
}

async function updateMaterialWithScope(
  id: string,
  formData: FormData,
  fixedCategory?: MaterialCategory,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');

  if (fixedCategory) {
    const existing = await getMaterialSummary(id);
    if (!existing || existing.category !== fixedCategory) {
      return { status: 'error', message: '目标纸张不存在或不属于纸张分类' };
    }
  }

  const parsed = updateMaterialSchema.safeParse(
    normalizeMaterialFormInput(formData, fixedCategory),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  try {
    await updateMaterial(id, parsed.data);
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    if (err instanceof MaterialUnitChangeError) {
      return {
        status: 'invalid',
        fieldErrors: { unit: [err.message] },
      };
    }
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
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    const invariant = mapInvariantError(err, MaterialInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateMaterialPaths(id);
  return { status: 'success' };
}

export async function setPaperActiveAction(
  id: string,
  isActive: boolean,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');
  const existing = await getMaterialSummary(id);
  if (!existing || existing.category !== MaterialCategory.PAPER) {
    return { status: 'error', message: '目标纸张不存在或不属于纸张分类' };
  }

  try {
    await setMaterialActive(id, isActive);
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

export async function createMaterialTransactionAction(
  materialId: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return createMaterialTransactionWithScope(materialId, formData);
}

export async function createPaperTransactionAction(
  materialId: string,
  _prev: MaterialMutationResult | null,
  formData: FormData,
): Promise<MaterialMutationResult> {
  return createMaterialTransactionWithScope(
    materialId,
    formData,
    MaterialCategory.PAPER,
  );
}

async function createMaterialTransactionWithScope(
  materialId: string,
  formData: FormData,
  requiredCategory?: MaterialCategory,
): Promise<MaterialMutationResult> {
  const actor = await requirePermission('material:manage');
  if (requiredCategory) {
    const existing = await getMaterialSummary(materialId);
    if (!existing || existing.category !== requiredCategory) {
      return { status: 'error', message: '目标纸张不存在或不属于纸张分类' };
    }
  }

  const parsed = materialStockTransactionSchema.safeParse({
    idempotencyKey: getFormString(formData, 'idempotencyKey'),
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
    RULE_CENTER_HREFS.papers,
    `${RULE_CENTER_HREFS.papers}/${id}`,
    '/owner/purchases/new',
    '/owner/boms/new',
  ]);
}
